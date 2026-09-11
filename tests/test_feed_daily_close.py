"""Tests for UTC daily-close capture in BayseFeed (Run 002 midnight instrumentation)."""
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from bayse_bot.feed import BayseFeed, MarketState


def _feed() -> tuple[BayseFeed, MarketState]:
    state = MarketState()
    feed = BayseFeed(state, candle_window_seconds=60)
    return feed, state


def test_daily_close_defaults_to_none():
    _, state = _feed()
    assert state.btc_daily_close is None


def test_first_tick_after_startup_does_not_set_daily_close():
    """Startup is not midnight — the first observed day change must be ignored."""
    feed, state = _feed()
    feed.ingest_tick("77000", at=datetime(2026, 9, 10, 15, 0, 0, tzinfo=timezone.utc))
    assert state.btc_daily_close is None


def test_daily_close_captured_on_utc_rollover():
    feed, state = _feed()
    # Prime the day (startup)
    feed.ingest_tick("77000", at=datetime(2026, 9, 10, 23, 59, 0, tzinfo=timezone.utc))
    assert state.btc_daily_close is None
    # Genuine rollover: first tick of 2026-09-11
    feed.ingest_tick("77123.45", at=datetime(2026, 9, 11, 0, 0, 2, tzinfo=timezone.utc))
    assert state.btc_daily_close == Decimal("77123.45")


def test_daily_close_updates_each_rollover():
    feed, state = _feed()
    feed.ingest_tick("77000", at=datetime(2026, 9, 9, 12, 0, 0, tzinfo=timezone.utc))
    feed.ingest_tick("77001", at=datetime(2026, 9, 10, 0, 0, 1, tzinfo=timezone.utc))
    assert state.btc_daily_close == Decimal("77001")
    feed.ingest_tick("77002", at=datetime(2026, 9, 11, 0, 0, 1, tzinfo=timezone.utc))
    assert state.btc_daily_close == Decimal("77002")


def test_same_day_ticks_do_not_touch_daily_close():
    feed, state = _feed()
    feed.ingest_tick("77000", at=datetime(2026, 9, 10, 12, 0, 0, tzinfo=timezone.utc))
    feed.ingest_tick("77100", at=datetime(2026, 9, 10, 13, 30, 0, tzinfo=timezone.utc))
    assert state.btc_daily_close is None
