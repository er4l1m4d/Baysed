"""Tests for data integrity refactor — resolution mapping and prediction records."""
from datetime import datetime, timezone
from decimal import Decimal


def test_outcome_mapping():
    """Bayse resolvedOutcomeId maps correctly to our outcome labels."""
    from bayse_bot.predictions import outcome_from_bayse_resolved, PredictionOutcome

    # outcome1_id maps to YES_WON
    assert outcome_from_bayse_resolved("o1", "o1", "o2") == PredictionOutcome.YES_WON.value
    # outcome2_id maps to NO_WON
    assert outcome_from_bayse_resolved("o2", "o1", "o2") == PredictionOutcome.NO_WON.value
    # unknown ID maps to EXPIRED
    assert outcome_from_bayse_resolved("unknown", "o1", "o2") == PredictionOutcome.EXPIRED.value
    # None IDs map to EXPIRED
    assert outcome_from_bayse_resolved("o1", None, None) == PredictionOutcome.EXPIRED.value


def test_prediction_record_new_fields():
    """PredictionRecord includes all new fields with correct defaults."""
    from bayse_bot.predictions import PredictionRecord, PredictionOutcome

    pred = PredictionRecord(
        market_id="m1",
        event_id="e1",
        title="Test",
        strike_price=Decimal("100"),
        current_btc_price=Decimal("101"),
        distance_from_strike_pct=Decimal("1.0"),
        is_above_strike=True,
        seconds_remaining=300,
        seconds_elapsed=600,
        realized_volatility=Decimal("0.05"),
        momentum_pct=Decimal("0.01"),
    )

    # New timestamp fields should be auto-set
    assert pred.observed_at is not None
    assert pred.decided_at is not None
    assert pred.recorded_at is not None

    # Contract timing defaults
    assert pred.opened_at is None
    assert pred.closes_at is None
    assert pred.volume_ratio == Decimal("0")

    # Outcome IDs
    assert pred.outcome1_id == ""
    assert pred.outcome2_id == ""

    # Resolution
    assert pred.outcome_resolution == PredictionOutcome.PENDING.value
    assert pred.resolved_outcome_id is None


def test_prediction_record_to_db_dict():
    """to_db_dict serializes all new fields correctly."""
    from bayse_bot.predictions import PredictionRecord

    now = datetime.now(timezone.utc)
    pred = PredictionRecord(
        market_id="m1",
        event_id="e1",
        title="Test",
        strike_price=Decimal("100"),
        current_btc_price=Decimal("101"),
        distance_from_strike_pct=Decimal("1.0"),
        is_above_strike=True,
        seconds_remaining=300,
        seconds_elapsed=600,
        realized_volatility=Decimal("0.05"),
        momentum_pct=Decimal("0.01"),
        observed_at=now,
        decided_at=now,
        opened_at=now,
        closes_at=now,
        volume_ratio=Decimal("1.5"),
        outcome1_id="oid1",
        outcome2_id="oid2",
        resolved_outcome_id="oid1",
    )

    d = pred.to_db_dict()

    # New fields present
    assert "observed_at" in d
    assert "decided_at" in d
    assert "opened_at" in d
    assert "closes_at" in d
    assert "volume_ratio" in d
    assert "outcome1_id" in d
    assert "outcome2_id" in d
    assert "resolved_outcome_id" in d

    # Values correct
    assert d["outcome1_id"] == "oid1"
    assert d["outcome2_id"] == "oid2"
    assert d["resolved_outcome_id"] == "oid1"
    assert d["volume_ratio"] == "1.5"  # Decimal serialized as string


def test_event_type_enum():
    """EventType enum has all expected values."""
    from bayse_bot.models import EventType

    assert EventType.CANDIDATE_REJECTED == "candidate_rejected"
    assert EventType.BOOK_ISSUES == "book_issues"
    assert EventType.MARKET_EVALUATED == "market_evaluated"
    assert EventType.MARKET_EVALUATION_FAILURE == "market_evaluation_failure"
    assert EventType.SCAN_FAILURE == "scan_failure"
    assert EventType.TRADE_ATTEMPT_FAILED == "trade_attempt_failed"
    assert EventType.LIVE_ORDER_AMBIGUOUS == "live_order_ambiguous"
    assert EventType.RESOLUTION_PROCESSED == "resolution_processed"
    assert EventType.PREDICTION_RECORDED == "prediction_recorded"
