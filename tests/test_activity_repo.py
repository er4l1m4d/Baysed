"""Integration test for MarketActivityRepository on SQLite.

Also exercises the repositories/__init__.py URL handling with a plain
SQLite URL (no query string) — the path that was broken by the urlunparse
mangling bug (see error.md 2026-09-10).
"""
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio


@pytest_asyncio.fixture
async def repos(tmp_path):
    from bayse_bot.repositories import create_repositories

    url = f"sqlite+aiosqlite:///{tmp_path}/test.db"
    repo_set = await create_repositories(url)
    yield repo_set


@pytest.mark.asyncio
async def test_activity_roundtrip(repos):
    rows = [
        {"market_id": "m1", "event_id": "e1", "msg_type": "buy_order",
         "raw": {"type": "buy_order", "data": {"marketId": "m1", "price": "0.55"}}},
        {"market_id": "m2", "event_id": "e1", "msg_type": "sell_order",
         "raw": {"type": "sell_order", "data": {"marketId": "m2"}}},
    ]
    await repos.activity.insert_batch(rows)

    out = await repos.activity.get_activity(limit=10)
    assert len(out) == 2
    # newest first; raw payload preserved
    assert out[0]["msg_type"] == "sell_order"
    assert out[0]["raw"]["data"]["marketId"] == "m2"
    assert out[1]["raw"]["data"]["price"] == "0.55"
    assert out[1]["market_id"] == "m1"
    # recorded_at present
    assert out[0]["recorded_at"]


@pytest.mark.asyncio
async def test_activity_filter_by_market(repos):
    await repos.activity.insert_batch([
        {"market_id": "m1", "event_id": "e1", "msg_type": "buy_order", "raw": {}},
        {"market_id": "m2", "event_id": "e1", "msg_type": "buy_order", "raw": {}},
    ])
    out = await repos.activity.get_activity(limit=10, market_id="m1")
    assert len(out) == 1
    assert out[0]["market_id"] == "m1"


@pytest.mark.asyncio
async def test_activity_insert_empty_batch(repos):
    await repos.activity.insert_batch([])
    out = await repos.activity.get_activity(limit=10)
    assert out == []


@pytest.mark.asyncio
async def test_activity_prune(repos):
    # Insert with recorded_at in the past via direct SQL (bypasses the
    # insert_batch now() default) to test the cutoff delete.
    from sqlalchemy import text

    session = repos._session_factory()
    old = datetime.now(timezone.utc) - timedelta(hours=72)
    fresh = datetime.now(timezone.utc)
    async with session.begin():
        await session.execute(
            text("INSERT INTO market_activity (market_id, event_id, msg_type, raw, recorded_at) "
                 "VALUES ('old', 'e', 'buy_order', '{}', :t)"),
            {"t": old},
        )
        await session.execute(
            text("INSERT INTO market_activity (market_id, event_id, msg_type, raw, recorded_at) "
                 "VALUES ('fresh', 'e', 'buy_order', '{}', :t)"),
            {"t": fresh},
        )
    await session.close()

    deleted = await repos.activity.prune_older_than(hours=48)
    assert deleted == 1
    out = await repos.activity.get_activity(limit=10)
    assert len(out) == 1
    assert out[0]["market_id"] == "fresh"


@pytest.mark.asyncio
async def test_prediction_save_with_book_state(repos):
    """Full prediction roundtrip incl. the Run 002 book_state JSON column."""
    from bayse_bot.predictions import PredictionRecord

    pred = PredictionRecord(
        market_id="m1",
        event_id="e1",
        title="Test",
        strike_price="77000",
        current_btc_price="77100",
        distance_from_strike_pct="0.13",
        is_above_strike=True,
        seconds_remaining=300,
        seconds_elapsed=600,
        realized_volatility="0.02",
        momentum_pct="0.01",
        book_state={
            "source": "ws",
            "yes": {"bids": [["0.50", "10"]], "asks": [["0.55", "20"]]},
            "no": None,
        },
        yes_book_age_ms=123.4,
        market_price="0.62",
        market_volume="1250",
        btc_daily_close="77000.5",
        coinbase_btc_price="77010.2",
    )
    await repos.predictions.save_prediction(pred.to_db_dict())

    out = await repos.predictions.get_latest_prediction("m1")
    assert out is not None
    assert out["book_state"]["source"] == "ws"
    assert out["book_state"]["yes"]["asks"] == [["0.55", "20"]]
    assert out["book_state"]["no"] is None
    assert out["market_price"] == 0.62
    assert out["market_volume"] == 1250.0
    assert out["btc_daily_close"] == 77000.5
    assert out["coinbase_btc_price"] == 77010.2
    # yes_book_age_ms roundtrips through Numeric
    assert out["yes_book_age_ms"] is not None
    assert abs(out["yes_book_age_ms"] - 123.4) < 0.01
