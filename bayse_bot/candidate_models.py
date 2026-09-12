"""Phase D model candidates — deployable mirror of analysis/model_candidates.js.

These are NOT wired into the production pipeline yet. They are fitted on
Run 001 (09-02..09-06) and validated out-of-sample on Run 002. The
calibration layer (bayse_bot.gate.calibrate_p_yes) remains the single
source of probability calibration; these candidates change MODEL STRUCTURE
only, so they compose with the existing gate.

Confirmed Run 001 baseline (frozen): P = Phi(d / (vol * sqrt(sec/60))).

Candidate models:
  M0  baseline            — the frozen distance-to-strike model
  M1  hour0_hedge         — shrink confidence toward 0.5 at UTC hour 0
  M3  momentum_blend      — blend distance prob with momentum prob
  M4  vol_humility        — widen effective vol in thin/low-vol/short-expiry

To deploy after Run 002 validation: swap the probability computation in
bayse_bot/strategy.py::DistanceToStrikeModel.evaluate to call the chosen
CandidateModel.probability(). Hyperparameters are the FITTED values from
analysis/data/model_candidates.json.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from math import erf, sqrt
from typing import Protocol

# Fitted hyperparameters (Phase D, Run 001 fit window 09-02..09-06).
# Phase D conclusion: no candidate robustly dominates the frozen baseline on
# the honest temporal split (eval window) — model structure is NOT the
# bottleneck (execution costs are; see Phase C). Treat these as documentation
# of the fitted values, not recommendations to deploy. Re-fit on Run 002
# before any deployment decision.
FITTED = {
    "M1_hour0_hedge": {"h": Decimal("0.1")},
    "M3_momentum_blend": {"w": Decimal("0.1")},
    "M4_vol_humility": {"f": Decimal("1.5"), "T": 300, "V": Decimal("0.15")},
}


def normal_cdf(z: float) -> float:
    return 0.5 * (1 + erf(z / sqrt(2)))


def _clamp01(p: float) -> float:
    return max(0.01, min(0.99, p))


def prob_baseline(
    distance_from_strike_pct: float,
    realized_volatility: float,
    seconds_remaining: int,
) -> float:
    """Frozen distance-to-strike v2 model. Mirrors strategy.py exactly."""
    if not (realized_volatility > 0) or seconds_remaining <= 0:
        return _clamp01(0.5 + distance_from_strike_pct * 4)
    z = distance_from_strike_pct / (realized_volatility * sqrt(seconds_remaining / 60))
    return _clamp01(normal_cdf(z))


@dataclass
class Features:
    """Raw snapshot features needed to compute candidate probabilities."""
    distance_from_strike_pct: float
    realized_volatility: float
    seconds_remaining: int
    momentum_pct: float
    recorded_at: datetime


class CandidateModel(Protocol):
    name: str
    label: str

    def probability(self, f: Features) -> float:
        """Return raw model probability P(yes) in [0.01, 0.99]."""
        ...


class BaselineModel:
    """M0 — frozen distance_to_strike_v2."""

    name = "M0_baseline"
    label = "distance_to_strike_v2 (frozen)"

    def probability(self, f: Features) -> float:
        return prob_baseline(
            f.distance_from_strike_pct, f.realized_volatility, f.seconds_remaining
        )


class Hour0HedgeModel:
    """M1 — shrink confidence toward 0.5 at UTC hour 0 (h via FITTED)."""

    name = "M1_hour0_hedge"
    label = "baseline + hour-0 humility"

    def __init__(self, h: Decimal | None = None):
        self.h = float(h if h is not None else FITTED["M1_hour0_hedge"]["h"])

    def probability(self, f: Features) -> float:
        base = prob_baseline(
            f.distance_from_strike_pct, f.realized_volatility, f.seconds_remaining
        )
        hour = f.recorded_at.astimezone(timezone.utc).hour
        if hour == 0:
            return _clamp01(0.5 + (base - 0.5) * (1 - self.h))
        return base


class MomentumBlendModel:
    """M3 — blend distance prob with momentum prob (w via FITTED)."""

    name = "M3_momentum_blend"
    label = "distance + momentum blend"

    def __init__(self, w: Decimal | None = None):
        self.w = float(w if w is not None else FITTED["M3_momentum_blend"]["w"])

    def probability(self, f: Features) -> float:
        dist = prob_baseline(
            f.distance_from_strike_pct, f.realized_volatility, f.seconds_remaining
        )
        mom = _clamp01(0.5 + f.momentum_pct * 4)
        return _clamp01((1 - self.w) * dist + self.w * mom)


class VolHumilityModel:
    """M4 — widen effective vol in thin/low-vol/short-expiry regimes."""

    name = "M4_vol_humility"
    label = "distance + vol-scaling humility"

    def __init__(self, f_mul: Decimal | None = None, T: int | None = None, V: Decimal | None = None):
        p = FITTED["M4_vol_humility"]
        self.f = float(f_mul if f_mul is not None else p["f"])
        self.T = int(T if T is not None else p["T"])
        self.V = float(V if V is not None else p["V"])

    def probability(self, f: Features) -> float:
        v = f.realized_volatility
        if f.seconds_remaining < self.T or v < self.V:
            v = v * self.f
        if not (v > 0) or f.seconds_remaining <= 0:
            return _clamp01(0.5 + f.distance_from_strike_pct * 4)
        z = f.distance_from_strike_pct / (v * sqrt(f.seconds_remaining / 60))
        return _clamp01(normal_cdf(z))


MODELS: dict[str, CandidateModel] = {
    m.name: m
    for m in (BaselineModel(), Hour0HedgeModel(), MomentumBlendModel(), VolHumilityModel())
}
