"""Integration test: feed_state repository round-trip on SQLite."""
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
import pytest_asyncio

from bayse_bot.feed import BayseFeed, MarketState


@pytest_asyncio.fixture
async def repos(tmp_path):
    from bayse_bot.repositories import create_repositories

    repo_set = await create_repositories(f"sqlite+aiosqlite:///{tmp_path}/test.db")
    yield repo_set


def _pump(feed, n):
    base = datetime(2026, 9, 12, 10, 0, 0, tzinfo=timezone.utc)
    for i in range(n):
        feed.ingest_tick(100000 + i, at=base + timedelta(minutes=i))


@pytest.mark.asyncio
async def test_save_load_roundtrip(repos):
    feed = BayseFeed(MarketState())
    _pump(feed, 30)
    snap = feed.serialize_candles()

    await repos.feed_state.save_candles(snap)
    loaded = await repos.feed_state.load_candles()
    assert loaded == snap
    assert len(loaded) == 29


@pytest.mark.asyncio
async def test_load_empty_returns_none(repos):
    assert await repos.feed_state.load_candles() is None


@pytest.mark.asyncio
async def test_save_upsert_overwrites_single_row(repos):
    await repos.feed_state.save_candles([["t1", "1", "1"]])
    await repos.feed_state.save_candles([["t1", "1", "1"], ["t2", "2", "2"]])
    loaded = await repos.feed_state.load_candles()
    assert len(loaded) == 2  # one row, overwritten


@pytest.mark.asyncio
async def test_restart_rehydrates_features_from_repo(repos):
    """Simulate a restart: one feed writes a checkpoint, a new feed restores it."""
    src = BayseFeed(MarketState())
    _pump(src, 30)
    await repos.feed_state.save_candles(src.serialize_candles())

    # New process
    dst = BayseFeed(MarketState())
    checkpoint = await repos.feed_state.load_candles()
    assert dst.restore_candles(checkpoint) is True
    last = datetime.fromisoformat(checkpoint[-1][0])
    dst.ingest_tick(100099, at=last + timedelta(seconds=3))
    assert dst._compute_features(last + timedelta(seconds=3)).complete is True
