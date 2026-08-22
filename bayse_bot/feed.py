"""Shared market state and Bayse WebSocket BTC price feed.

BayseFeed replaces BybitFeed as the primary BTC data source.
It connects to wss://socket.bayse.markets/ws/v1/realtime for live
BTC price ticks and maintains a local candle history for feature
computation.

MarketState is the single shared object that all components read from.
"""
from __future__ import annotations
import asyncio, json, logging
from collections import deque
from datetime import datetime, timezone
from decimal import Decimal
from typing import Awaitable, Callable
import aiohttp, websockets
from .models import BTCFeatures

log = logging.getLogger(__name__)

BAYSE_WS = "wss://socket.bayse.markets/ws/v1/realtime"
BYBIT_REST_CANDLES = "https://api.bybit.com/v5/market/kline?category=spot&symbol=BTCUSDT&interval=1&limit=200"


class MarketState:
    """Continuously updated shared state for the entire bot.

    All components (feeds, strategy, engine, API) read from this object.
    Writes are atomic (attribute assignment) so no locking is needed for
    single-reader patterns.
    """

    def __init__(self) -> None:
        self.btc_price: Decimal = Decimal("0")
        self.btc_features: BTCFeatures = BTCFeatures(
            Decimal("0"), Decimal("0"), Decimal("0"), Decimal("0"),
            datetime.now(timezone.utc), False,
        )
        self.last_btc_update: datetime | None = None


class BayseFeed:
    """BTC price feed via Bayse WebSocket.

    Connects to the Bayse realtime asset price stream for BTCUSDT.
    Maintains a local candle deque for feature computation (momentum,
    volume ratio, ATR).

    Features are recomputed on every price tick and stored in the
    shared MarketState.
    """

    def __init__(
        self,
        state: MarketState,
        stale_after_seconds: int = 30,
        candle_window_seconds: int = 60,
    ) -> None:
        self.state = state
        self.stale_after_seconds = stale_after_seconds
        self.candle_window_seconds = candle_window_seconds

        # Local candle history: (timestamp, close_price, tick_volume)
        # tick_volume is incremented per price tick within each candle window.
        self.candles: deque[tuple[datetime, Decimal, Decimal]] = deque(maxlen=240)
        self.last_tick_at: datetime | None = None
        self.last_price: Decimal | None = None

        # Current candle accumulator
        self._candle_start: datetime | None = None
        self._candle_close: Decimal = Decimal("0")
        self._candle_volume: Decimal = Decimal("0")

    async def reseed(self, session: aiohttp.ClientSession) -> None:
        """Fetch historical 1-minute candles from Bybit REST to seed the deque."""
        try:
            async with session.get(BYBIT_REST_CANDLES, timeout=aiohttp.ClientTimeout(total=10)) as r:
                if r.status >= 300:
                    log.warning("Bybit REST reseed failed: %d", r.status)
                    return
                rows = (await r.json())["result"]["list"]
            self.candles.clear()
            for row in reversed(rows):
                self.candles.append((
                    datetime.fromtimestamp(int(row[0]) / 1000, timezone.utc),
                    Decimal(str(row[4])),
                    Decimal(str(row[5])),
                ))
            if self.candles:
                self.last_price = self.candles[-1][1]
                self.last_tick_at = datetime.now(timezone.utc)
                log.info("BayseFeed reseeded: %d candles, last price=%s", len(self.candles), self.last_price)
        except Exception as exc:
            log.warning("BayseFeed reseed error: %s", exc)

    def ingest_tick(self, price: str | float, at: datetime | None = None) -> None:
        """Process a single BTC price tick from the WebSocket."""
        now = at or datetime.now(timezone.utc)
        p = Decimal(str(price))
        self.last_price = p
        self.last_tick_at = now

        # Accumulate into current candle
        if self._candle_start is None:
            self._candle_start = now
            self._candle_close = p
            self._candle_volume = Decimal("1")
        else:
            elapsed = (now - self._candle_start).total_seconds()
            if elapsed >= self.candle_window_seconds:
                # Finalize previous candle
                self.candles.append((self._candle_start, self._candle_close, self._candle_volume))
                # Start new candle
                self._candle_start = now
                self._candle_close = p
                self._candle_volume = Decimal("1")
            else:
                self._candle_close = p
                self._candle_volume += Decimal("1")

        # Update shared state
        self.state.btc_price = p
        self.state.last_btc_update = now
        self.state.btc_features = self._compute_features(now)

    def stale(self, now: datetime | None = None) -> bool:
        now = now or datetime.now(timezone.utc)
        return not self.last_tick_at or (now - self.last_tick_at).total_seconds() > self.stale_after_seconds

    def _compute_features(self, now: datetime, volume_lookback: int = 20) -> BTCFeatures:
        """Compute BTCFeatures from local candle history + current tick."""
        if self.stale(now) or not self.last_price or len(self.candles) < volume_lookback + 2:
            return BTCFeatures(
                self.last_price or Decimal("0"),
                Decimal("0"), Decimal("0"), Decimal("0"), now, False,
            )

        # Momentum: compare last price to price at least `window_seconds` back
        window = self.candle_window_seconds * 60  # approximate from candle count
        base = self.candles[0][1]
        for t, p, _ in reversed(self.candles):
            if (now - t).total_seconds() >= window:
                base = p
                break
        momentum = (self.last_price - base) / base * 100 if base else Decimal("0")

        # Volume ratio: current candle volume vs average of recent candles
        volumes = [v for _, _, v in list(self.candles)[-volume_lookback:]]
        avg_vol = sum(volumes) / len(volumes) if volumes else Decimal("0")
        volume_ratio = self._candle_volume / avg_vol if avg_vol else Decimal("0")

        # ATR: average true range of recent closes, normalized
        closes = [p for _, p, _ in list(self.candles)[-volume_lookback:]]
        if len(closes) >= 2:
            atr = sum(abs(b - a) for a, b in zip(closes, closes[1:])) / (len(closes) - 1) / self.last_price * 100
        else:
            atr = Decimal("0")

        return BTCFeatures(self.last_price, momentum, volume_ratio, atr, now, True)

    async def run(
        self,
        stop: asyncio.Event,
        on_features: Callable[[BTCFeatures], Awaitable[None]] | None = None,
    ) -> None:
        """Main WebSocket loop with bounded reconnect and exponential backoff."""
        backoff = 1
        while not stop.is_set():
            try:
                # Seed from REST before connecting WS
                async with aiohttp.ClientSession() as session:
                    await self.reseed(session)

                async with websockets.connect(
                    BAYSE_WS, ping_interval=20, ping_timeout=20,
                ) as ws:
                    # Subscribe to BTC price feed
                    await ws.send(json.dumps({
                        "type": "subscribe",
                        "channel": "asset_prices",
                        "symbols": ["BTCUSDT"],
                    }))
                    backoff = 1
                    log.info("BayseFeed connected, subscribed to BTCUSDT")

                    while not stop.is_set():
                        raw = await asyncio.wait_for(ws.recv(), timeout=35)
                        # Bayse WS may batch messages with newline separation
                        for line in raw.split("\n"):
                            if not line.strip():
                                continue
                            msg = json.loads(line)
                            if msg.get("type") == "asset_price":
                                data = msg.get("data", {})
                                price = data.get("price")
                                if price is not None:
                                    self.ingest_tick(price)
                                    if on_features:
                                        await on_features(self.state.btc_features)

                        if self.stale():
                            raise RuntimeError("Bayse websocket data stale")

            except (OSError, asyncio.TimeoutError, websockets.WebSocketException, RuntimeError) as exc:
                log.warning("BayseFeed connection issue: %s (retrying in %ds)", exc, min(backoff, 30))
                await asyncio.sleep(min(backoff, 30))
                backoff = min(backoff * 2, 30)
