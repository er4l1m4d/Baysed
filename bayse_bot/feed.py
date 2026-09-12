"""Shared market state and Bayse WebSocket BTC price feed.

BayseFeed replaces BybitFeed as the primary BTC data source.
It connects to wss://socket.bayse.markets/ws/v1/realtime for live
BTC price ticks (sourced from Binance) and maintains a local candle
history for feature computation.

MarketState is the single shared object that all components read from.
"""
from __future__ import annotations
import asyncio, json, logging
from collections import deque
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Awaitable, Callable
import websockets
from .models import BTCFeatures

log = logging.getLogger(__name__)

BAYSE_WS = "wss://socket.bayse.markets/ws/v1/realtime"


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
        # BTC price at the last observed 00:00 UTC rollover (Binance daily
        # candle close). None until the feed observes its first rollover
        # after startup. Used to test the Run-001 midnight-regime hypothesis.
        self.btc_daily_close: Decimal | None = None


class BayseFeed:
    """BTC price feed via Bayse WebSocket.

    Connects to the Bayse realtime asset price stream for BTCUSDT.
    The price data originates from Binance — the same source Bayse
    uses for contract resolution.

    Maintains a local candle deque for feature computation (momentum,
    volume ratio, ATR). Features are recomputed on every price tick
    and stored in the shared MarketState.

    Startup warm-up: features remain incomplete until enough candle
    history is accumulated (~22 minutes with 60s candles). The bot
    safely rejects incomplete data during this period.
    """

    def __init__(
        self,
        state: MarketState,
        stale_after_seconds: int = 30,
        candle_window_seconds: int = 60,
        momentum_window_seconds: int = 120,
    ) -> None:
        self.state = state
        self.stale_after_seconds = stale_after_seconds
        self.candle_window_seconds = candle_window_seconds
        self.momentum_window_seconds = momentum_window_seconds

        # Local candle history: (timestamp, close_price, tick_volume)
        self.candles: deque[tuple[datetime, Decimal, Decimal]] = deque(maxlen=240)
        self.last_tick_at: datetime | None = None
        self.last_price: Decimal | None = None

        # Grace period tracking
        self._connected_at: datetime | None = None
        self._received_first_tick: bool = False
        self.connect_count: int = 0
        self.disconnect_count: int = 0
        self.last_error: str | None = None

        # Current candle accumulator
        self._candle_start: datetime | None = None
        self._candle_close: Decimal = Decimal("0")
        self._candle_volume: Decimal = Decimal("0")

        # Count of finalized candles since construction — lets the checkpoint
        # writer know when the buffer has actually changed (no point writing
        # the same snapshot every second).
        self._finalized_count: int = 0

        # UTC-day tracking for daily-close capture (Binance daily candle close)
        self._utc_day: date | None = None

    @property
    def finalized_count(self) -> int:
        return self._finalized_count

    def serialize_candles(self) -> list[list[str]]:
        """Checkpointable snapshot of finalized candles.

        Stored as [iso8601, close_str, volume_str] rows — the engine's OWN
        tick-derived candles (tick-count volume, original phase), so reloading
        them introduces no unit or timestamp mismatch.
        """
        return [[t.isoformat(), str(p), str(v)] for (t, p, v) in self.candles]

    def restore_candles(
        self, serialized: list[list[str]] | None, *, max_age_seconds: int = 300,
        now: datetime | None = None,
    ) -> bool:
        """Seed the candle buffer from a checkpoint if it is fresh enough.

        Returns True when the buffer was restored. If the newest checkpointed
        candle is older than ``max_age_seconds`` we ignore it and let the feed
        warm up normally — restoring stale candles would poison volatility
        with a dead window, which is worse for a measurement run than a clean
        (null-probability) warm-up.
        """
        if not serialized:
            return False
        now = now or datetime.now(timezone.utc)
        try:
            newest = datetime.fromisoformat(serialized[-1][0])
            if newest.tzinfo is None:
                newest = newest.replace(tzinfo=timezone.utc)
            age = (now - newest).total_seconds()
            if age > max_age_seconds:
                log.info(
                    "Feed checkpoint %ss old (> %ss) — skipping restore, warming up",
                    int(age), max_age_seconds,
                )
                return False
            restored: list[tuple[datetime, Decimal, Decimal]] = []
            for t, p, v in serialized:
                dt = datetime.fromisoformat(t)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                restored.append((dt, Decimal(str(p)), Decimal(str(v))))
        except (ValueError, TypeError, IndexError) as exc:
            log.warning("Feed checkpoint malformed (%s) — warming up", exc)
            return False
        self.candles.clear()
        self.candles.extend(restored)
        self._finalized_count = len(restored)
        log.info(
            "Restored %d BTC candles from checkpoint (~22-min warm-up skipped)",
            len(restored),
        )
        return True

    def ingest_tick(self, price: str | float | int, at: datetime | None = None) -> None:
        """Process a single BTC price tick from the WebSocket."""
        now = at or datetime.now(timezone.utc)
        try:
            p = Decimal(str(price))
        except Exception:
            log.debug("BayseFeed ignoring invalid price: %r", price)
            return
        self.last_price = p
        self.last_tick_at = now

        # Daily-close capture: first tick of a new UTC day approximates the
        # Binance daily candle close (00:00 UTC). Only record on a genuine
        # rollover — not on the first tick after startup, which is just
        # "now", not midnight.
        today = now.date()
        if self._utc_day is not None and today > self._utc_day:
            self.state.btc_daily_close = p
            log.info("UTC daily close captured: $%s", p)
        self._utc_day = today

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
                self._finalized_count += 1
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

    def health(self) -> dict:
        age_ms = None
        if self.last_tick_at:
            age_ms = (datetime.now(timezone.utc) - self.last_tick_at).total_seconds() * 1000
        return {
            "connected": self._connected_at is not None and not self.stale(),
            "complete": self.state.btc_features.complete,
            "connect_count": self.connect_count,
            "disconnect_count": self.disconnect_count,
            "last_tick_age_ms": round(age_ms, 0) if age_ms is not None else None,
            "last_error": self.last_error,
            "candle_count": len(self.candles),
        }

    def _compute_features(self, now: datetime, volume_lookback: int = 20) -> BTCFeatures:
        """Compute BTCFeatures from local candle history + current tick."""
        if self.stale(now) or not self.last_price or len(self.candles) < volume_lookback + 2:
            return BTCFeatures(
                self.last_price or Decimal("0"),
                Decimal("0"), Decimal("0"), Decimal("0"), now, False,
            )

        # Momentum: compare last price to price at least `momentum_window_seconds` ago
        base = self.candles[0][1]
        for t, p, _ in reversed(self.candles):
            if (now - t).total_seconds() >= self.momentum_window_seconds:
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
        """Main WebSocket loop with bounded reconnect and exponential backoff.

        Candle history is seeded from the last DB checkpoint at boot (see
        BayseFeed.restore_candles), so a restart skips the ~22-min warm-up
        unless the checkpoint is missing or too stale. No exchange reseed —
        the buffer holds only the engine's OWN tick-derived candles.
        """
        backoff = 1
        while not stop.is_set():
            try:
                # Same keepalive design as BayseMarketFeed (see error.md /
                # A/B test 2026-09-10): client pings at the server's 54s
                # cadence; recv() polls at 30s and quiet is NOT a failure.
                async with websockets.connect(
                    BAYSE_WS, ping_interval=54, ping_timeout=20,
                ) as ws:
                    await ws.send(json.dumps({
                        "type": "subscribe",
                        "channel": "asset_prices",
                        "symbols": ["BTCUSDT"],
                    }))
                    backoff = 1
                    self._connected_at = datetime.now(timezone.utc)
                    self._received_first_tick = False
                    self.connect_count += 1
                    self.last_error = None
                    log.info("BayseFeed connected, subscribed to BTCUSDT (Binance source)")

                    while not stop.is_set():
                        try:
                            raw = await asyncio.wait_for(ws.recv(), timeout=30)
                        except asyncio.TimeoutError:
                            # Quiet period — poll the clock, don't kill the
                            # connection. Genuine staleness is handled below.
                            pass
                        else:
                            for line in raw.split("\n"):
                                if not line.strip():
                                    continue
                                msg = json.loads(line)
                                if msg.get("type") == "asset_price":
                                    data = msg.get("data", {})
                                    price = data.get("price")
                                    if price is not None:
                                        self.ingest_tick(price)
                                        self._received_first_tick = True
                                        if on_features:
                                            await on_features(self.state.btc_features)
                                else:
                                    log.debug("BayseFeed ignoring message type=%s", msg.get("type"))

                        # Only check staleness after first tick or 10s grace period
                        if self._received_first_tick or (
                            self._connected_at
                            and (datetime.now(timezone.utc) - self._connected_at).total_seconds() > 10
                        ):
                            if self.stale():
                                raise RuntimeError("Bayse websocket data stale")

            except (OSError, asyncio.TimeoutError, websockets.WebSocketException, RuntimeError) as exc:
                self.disconnect_count += 1
                self._connected_at = None
                self.last_error = f"{type(exc).__name__}: {exc}"
                log.warning("BayseFeed connection issue: %s (retrying in %ds)", exc, min(backoff, 30))
                await asyncio.sleep(min(backoff, 30))
                backoff = min(backoff * 2, 30)
