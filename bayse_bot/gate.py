"""Approval gate v2 — execution-aware expected value.

Replaces the Run-001 disagreement gate, which was measurably anti-selective
(approved signals 66.2% accuracy vs 76.7% for everything it rejected,
t = -2.61 at the market level; see analysis/RUN_001_REPORT.md §6).

Design (evidence-first, from Run 001 + Phase C backtests):

  1. CALIBRATION — model probability is discounted by its measured
     bucket bias before any comparison with price. The model is
     overconfident in the 60-90% band (+3 to +6 pts) and underconfident
     below 30%; a gate that trusts raw probability harvests exactly
     those errors.
  2. FEES — breakeven probability uses the Bayse fee convention
     (matches strategy.fee_adjusted_edge): p_be = price / (1 - 0.10 *
     max(1 - price, 0.5)).
  3. SLIPPAGE — conservative buffer, floor-set from measured book depth
     (median walk-10 slippage 2.2c, p90 46c; analysis/depth_measurement).
     When the book object is available the buffer is raised to the
     actual VWAP-walk estimate if that is worse.
  4. GUARDS — two-sided sane book, signal strength, time-to-expiry,
     hour-0 UTC exclusion (measured model-regime anomaly: 32.7% wrong
     rate, 6/8 nights), and an upper guardrail on executable edge
     (an absurd edge means a stale book, not free money).

Backtest verdict (analysis/data/gate_backtest.json, temporal split):
no taker configuration is profitable on Run 001 data — the best honest
cell reaches -4.6%/trade vs the old gate's -18.7%. The gate therefore
approves ~nothing on current evidence, which is CORRECT behavior: its
Run-002 job is to record the executable-edge distribution on every
snapshot and flag only genuinely +EV-after-all-costs candidates.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal

from .config import Settings
from .models import OrderBook
from .snapshot import MarketSnapshot

GATE_VERSION = "v2_exec_edge"

FEE_RATE = Decimal("0.10")

# Slippage buffer for the default order size (10 shares). Depth-measured
# 2026-09-12 on live two-sided books (n=300): median walk-10 slip 0.022,
# p90 0.46, 13.8% of books cannot fill 10 at all. Conservative floor;
# raised by the actual book walk when that is worse.
DEFAULT_SLIP_BUFFER = Decimal("0.02")
TARGET_WALK_SIZE = Decimal("10")

# Run-001 core calibration gaps, fitted 2026-09-10 on 22,481 modeled
# snapshots (2026-09-02..2026-09-10). gap = avg_predicted - actual_rate
# per 0.1 bucket of P(yes). Calibrated: p_cal = p - gap(bucket).
# Out-of-sample validation happens in Run 002 — do NOT refit mid-run.
CALIBRATION_GAPS = (
    Decimal("-0.0314"),  # 0-10%   (underconfident)
    Decimal("-0.0641"),  # 10-20%  (underconfident)
    Decimal("-0.0122"),  # 20-30%
    Decimal("0.0080"),   # 30-40%
    Decimal("-0.0249"),  # 40-50%
    Decimal("-0.0011"),  # 50-60%
    Decimal("0.0539"),   # 60-70%  (overconfident)
    Decimal("0.0317"),   # 70-80%  (overconfident)
    Decimal("0.0560"),   # 80-90%  (overconfident)
    Decimal("0.0202"),   # 90-100%
)

# Cross-side sanity band for a tradable two-sided book: yes_ask + no_ask
# outside this means at least one side is stale or broken (Run 001 showed
# "edge" against such books is an artifact, not opportunity).
CROSS_SIDE_MIN = Decimal("0.90")
CROSS_SIDE_MAX = Decimal("1.10")


def calibrate_p_yes(p: Decimal) -> Decimal:
    """Calibrated P(yes): model probability discounted by measured bucket bias."""
    if p is None:
        return None
    x = float(p)
    if x < 0:
        x = 0.0
    elif x >= 1:
        x = 0.999999
    bucket = min(9, int(x * 10))
    p_cal = p - CALIBRATION_GAPS[bucket]
    if p_cal < Decimal("0.01"):
        return Decimal("0.01")
    if p_cal > Decimal("0.99"):
        return Decimal("0.99")
    return p_cal


def breakeven_probability(price: Decimal) -> Decimal:
    """Break-even model probability at `price` incl. Bayse fees.

    Same convention as strategy.fee_adjusted_edge: a model probability
    above this is +EV before slippage.
    """
    floor_factor = max(Decimal("1") - price, Decimal("0.5"))
    denom = Decimal("1") - FEE_RATE * floor_factor
    if denom <= 0:
        return Decimal("1")
    return price / denom


def slippage_from_book(book: OrderBook | None, size: Decimal) -> Decimal | None:
    """VWAP-walk slippage for `size` shares on the ask side of `book`.

    Returns (vwap - best_ask), or None when displayed depth cannot fill
    the size at all (which is itself the worst kind of slippage — the
    caller's conservative floor applies).
    """
    if book is None or not book.asks:
        return None
    best = book.asks[0].price
    remaining = size
    cost = Decimal("0")
    for level in book.asks:
        take = remaining if remaining < level.quantity else level.quantity
        cost += take * level.price
        remaining -= take
        if remaining <= Decimal("0.000001"):
            break
    if remaining > Decimal("0.000001"):
        return None
    return cost / size - best


@dataclass(frozen=True)
class GateResult:
    approved: bool
    reasons: tuple[str, ...]
    p_calibrated: Decimal | None
    exec_edge: Decimal | None
    gate_version: str = GATE_VERSION


def evaluate_gate(
    snapshot: MarketSnapshot,
    probability: Decimal | None,
    strength: Decimal,
    settings: Settings,
    now: datetime | None = None,
) -> GateResult:
    """Evaluate the executable-edge gate for one snapshot.

    exec_edge is computed whenever the predicted side has an ask — even
    for rejected rows — so Run 002 records its full distribution.
    Approval requires ALL guards to pass and exec_edge strictly inside
    (min_exec_edge, max_exec_edge).
    """
    if probability is None:
        return GateResult(False, ("no_probability",), None, None)

    snap = snapshot
    reasons: list[str] = []

    p_cal = calibrate_p_yes(probability)
    predicts_yes = probability > Decimal("0.5")
    entry = snap.yes_ask if predicts_yes else snap.no_ask
    entry_book = snap.yes_book if predicts_yes else snap.no_book

    exec_edge: Decimal | None = None
    if entry is not None:
        p_entry_cal = p_cal if predicts_yes else Decimal("1") - p_cal
        p_be = breakeven_probability(entry)
        slip = DEFAULT_SLIP_BUFFER
        book_slip = slippage_from_book(entry_book, TARGET_WALK_SIZE)
        if book_slip is not None and book_slip > slip:
            slip = book_slip
        exec_edge = p_entry_cal - p_be - slip

    # --- Guards ---
    if snap.yes_ask is None or snap.no_ask is None:
        reasons.append("missing_book_prices")
    else:
        cross_sum = snap.yes_ask + snap.no_ask
        if cross_sum < CROSS_SIDE_MIN or cross_sum > CROSS_SIDE_MAX:
            reasons.append("cross_side_sum_off")

    if strength < settings.min_strength:
        reasons.append("signal_strength_below_minimum")
    if snap.seconds_remaining < 60:
        reasons.append("too_close_to_expiry")

    when = now or snap.observed_at
    if when is not None:
        hour = when.astimezone(timezone.utc).hour if when.tzinfo else when.hour
        if hour == 0:
            reasons.append("model_regime_hour0_excluded")

    if exec_edge is None:
        # entry ask missing — already flagged via missing_book_prices
        pass
    elif exec_edge <= settings.min_exec_edge:
        reasons.append("executable_edge_below_minimum")
    elif exec_edge >= settings.max_exec_edge:
        reasons.append("executable_edge_above_guardrail")

    return GateResult(
        approved=not reasons,
        reasons=tuple(reasons),
        p_calibrated=p_cal,
        exec_edge=exec_edge,
    )
