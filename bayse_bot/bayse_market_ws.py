"""Bayse WebSocket market data feed.

Connects to wss://socket.bayse.markets/ws/v1/markets for real-time
price updates, orderbook snapshots, and trade activity.
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


class BayseMarketFeed:
    """Real-time market data via Bayse WebSocket.

    Subscribes to prices, orderbook, and activity for specified markets.
    Parses incoming messages and invokes callbacks for downstream processing.
    """

    def __init__(self) -> None:
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
                                await on_price(event_id, data)

                            elif msg_type == "orderbook_update" and on_book:
                                ob_data = data.get("orderbook", data)
                                market_id = ob_data.get("marketId", "")
                                outcome_id = ob_data.get("outcomeId", "")
                                # Default to YES outcome; caller can map outcome IDs
                                book = parse_ws_book(data, market_id, Outcome.YES)
                                await on_book(market_id, book)

                            elif msg_type in ("buy_order", "sell_order") and on_trade:
                                event_id = data.get("event", {}).get("id", "")
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
