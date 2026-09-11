"""Tests for the WS activity print buffer."""
import pytest

from bayse_bot.activity_buffer import ActivityBuffer, extract_activity_ids


@pytest.mark.asyncio
async def test_add_and_drain_preserves_order():
    buf = ActivityBuffer(maxlen=10)
    for i in range(5):
        await buf.add("e1", {"type": "buy_order", "data": {"marketId": f"m{i}"}})
    assert len(buf) == 5
    rows = buf.drain(max_rows=3)
    assert [r["market_id"] for r in rows] == ["m0", "m1", "m2"]
    assert len(buf) == 2
    rows = buf.drain()
    assert [r["market_id"] for r in rows] == ["m3", "m4"]


@pytest.mark.asyncio
async def test_overflow_drops_oldest_and_counts():
    buf = ActivityBuffer(maxlen=3)
    for i in range(5):
        await buf.add("e1", {"type": "buy_order", "data": {"marketId": f"m{i}"}})
    assert len(buf) == 3
    assert buf.take_dropped_count() == 2
    # counter resets
    assert buf.take_dropped_count() == 0
    rows = buf.drain()
    # newest 3 survive
    assert [r["market_id"] for r in rows] == ["m2", "m3", "m4"]


@pytest.mark.asyncio
async def test_row_shape_and_event_id_fallback():
    buf = ActivityBuffer()
    await buf.add("e-from-callback", {"type": "sell_order", "data": {"marketId": "m9"}})
    row = buf.drain()[0]
    assert row["market_id"] == "m9"
    assert row["event_id"] == "e-from-callback"
    assert row["msg_type"] == "sell_order"
    assert row["raw"]["type"] == "sell_order"


def test_extract_ids_variants():
    # marketId direct
    assert extract_activity_ids({"data": {"marketId": "m1", "eventId": "e1"}}) == ("m1", "e1")
    # nested market object
    m, e = extract_activity_ids({"data": {"market": {"id": "m2"}, "event": {"id": "e2"}}})
    assert (m, e) == ("m2", "e2")
    # nothing
    assert extract_activity_ids({"data": {}}) == ("", "")
    # non-dict data (defensive)
    assert extract_activity_ids({"data": "oops"}) == ("", "")


@pytest.mark.asyncio
async def test_drain_empty():
    buf = ActivityBuffer()
    assert buf.drain() == []
