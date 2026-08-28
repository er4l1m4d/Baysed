"""Bayse WebSocket market data feed.

Connects to wss://socket.bayse.markets/ws/v1/markets for real-time
price updates, orderbook snapshots, and trade activity.

Architecture:
  BayseMarketFeed (WS)  →  MarketStateStore (canonical)  →  consumers
  BayseClient (REST)    →  discovery / recovery / reconciliation only
"""
from __future__ import annotations
import asyncio, json, logging
from datetime import datetime, timezone
from decimal import Decimal
from typing import Awaitable, Callable
import websockets
from .models import OrderBook, BookLevel, Outcome

log = logging.getLogger(__name__)

BAYSE_MARKET_WS = "wss://socket.bayse.markets/ws/v1/markets"


def _d(v, default="0") -> Decimal:
    try:
        return Decimal(str(v)) if v is not None else Decimal(default)
    except Exception:
        return Decimal(default)


def parse_ws_book(data: dict, market_id: str, outcome: Outcome) -> OrderBook:
    """Parse an orderbook_update payload into an OrderBook."""
    ob = data.get("orderbook", data)
    def levels(name: str, reverse: bool) -> tuple[BookLevel, ...]:
        raw = ob.get(name, [])
        parsed = [BookLevel(_d(x.get("price")), _d(x.get("quantity"))) for x in raw if isinstance(x, dict)]
        return tuple(sorted(parsed, key=lambda x: x.price, reverse=reverse))
    return OrderBook(
        market_id=market_id,
        outcome=outcome,
        bids=levels("bids", True),
        asks=levels("asks", False),
        captured_at=datetime.now(timezone.utc),
    )


def resolve_outcome_from_id(
    outcome_id: str,
    outcome1_id: str | None = None,
    outcome2_id: str | None = None,
) -> Outcome:
    """Resolve a Bayse outcomeId to our canonical Outcome enum.

    Uses outcome1_id/outcome2_id from the market if available,
    otherwise falls back to position-based matching.
    """
    if outcome1_id and outcome_id == outcome1_id:
        return Outcome.YES
    if outcome2_id and outcome_id == outcome2_id:
        return Outcome.NO
    log.debug("Unknown outcome_id=%s (o1=%s o2=%s), defaulting to YES", outcome_id, outcome1_id, outcome2_id)
    return Outcome.YES


class MarketStateStore:
    """Canonical market state store — single source of truth for all consumers.

    The WS feed writes here. The signal engine and terminal/API read from here.
    This eliminates duplicated interpretations of the same market data.

    Store is updated atomically (attribute assignment) so no locking is needed
    for single-reader patterns.
    """

    def __init__(self) -> None:
        # market_id -> {outcome: OrderBook, last_update: datetime}
        self.books: dict[str, dict[str, OrderBook]] = {}
        # event_id -> {market_id -> {price, volume, last_trade_at}}
        self.prices: dict[str, dict[str, dict]] = {}
        # event_id -> list of trades
        self.trades: dict[str, list[dict]] = {}
        # event_id -> {market_id -> OrderBook}
        self._market_events: dict[str, set[str]] = {}  # event_id -> set of market_ids

    def update_book(self, market_id: str, book: OrderBook) -> None:
        """Update order book for a market from WS."""
        self.books.setdefault(market_id, {})[book.outcome] = book

    def get_books(self, market_id: str) -> dict[str, OrderBook]:
        """Get current books for a market (both outcomes)."""
        return self.books.get(market_id, {})

    def get_best_prices(self, market_id: str) -> tuple[Decimal | None, Decimal | None]:
        """Get best (yes_ask, no_ask) for a market."""
        books = self.books.get(market_id, {})
        yes_book = books.get(Outcome.YES)
        no_book = books.get(Outcome.NO)
        return (
            yes_book.best_ask if yes_book else None,
            no_book.best_ask if no_book else None,
        )

    def update_price(self, event_id: str, market_id: str, data: dict) -> None:
        """Update market price from WS."""
        self.prices.setdefault(event_id, {})[market_id] = {
            "price": data.get("price"),
            "volume": data.get("volume"),
            "last_trade_at": datetime.now(timezone.utc),
        }

    def add_trade(self, event_id: str, trade: dict) -> None:
        """Record a trade from WS."""
        self.trades.setdefault(event_id, []).append({
            **trade,
            "recorded_at": datetime.now(timezone.utc),
        })
        # Keep only last 100 trades per event
        if len(self.trades[event_id]) > 100:
            self.trades[event_id] = self.trades[event_id][-100:]

    def register_market(self, event_id: str, market_id: str) -> None:
        """Register a market for subscription tracking."""
        self._market_events.setdefault(event_id, set()).add(market_id)

    def get_market_ids_for_event(self, event_id: str) -> list[str]:
        """Get all market IDs for an event."""
        return list(self._market_events.get(event_id, set()))


class BayseMarketFeed:
    """Real-time market data via Bayse WebSocket.

    Subscribes to prices, orderbook, and activity for specified markets.
    Writes to MarketStateStore (canonical state) and invokes callbacks
    for backward compatibility.

    Architecture:
      WS → MarketStateStore → consumers (signal engine, terminal/API)
      REST → discovery / recovery / reconciliation only
    """

    def __init__(self, store: MarketStateStore | None = None) -> None:
        self.store = store or MarketStateStore()
        self.subscribed_events: set[str] = set()
        self.subscribed_markets: set[str] = set()
        self.last_message_at: datetime | None = None

    async def run(
        self,
        stop: asyncio.Event,
        on_book: Callable[[str, OrderBook], Awaitable[None]] | None = None,
        on_price: Callable[[str, dict], Awaitable[None]] | None = None,
        on_trade: Callable[[str, dict], Awaitable[None]] | None = None,
    ) -> None:
        """Main WS loop. Reconnects on failure with exponential backoff."""
        backoff = 1
        while not stop.is_set():
            try:
                async with websockets.connect(
                    BAYSE_MARKET_WS, ping_interval=20, ping_timeout=20,
                ) as ws:
                    backoff = 1
                    log.info("BayseMarketFeed connected")

                    # Re-subscribe after reconnect
                    for event_id in self.subscribed_events:
                        await ws.send(json.dumps({"type": "subscribe", "channel": "prices", "eventId": event_id}))
                    for market_id in self.subscribed_markets:
                        await ws.send(json.dumps({"type": "subscribe", "channel": "orderbook", "marketIds": [market_id]}))

                    while not stop.is_set():
                        raw = await asyncio.wait_for(ws.recv(), timeout=35)
                        self.last_message_at = datetime.now(timezone.utc)

                        for line in raw.split("\n"):
                            if not line.strip():
                                continue
                            msg = json.loads(line)
                            msg_type = msg.get("type")
                            data = msg.get("data", {})

                            if msg_type == "price_update" and on_price:
                                event_id = data.get("id", "")
                                # Update canonical store
                                for mid, pdata in data.get("markets", {}).items():
                                    self.store.update_price(event_id, mid, pdata)
                                await on_price(event_id, data)

                            elif msg_type == "orderbook_update" and on_book:
                                ob_data = data.get("orderbook", data)
                                market_id = ob_data.get("marketId", "")
                                outcome_id = ob_data.get("outcomeId", "")
                                # Resolve outcome from incoming outcomeId, not hardcoded
                                outcome = resolve_outcome_from_id(outcome_id)
                                book = parse_ws_book(data, market_id, outcome)
                                # Update canonical store
                                self.store.update_book(market_id, book)
                                await on_book(market_id, book)

                            elif msg_type in ("buy_order", "sell_order") and on_trade:
                                event_id = data.get("event", {}).get("id", "")
                                # Update canonical store
                                self.store.add_trade(event_id, msg)
                                await on_trade(event_id, msg)

            except (OSError, asyncio.TimeoutError, websockets.WebSocketException) as exc:
                log.warning("BayseMarketFeed connection issue: %s (retrying in %ds)", exc, min(backoff, 30))
                await asyncio.sleep(min(backoff, 30))
                backoff = min(backoff * 2, 30)

    async def subscribe_prices(self, ws, event_id: str) -> None:
        """Subscribe to price updates for an event."""
        if event_id not in self.subscribed_events:
            self.subscribed_events.add(event_id)
            await ws.send(json.dumps({"type": "subscribe", "channel": "prices", "eventId": event_id}))

    async def subscribe_orderbook(self, ws, market_ids: list[str]) -> None:
        """Subscribe to orderbook updates for markets."""
        for mid in market_ids:
            if mid not in self.subscribed_markets:
                self.subscribed_markets.add(mid)
        await ws.send(json.dumps({"type": "subscribe", "channel": "orderbook", "marketIds": market_ids}))

    async def subscribe_activity(self, ws, event_id: str) -> None:
        """Subscribe to trade activity for an event."""
        await ws.send(json.dumps({"type": "subscribe", "channel": "activity", "eventId": event_id}))
