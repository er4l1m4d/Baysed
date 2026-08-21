"""Bybit public BTCUSDT spot feed with REST reseed and bounded WebSocket reconnect."""
from __future__ import annotations
import asyncio, json
from collections import deque
from datetime import datetime, timezone
from decimal import Decimal
from typing import Awaitable, Callable
import aiohttp, websockets
from .models import BTCFeatures

BYBIT_REST = "https://api.bybit.com/v5/market/kline?category=spot&symbol=BTCUSDT&interval=1&limit=200"
BYBIT_WS = "wss://stream.bybit.com/v5/public/spot"

class BybitFeed:
    def __init__(self, stale_after_seconds: int = 30):
        self.candles: deque[tuple[datetime, Decimal, Decimal]] = deque(maxlen=240)
        self.last_tick_at: datetime | None = None; self.last_price: Decimal | None = None
        self.stale_after_seconds = stale_after_seconds

    async def reseed(self, session: aiohttp.ClientSession) -> None:
        async with session.get(BYBIT_REST, timeout=aiohttp.ClientTimeout(total=10)) as r:
            if r.status >= 300: raise RuntimeError(f"Bybit REST {r.status}")
            rows = (await r.json())["result"]["list"]
        self.candles.clear()
        for row in reversed(rows):
            self.candles.append((datetime.fromtimestamp(int(row[0]) / 1000, timezone.utc), Decimal(str(row[4])), Decimal(str(row[5]))))
        if self.candles: self.last_price, self.last_tick_at = self.candles[-1][1], datetime.now(timezone.utc)

    def ingest_tick(self, price: str | Decimal, at: datetime | None = None) -> None:
        self.last_price, self.last_tick_at = Decimal(str(price)), at or datetime.now(timezone.utc)

    def stale(self, now: datetime | None = None) -> bool:
        now = now or datetime.now(timezone.utc)
        return not self.last_tick_at or (now - self.last_tick_at).total_seconds() > self.stale_after_seconds

    def features(self, window_seconds: int, volume_lookback: int = 20) -> BTCFeatures:
        now = datetime.now(timezone.utc)
        if self.stale(now) or not self.last_price or len(self.candles) < volume_lookback + 2:
            return BTCFeatures(self.last_price or Decimal("0"), Decimal("0"), Decimal("0"), Decimal("0"), now, False)
        base = next((p for t, p, _ in reversed(self.candles) if (now-t).total_seconds() >= window_seconds), self.candles[0][1])
        momentum = (self.last_price - base) / base * 100 if base else Decimal("0")
        volumes = [v for _, _, v in list(self.candles)[-volume_lookback:]]; average = sum(volumes) / len(volumes)
        volume_ratio = self.candles[-1][2] / average if average else Decimal("0")
        closes = [p for _, p, _ in list(self.candles)[-volume_lookback:]]
        atr = sum(abs(b-a) for a,b in zip(closes, closes[1:])) / max(1, len(closes)-1) / self.last_price * 100
        return BTCFeatures(self.last_price, momentum, volume_ratio, atr, now, True)

    async def run(self, stop: asyncio.Event, on_features: Callable[[BTCFeatures], Awaitable[None]] | None = None) -> None:
        backoff = 1
        while not stop.is_set():
            try:
                async with aiohttp.ClientSession() as session: await self.reseed(session)
                async with websockets.connect(BYBIT_WS, ping_interval=20, ping_timeout=20) as ws:
                    await ws.send(json.dumps({"op": "subscribe", "args": ["tickers.BTCUSDT", "kline.1.BTCUSDT"]}))
                    backoff = 1
                    while not stop.is_set():
                        raw = await asyncio.wait_for(ws.recv(), timeout=35); data = json.loads(raw)
                        for item in data.get("data", []) if isinstance(data.get("data"), list) else [data.get("data", {})]:
                            price = item.get("lastPrice") or item.get("close")
                            if price: self.ingest_tick(price)
                        if self.stale(): raise RuntimeError("Bybit websocket data stale")
                        if on_features: await on_features(self.features(120))
            except (OSError, asyncio.TimeoutError, websockets.WebSocketException, RuntimeError):
                await asyncio.sleep(min(backoff, 30)); backoff = min(backoff * 2, 30)
