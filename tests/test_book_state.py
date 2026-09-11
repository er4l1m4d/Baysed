"""Tests for Run 002 book-state serialization and snapshot context fields."""
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from bayse_bot.models import BTCFeatures, Market, OrderBook, BookLevel, Outcome
from bayse_bot.predictions import serialize_book, book_state_from_snapshot
from bayse_bot.snapshot import MarketSnapshot


def _book(levels_bids, levels_asks):
    return OrderBook(
        "m1", Outcome.YES,
        tuple(BookLevel(Decimal(p), Decimal(q)) for p, q in levels_bids),
        tuple(BookLevel(Decimal(p), Decimal(q)) for p, q in levels_asks),
        datetime.now(timezone.utc),
    )


def test_serialize_book_top_n_cap_and_ordering():
    bids = [("0.50", "10"), ("0.45", "20"), ("0.40", "30")]
    asks = [("0.55", "10"), ("0.60", "20"), ("0.70", "30")]
    book = _book(bids, asks)
    out = serialize_book(book, max_levels=2)
    # best-first, capped at 2 levels, string pairs
    assert out["bids"] == [["0.50", "10"], ["0.45", "20"]]
    assert out["asks"] == [["0.55", "10"], ["0.60", "20"]]


def test_serialize_book_none():
    assert serialize_book(None) is None


def test_book_state_none_when_no_books():
    snap = MarketSnapshot.from_market(_market(), _btc())
    assert snap is not None
    assert book_state_from_snapshot(snap) is None


def test_book_state_source_marker_and_one_sided():
    m = _market()
    btc = _btc()
    yes = _book([("0.50", "10")], [("0.55", "10")])
    # one-sided: NO book is None
    snap = MarketSnapshot.from_market(m, btc, yes_book=yes, no_book=None, book_source="ws")
    state = book_state_from_snapshot(snap)
    assert state["source"] == "ws"
    assert state["yes"]["bids"] == [["0.50", "10"]]
    assert state["no"] is None


def test_book_state_defaults_to_10_levels():
    levels = [(f"0.{i:02d}", "1") for i in range(5, 25)]
    book = _book(levels, levels)
    out = serialize_book(book)
    assert len(out["bids"]) == 10
    assert len(out["asks"]) == 10


def test_snapshot_context_fields_flow_through():
    m = _market()
    btc = _btc()
    snap = MarketSnapshot.from_market(
        m, btc,
        market_last_price=Decimal("0.62"),
        market_volume=Decimal("1250"),
        btc_daily_close=Decimal("77000.5"),
        coinbase_price=Decimal("77010.2"),
        yes_book_age_ms=123.4,
        no_book_age_ms=456.7,
        book_source="rest",
    )
    assert snap.market_last_price == Decimal("0.62")
    assert snap.market_volume == Decimal("1250")
    assert snap.btc_daily_close == Decimal("77000.5")
    assert snap.coinbase_price == Decimal("77010.2")
    assert snap.yes_book_age_ms == 123.4
    assert snap.no_book_age_ms == 456.7
    assert snap.book_source == "rest"
    # book_state is None with no books, source-marked with a book
    assert book_state_from_snapshot(snap) is None
    snap_with_book = MarketSnapshot.from_market(
        m, btc, yes_book=_book([("0.50", "10")], [("0.55", "10")]),
        book_source="rest",
    )
    state = book_state_from_snapshot(snap_with_book)
    assert state["source"] == "rest"


def _market():
    now = datetime.now(timezone.utc)
    return Market(
        event_id="e1",
        market_id="m1",
        title="Test Market",
        question="Up or down?",
        engine="binance",
        currency="USD",
        outcomes=("up", "down"),
        status="open",
        opens_at=now - timedelta(minutes=5),
        closes_at=now + timedelta(minutes=10),
        resolution_rules=None,
        resolution_source=None,
        strike_price=Decimal("77000"),
    )


def _btc():
    return BTCFeatures(
        Decimal("77100"), Decimal("0.1"), Decimal("1.0"), Decimal("0.02"),
        datetime.now(timezone.utc), True,
    )
