"""Tests for gate v2 — executable-edge approval (Phase C)."""
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from bayse_bot.config import Settings
from bayse_bot.gate import (
    GATE_VERSION,
    breakeven_probability,
    calibrate_p_yes,
    evaluate_gate,
    slippage_from_book,
)
from bayse_bot.models import BTCFeatures, BookLevel, Market, OrderBook, Outcome
from bayse_bot.snapshot import MarketSnapshot


# ---------- calibration ----------

def test_calibration_overconfident_band_discounted():
    # 60-70% bucket: gap +0.0539 -> calibrated DOWN
    assert calibrate_p_yes(Decimal("0.65")) == Decimal("0.65") - Decimal("0.0539")


def test_calibration_underconfident_band_lifted():
    # 10-20% bucket: gap -0.0641 -> calibrated UP
    assert calibrate_p_yes(Decimal("0.15")) == Decimal("0.15") + Decimal("0.0641")


def test_calibration_clamps():
    assert calibrate_p_yes(Decimal("0.99")) == Decimal("0.99") - Decimal("0.0202") - Decimal("0")  # 0.9698, within range
    low = calibrate_p_yes(Decimal("0.01"))
    assert low >= Decimal("0.01")


def test_calibration_bucket_edges():
    # 0.599 -> bucket 5 (gap -0.0011); 0.60 -> bucket 6 (gap +0.0539)
    assert calibrate_p_yes(Decimal("0.599")) == Decimal("0.599") + Decimal("0.0011")
    assert calibrate_p_yes(Decimal("0.60")) == Decimal("0.60") - Decimal("0.0539")


# ---------- fee/breakeven math ----------

def test_breakeven_matches_strategy_convention():
    # Same as strategy.fee_adjusted_edge: p_be = P / (1 - 0.10*max(1-P, 0.5))
    # P=0.60: floor factor max(0.40, 0.5)=0.5 -> denom 0.95
    assert breakeven_probability(Decimal("0.60")) == Decimal("0.60") / Decimal("0.95")
    # P=0.30: floor factor max(0.70, 0.5)=0.70 -> denom 0.93
    assert breakeven_probability(Decimal("0.30")) == Decimal("0.30") / Decimal("0.93")


# ---------- slippage walk ----------

def _book(bids, asks):
    return OrderBook(
        "m1", Outcome.YES,
        tuple(BookLevel(Decimal(p), Decimal(q)) for p, q in bids),
        tuple(BookLevel(Decimal(p), Decimal(q)) for p, q in asks),
        datetime.now(timezone.utc),
    )


def test_slippage_flat_book():
    book = _book([("0.50", "10")], [("0.60", "100")])
    assert slippage_from_book(book, Decimal("10")) == Decimal("0")


def test_slippage_walks_levels():
    book = _book([("0.50", "10")], [("0.60", "5"), ("0.70", "5")])
    # 10 shares: 5 @ 0.60 + 5 @ 0.70 -> vwap 0.65, best 0.60 -> slip 0.05
    assert slippage_from_book(book, Decimal("10")) == Decimal("0.05")


def test_slippage_insufficient_depth_returns_none():
    book = _book([("0.50", "10")], [("0.60", "2")])
    assert slippage_from_book(book, Decimal("10")) is None
    assert slippage_from_book(None, Decimal("10")) is None


# ---------- gate evaluation ----------

def _snapshot(asks=(Decimal("0.80"), Decimal("0.23")), secs=300, hour=5, with_books=True):
    now = datetime(2026, 9, 12, hour, 15, 0, tzinfo=timezone.utc)
    yes_ask, no_ask = asks
    yes_book = _book([("0.78", "10")], [(str(yes_ask), "50")]) if with_books else None
    no_book = _book([("0.21", "10")], [(str(no_ask), "50")]) if with_books else None
    snap = MarketSnapshot.from_market(
        _market(now, secs),
        _btc(now),
        yes_book=yes_book,
        no_book=no_book,
        now=now,
        book_source="ws" if with_books else "",
    )
    return snap, now


def _market(now, secs=300):
    return Market(
        event_id="e1", market_id="m1", title="T", question="q", engine="binance",
        currency="USD", outcomes=("up", "down"), status="open",
        opens_at=now - timedelta(minutes=10), closes_at=now + timedelta(seconds=secs),
        resolution_rules=None, resolution_source=None, strike_price=Decimal("77000"),
    )


def _btc(now):
    return BTCFeatures(Decimal("77100"), Decimal("0.1"), Decimal("1"), Decimal("0.02"), now, True)


def test_gate_approves_genuine_positive_edge():
    snap, now = _snapshot(asks=(Decimal("0.80"), Decimal("0.23")))
    # model P(yes)=0.98 -> cal 0.9598; entry YES ask 0.80 ->
    # p_be = 0.80/0.95 = 0.8421 (floor factor 0.5 at P<=0.5... max(1-0.8,0.5)=0.5)
    # exec = 0.9598 - 0.8421 - 0.02 = ~0.0977
    res = evaluate_gate(snap, Decimal("0.98"), Decimal("1.0"), Settings(), now=now)
    assert res.approved is True
    assert res.reasons == ()
    assert res.gate_version == GATE_VERSION
    assert abs(res.exec_edge - Decimal("0.0977")) < Decimal("0.001")
    assert res.p_calibrated == Decimal("0.98") - Decimal("0.0202")


def test_gate_rejects_when_edge_below_minimum():
    # model 0.70 -> cal 0.6461; entry 0.68: p_be=0.68/0.95=0.7158 -> exec negative
    snap, now = _snapshot(asks=(Decimal("0.68"), Decimal("0.30")))
    res = evaluate_gate(snap, Decimal("0.70"), Decimal("1.0"), Settings(), now=now)
    assert res.approved is False
    assert "executable_edge_below_minimum" in res.reasons


def test_gate_guardrail_on_absurd_edge():
    # entry 0.10 with model 0.99: p_be=0.10/0.95=0.1053; exec = 0.9698-0.1053-0.02 = 0.845
    snap, now = _snapshot(asks=(Decimal("0.10"), Decimal("0.90")))
    res = evaluate_gate(snap, Decimal("0.99"), Decimal("1.0"), Settings(), now=now)
    assert res.approved is False
    assert "executable_edge_above_guardrail" in res.reasons


def test_gate_hour0_excluded():
    snap, now = _snapshot(hour=0)
    res = evaluate_gate(snap, Decimal("0.98"), Decimal("1.0"), Settings(), now=now)
    assert res.approved is False
    assert "model_regime_hour0_excluded" in res.reasons


def test_gate_strength_and_expiry_guards():
    snap, now = _snapshot()
    res = evaluate_gate(snap, Decimal("0.98"), Decimal("0.1"), Settings(), now=now)
    assert "signal_strength_below_minimum" in res.reasons

    # seconds_remaining < 60
    short_snap, short_now = _snapshot(secs=30)
    res3 = evaluate_gate(short_snap, Decimal("0.98"), Decimal("1.0"), Settings(), now=short_now)
    assert "too_close_to_expiry" in res3.reasons


def test_gate_missing_book_prices():
    snap, now = _snapshot(with_books=False)
    res = evaluate_gate(snap, Decimal("0.98"), Decimal("1.0"), Settings(), now=now)
    assert res.approved is False
    assert "missing_book_prices" in res.reasons
    assert res.exec_edge is None  # no entry ask -> no edge computable


def test_gate_cross_side_sum_off():
    # 0.95 + 0.60 = 1.55 -> outside [0.90, 1.10]
    snap, now = _snapshot(asks=(Decimal("0.95"), Decimal("0.60")))
    res = evaluate_gate(snap, Decimal("0.98"), Decimal("1.0"), Settings(), now=now)
    assert "cross_side_sum_off" in res.reasons


def test_gate_exec_edge_recorded_even_when_rejected():
    """Run 002 needs the full exec-edge distribution — rejection must not lose it."""
    snap, now = _snapshot(asks=(Decimal("0.68"), Decimal("0.30")))
    res = evaluate_gate(snap, Decimal("0.70"), Decimal("1.0"), Settings(), now=now)
    assert res.approved is False
    assert res.exec_edge is not None
    assert res.p_calibrated is not None


def test_gate_no_probability():
    snap, now = _snapshot()
    res = evaluate_gate(snap, None, Decimal("1.0"), Settings(), now=now)
    assert res.approved is False
    assert res.reasons == ("no_probability",)
    assert res.p_calibrated is None
