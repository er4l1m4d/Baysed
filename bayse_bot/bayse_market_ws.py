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
) -> Outcome | None:
    """Resolve a Bayse outcomeId to our canonical Outcome enum.

    Returns None for unknown/empty IDs (fail-closed).
    Unknown mappings are rejected — a wrong book is worse than no book.
    """
    if not outcome_id:
        log.warning("Empty outcomeId received — rejecting book update")
        return None
    if outcome1_id and outcome_id == outcome1_id:
        return Outcome.YES
    if outcome2_id and outcome_id == outcome2_id:
        return Outcome.NO
    log.warning("Unknown outcomeId=%s (o1=%s o2=%s) — rejecting book update", outcome_id, outcome1_id, outcome2_id)
    return None


class MarketStateStore:
    """Canonical market state store — single source of truth for all consumers.

    The WS feed writes here. The signal engine and terminal/API read from here.
    This eliminates duplicated interpretations of the same market data.

    State is replaced atomically (immutable snapshots) so no locking is needed
    under the single-writer (WS task) / multiple-reader pattern.
    """

    def __init__(self, stale_after_seconds: int = 30) -> None:
        self.stale_after_seconds = stale_after_seconds
        # market_id -> {outcome: OrderBook}
        self._books: dict[str, dict[Outcome, OrderBook]] = {}
        # market_id -> {outcome: last_update datetime}
        self._book_timestamps: dict[str, dict[Outcome, datetime]] = {}
        # event_id -> {market_id -> {price, volume, last_trade_at}}
        self.prices: dict[str, dict[str, dict]] = {}
        # event_id -> list of trades
        self.trades: dict[str, list[dict]] = {}
        # event_id -> set of market_ids
        self._market_events: dict[str, set[str]] = {}
        # market_id -> (outcome1_id, outcome2_id) for WS resolution
        self._outcome_ids: dict[str, tuple[str, str]] = {}

    def update_book(self, market_id: str, book: OrderBook) -> None:
        """Update order book for a market from WS (immutable snapshot replacement)."""
        # Replace snapshot atomically (no mutation of nested dict)
        existing = self._books.get(market_id, {})
        self._books[market_id] = {**existing, book.outcome: book}
        self._book_timestamps.setdefault(market_id, {})[book.outcome] = datetime.now(timezone.utc)

    def get_books(self, market_id: str) -> dict[Outcome, OrderBook]:
        """Get current books for a market (both outcomes)."""
        return self._books.get(market_id, {})

    def get_book(self, market_id: str, outcome: Outcome) -> OrderBook | None:
        """Get book for a specific outcome."""
        return self._books.get(market_id, {}).get(outcome)

    def is_book_fresh(self, market_id: str, outcome: Outcome) -> bool:
        """Check if a book is fresh (updated within stale_after_seconds)."""
        ts = self._book_timestamps.get(market_id, {}).get(outcome)
        if not ts:
            return False
        return (datetime.now(timezone.utc) - ts).total_seconds() < self.stale_after_seconds

    def book_age_ms(self, market_id: str, outcome: Outcome) -> float | None:
        """Get age of a book in milliseconds. Returns None if no book exists."""
        ts = self._book_timestamps.get(market_id, {}).get(outcome)
        if not ts:
            return None
        return (datetime.now(timezone.utc) - ts).total_seconds() * 1000

    def has_fresh_books(self, market_id: str) -> bool:
        """Check if both YES and NO books exist and are fresh."""
        return (
            self.is_book_fresh(market_id, Outcome.YES)
            and self.is_book_fresh(market_id, Outcome.NO)
        )

    def get_best_prices(self, market_id: str) -> tuple[Decimal | None, Decimal | None]:
        """Get best (yes_ask, no_ask) for a market."""
        books = self._books.get(market_id, {})
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

    def store_outcome_ids(self, market_id: str, outcome1_id: str, outcome2_id: str) -> None:
        """Store outcome ID mapping for WS resolution."""
        self._outcome_ids[market_id] = (outcome1_id, outcome2_id)

    def get_outcome_ids(self, market_id: str) -> tuple[str | None, str | None]:
        """Get outcome IDs for a market. Returns (o1_id, o2_id) or (None, None)."""
        return self._outcome_ids.get(market_id, (None, None))

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
        self.mapping_errors: int = 0
        # Health metrics for observation run
        self.connect_count: int = 0
        self.disconnect_count: int = 0
        self.reconnect_count: int = 0
        self.server_error_count: int = 0

    def health(self) -> dict[str, Any]:
        """Return WS health metrics for diagnostics."""
        from typing import Any
        last_age_ms = None
        if self.last_message_at:
            last_age_ms = (datetime.now(timezone.utc) - self.last_message_at).total_seconds() * 1000
        return {
            "connect_count": self.connect_count,
            "disconnect_count": self.disconnect_count,
            "reconnect_count": self.reconnect_count,
            "server_error_count": self.server_error_count,
            "mapping_errors": self.mapping_errors,
            "last_message_age_ms": round(last_age_ms, 0) if last_age_ms else None,
            "subscribed_events": len(self.subscribed_events),
            "subscribed_markets": len(self.subscribed_markets),
        }

    async def run(
        self,
        stop: asyncio.Event,
        on_book: Callable[[str, OrderBook], Awaitable[None]] | None = None,
        on_price: Callable[[str, dict], Awaitable[None]] | None = None,
        on_trade: Callable[[str, dict], Awaitable[None]] | None = None,
    ) -> None:
        """Main WS loop. Reconnects on failure with exponential backoff.

        Bayse server pings every ~54s. We disable client-side pings
        (ping_interval=None) and set recv timeout to 70s (>54s) so we
        don't timeout before the server's ping arrives.
        """
        backoff = 1
        while not stop.is_set():
            try:
                # ping_interval=None: let server handle keepalive (every ~54s)
                # recv timeout 70s > server's 54s ping interval
                async with websockets.connect(
                    BAYSE_MARKET_WS, ping_interval=None,
                ) as ws:
                    # Wait for Bayse 'connected' message (up to 10s)
                    try:
                        raw = await asyncio.wait_for(ws.recv(), timeout=10)
                        for line in raw.split("\n"):
                            if not line.strip():
                                continue
                            msg = json.loads(line)
                            if msg.get("type") == "connected":
                                log.info("BayseMarketFeed connected (clientId=%s)", msg.get("clientId", "?"))
                            else:
                                log.debug("BayseMarketFeed initial msg: %s", msg.get("type"))
                    except asyncio.TimeoutError:
                        log.warning("BayseMarketFeed: no 'connected' message within 10s")

                    if backoff > 1:
                        self.reconnect_count += 1
                    self.connect_count += 1
                    backoff = 1

                    # Re-subscribe after reconnect
                    for event_id in self.subscribed_events:
                        await ws.send(json.dumps({"type": "subscribe", "channel": "prices", "eventId": event_id}))
                    for market_id in self.subscribed_markets:
                        await ws.send(json.dumps({"type": "subscribe", "channel": "orderbook", "marketIds": [market_id], "currency": "USD"}))

                    while not stop.is_set():
                        # 70s timeout > server's 54s ping interval
                        raw = await asyncio.wait_for(ws.recv(), timeout=70)
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
                                # Look up outcome mapping from stored IDs
                                o1_id, o2_id = self.store.get_outcome_ids(market_id)
                                outcome = resolve_outcome_from_id(outcome_id, o1_id, o2_id)
                                if outcome is None:
                                    # Unknown mapping — reject book, don't pollute store
                                    self.mapping_errors += 1
                                    continue
                                book = parse_ws_book(data, market_id, outcome)
                                # Update canonical store
                                self.store.update_book(market_id, book)
                                await on_book(market_id, book)

                            elif msg_type in ("buy_order", "sell_order") and on_trade:
                                event_id = data.get("event", {}).get("id", "")
                                # Update canonical store
                                self.store.add_trade(event_id, msg)
                                await on_trade(event_id, msg)

                            elif msg_type == "error":
                                self.server_error_count += 1
                                log.warning("BayseMarketFeed server error: %s", data.get("message", data))

            except (OSError, asyncio.TimeoutError, websockets.WebSocketException) as exc:
                self.disconnect_count += 1
                log.warning("BayseMarketFeed connection issue: %s %s (retrying in %ds)",
                    type(exc).__name__, exc.args or "(no detail)", min(backoff, 30))
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
        await ws.send(json.dumps({"type": "subscribe", "channel": "orderbook", "marketIds": market_ids, "currency": "USD"}))

    async def subscribe_activity(self, ws, event_id: str) -> None:
        """Subscribe to trade activity for an event."""
        await ws.send(json.dumps({"type": "subscribe", "channel": "activity", "eventId": event_id}))
