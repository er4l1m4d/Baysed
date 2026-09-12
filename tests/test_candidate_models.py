"""Tests for Phase D model candidates (analysis/validation mirror).

These verify the candidate model math is sane and the Python mirror matches
the JS harness's reconstruction of the frozen baseline.
"""
import math
from datetime import datetime, timezone

import pytest

from bayse_bot.candidate_models import (
    BaselineModel,
    Hour0HedgeModel,
    MomentumBlendModel,
    VolHumilityModel,
    Features,
    normal_cdf,
    prob_baseline,
)


def _feat(dist, vol, sec, mom=0.0, hour=12, day=10):
    return Features(
        distance_from_strike_pct=dist,
        realized_volatility=vol,
        seconds_remaining=sec,
        momentum_pct=mom,
        recorded_at=datetime(2026, 9, day, hour, 0, 0, tzinfo=timezone.utc),
    )


def test_normal_cdf_symmetry():
    assert abs(normal_cdf(0) - 0.5) < 1e-9
    assert abs(normal_cdf(1) - (1 - normal_cdf(-1))) < 1e-9
    assert abs(normal_cdf(1) - 0.8413447) < 1e-6


def test_baseline_range_and_monotonic():
    lo = prob_baseline(-5.0, 0.2, 600)
    hi = prob_baseline(5.0, 0.2, 600)
    assert 0.01 <= lo <= 0.99
    assert 0.01 <= hi <= 0.99
    assert lo < 0.5 < hi
    # higher distance -> higher P(yes)
    assert prob_baseline(1.0, 0.2, 600) > prob_baseline(0.5, 0.2, 600)
    # longer time -> weaker signal (closer to 0.5) for same distance
    assert abs(prob_baseline(1.0, 0.2, 900) - 0.5) < abs(prob_baseline(1.0, 0.2, 60) - 0.5)


def test_baseline_matches_closed_form():
    # z = d / (v * sqrt(sec/60))
    d, v, s = 0.013, 0.03, 145
    z = d / (v * math.sqrt(s / 60))
    assert abs(prob_baseline(d, v, s) - normal_cdf(z)) < 1e-9


def test_all_candidates_in_range():
    f = _feat(0.02, 0.03, 400, mom=0.01)
    for m in (BaselineModel(), Hour0HedgeModel(), MomentumBlendModel(), VolHumilityModel()):
        p = m.probability(f)
        assert 0.01 <= p <= 0.99


def test_m1_hour0_pulls_toward_half():
    base = BaselineModel().probability(_feat(0.05, 0.03, 400))
    m1_hour0 = Hour0HedgeModel().probability(_feat(0.05, 0.03, 400, hour=0))
    m1_hour12 = Hour0HedgeModel().probability(_feat(0.05, 0.03, 400, hour=12))
    # at hour 0, probability is pulled toward 0.5 (closer than baseline)
    assert abs(m1_hour0 - 0.5) < abs(base - 0.5)
    # at other hours, unchanged from baseline
    assert abs(m1_hour12 - base) < 1e-12


def test_m3_blend_between_distance_and_momentum():
    # strong positive momentum, opposite distance sign -> blend sits between
    dist_p = BaselineModel().probability(_feat(-0.02, 0.03, 400))
    blended = MomentumBlendModel().probability(_feat(-0.02, 0.03, 400, mom=0.05))
    # momentum adds positive contribution, so blended > pure distance prob
    assert blended > dist_p


def test_m4_humility_widens_effective_vol():
    # low-vol regime -> humility widens vol -> probability pulled toward 0.5
    base = BaselineModel().probability(_feat(0.02, 0.1, 100))
    m4 = VolHumilityModel().probability(_feat(0.02, 0.1, 100))
    assert abs(m4 - 0.5) < abs(base - 0.5)
