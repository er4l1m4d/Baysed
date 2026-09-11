"""Activity print buffer — WS trade messages to DB, batched per cycle.

The WS feed invokes ActivityBuffer.add() per buy_order/sell_order message
(never blocks the feed loop). The engine drains the buffer once per scan
cycle and persists a capped batch. Overflow drops oldest messages with a
warning + counter — a diagnostics burst must never destabilize the bot.

Message shapes are not fully known (the activity channel was never
subscribed pre-Run 002), so rows are stored raw with best-effort ID
extraction; parsing happens at analysis time.
"""
from __future__ import annotations

import logging
from collections import deque
from typing import Any

log = logging.getLogger(__name__)


def extract_activity_ids(msg: dict[str, Any]) -> tuple[str, str]:
    """Best-effort (market_id, event_id) extraction from an activity message."""
    data = msg.get("data", {}) or {}
    if not isinstance(data, dict):
        return "", ""

    market_id = (
        data.get("marketId")
        or data.get("market", {}).get("id")
        or (data.get("market", {}).get("marketId") if isinstance(data.get("market"), dict) else None)
        or ""
    )
    event_id = (
        data.get("eventId")
        or data.get("event", {}).get("id")
        or ""
    )
    return str(market_id), str(event_id)


class ActivityBuffer:
    """Bounded in-memory buffer of WS activity messages."""

    def __init__(self, maxlen: int = 5000) -> None:
        self._buf: deque[dict[str, Any]] = deque(maxlen=maxlen)
        self._dropped: int = 0

    async def add(self, event_id: str, msg: dict[str, Any]) -> None:
        """WS callback — append one message. Oldest dropped on overflow."""
        market_id, msg_event_id = extract_activity_ids(msg)
        item = {
            "market_id": market_id or "",
            "event_id": event_id or msg_event_id,
            "msg_type": str(msg.get("type", "")),
            "raw": msg,
        }
        if len(self._buf) == self._buf.maxlen:
            self._dropped += 1
        self._buf.append(item)

    def drain(self, max_rows: int = 200) -> list[dict[str, Any]]:
        """Take up to max_rows oldest items (popleft keeps ordering)."""
        rows = []
        while self._buf and len(rows) < max_rows:
            rows.append(self._buf.popleft())
        return rows

    def take_dropped_count(self) -> int:
        """Return and reset the dropped-overflow counter."""
        dropped, self._dropped = self._dropped, 0
        return dropped

    def __len__(self) -> int:
        return len(self._buf)
