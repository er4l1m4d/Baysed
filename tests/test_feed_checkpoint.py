"""Tests for the BTC feed candle checkpoint (warm-up skip on restart)."""
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from bayse_bot.feed import BayseFeed, MarketState


BASE = datetime(2026, 9, 12, 10, 0, 0, tzinfo=timezone.utc)


def _pump(feed, n, start_price=100000):
    """Ingest n one-minute candles (finalizes ~n-1)."""
    for i in range(n):
        feed.ingest_tick(start_price + i, at=BASE + timedelta(minutes=i))


def test_finalized_count_increments_on_rollover():
    feed = BayseFeed(MarketState())
    _pump(feed, 10)
    assert feed.finalized_count == 9
    assert len(feed.candles) == 9


def test_serialize_roundtrip_preserves_values():
    feed = BayseFeed(MarketState())
    _pump(feed, 30)
    snap = feed.serialize_candles()
    assert len(snap) == 29  # last tick is still in the open accumulator
    t, p, v = snap[-1]
    assert Decimal(p) == Decimal(100028)
    assert datetime.fromisoformat(t).tzinfo is not None


def test_restore_skips_warmup_and_makes_features_complete():
    feed = BayseFeed(MarketState())
    _pump(feed, 30)
    snap = feed.serialize_candles()
    last_ts = datetime.fromisoformat(snap[-1][0])

    # A fresh feed starts incomplete
    fresh = BayseFeed(MarketState())
    assert fresh._compute_features(last_ts).complete is False

    # Restoring the checkpoint seeds the window
    assert fresh.restore_candles(snap, now=last_ts) is True
    assert len(fresh.candles) == 29
    # First live tick after restore -> features complete immediately
    fresh.ingest_tick(10050, at=last_ts + timedelta(seconds=5))
    assert fresh._compute_features(last_ts + timedelta(seconds=5)).complete is True


def test_restore_ignores_stale_checkpoint():
    feed = BayseFeed(MarketState())
    _pump(feed, 30)
    snap = feed.serialize_candles()
    last_ts = datetime.fromisoformat(snap[-1][0])
    fresh = BayseFeed(MarketState())
    # 10 minutes after the newest candle -> too old, warm up instead
    assert fresh.restore_candles(
        snap, now=last_ts + timedelta(minutes=10), max_age_seconds=300
    ) is False
    assert len(fresh.candles) == 0


def test_restore_rejects_empty_and_malformed():
    fresh = BayseFeed(MarketState())
    assert fresh.restore_candles(None) is False
    assert fresh.restore_candles([]) is False
    assert fresh.restore_candles([["not-a-timestamp", "x", "y"]]) is False
    assert len(fresh.candles) == 0


def test_restore_preserves_tick_count_volume_units():
    """The checkpoint must keep the feed's OWN tick-count volume, not exchange volume."""
    feed = BayseFeed(MarketState())
    # 5 ticks per candle minute -> each finalized candle has volume 5
    for i in range(6):
        for _ in range(5):
            feed.ingest_tick(100000 + i, at=BASE + timedelta(minutes=i, seconds=0))
    snap = feed.serialize_candles()
    # all finalized candles carry volume == 5 (tick count), confirming same-unit
    assert all(Decimal(v) == Decimal("5") for _, _, v in snap)
