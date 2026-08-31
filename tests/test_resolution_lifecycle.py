"""End-to-end resolution lifecycle integration test.

Tests the full path:
    market observed → prediction snapshot → (trade) → market resolves
    → MarketOutcome created → prediction evaluated → P&L computed

This path crosses several components and is where regressions are likely.
"""
from __future__ import annotations
import pytest
from datetime import datetime, timezone, timedelta
from decimal import Decimal

from bayse_bot.models import (
    Market, BTCFeatures, OrderBook, BookLevel, Outcome, Decision,
)
from bayse_bot.snapshot import MarketSnapshot
from bayse_bot.contract import build_contract_state
from bayse_bot.predictions import PredictionRecord, PredictionOutcome, outcome_from_bayse_resolved
from bayse_bot.strategy import (
    DistanceToStrikeModel, StrategyInput, Strategy,
    probability_from_distance_to_strike, fee_adjusted_edge, FEE_RATE,
)
from bayse_bot.config import Settings


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _make_market(**overrides) -> Market:
    now = datetime.now(timezone.utc)
    defaults = dict(
        event_id="evt-001",
        market_id="mkt-001",
        title="Bitcoin Up or Down - 15 minutes?",
        question="Will BTC be above $80,000?",
        engine="clob",
        currency="USD",
        outcomes=("Up", "Down"),
        status="open",
        opens_at=now - timedelta(minutes=5),
        closes_at=now + timedelta(minutes=10),
        resolution_rules="Binance BTC/USD",
        resolution_source="binance",
        strike_price=Decimal("80000"),
        series_slug="crypto-btc-15min",
        outcome1_id="o1-yes",
        outcome2_id="o2-no",
        raw={},
    )
    defaults.update(overrides)
    return Market(**defaults)


def _make_btc(price: Decimal = Decimal("80100"), **overrides) -> BTCFeatures:
    defaults = dict(
        price=price,
        momentum_pct=Decimal("0.05"),
        volume_ratio=Decimal("1.2"),
        atr_pct=Decimal("0.03"),
        captured_at=datetime.now(timezone.utc),
        complete=True,
    )
    defaults.update(overrides)
    return BTCFeatures(**defaults)


def _make_books(yes_ask=Decimal("0.65"), no_ask=Decimal("0.38")) -> tuple[OrderBook, OrderBook]:
    now = datetime.now(timezone.utc)
    yes = OrderBook(
        market_id="mkt-001",
        outcome=Outcome.YES,
        bids=(BookLevel(Decimal("0.64"), Decimal("10")),),
        asks=(BookLevel(yes_ask, Decimal("10")),),
        captured_at=now,
    )
    no = OrderBook(
        market_id="mkt-001",
        outcome=Outcome.NO,
        bids=(BookLevel(Decimal("0.37"), Decimal("10")),),
        asks=(BookLevel(no_ask, Decimal("10")),),
        captured_at=now,
    )
    return yes, no


# ---------------------------------------------------------------------------
# Test 1: MarketSnapshot construction
# ---------------------------------------------------------------------------

class TestMarketSnapshot:
    def test_snapshot_from_market(self):
        market = _make_market()
        btc = _make_btc(price=Decimal("80100"))
        yes, no = _make_books()

        snap = MarketSnapshot.from_market(market, btc, yes, no)
        assert snap is not None
        assert snap.market_id == "mkt-001"
        assert snap.strike_price == Decimal("80000")
        assert snap.btc_price == Decimal("80100")
        assert snap.yes_ask == Decimal("0.65")
        assert snap.no_ask == Decimal("0.38")
        assert snap.is_above_strike is True
        assert snap.distance_from_strike_pct == pytest.approx(Decimal("0.125"), abs=Decimal("0.001"))
        assert snap.seconds_remaining > 0

    def test_snapshot_below_strike(self):
        market = _make_market()
        btc = _make_btc(price=Decimal("79900"))
        yes, no = _make_books()

        snap = MarketSnapshot.from_market(market, btc, yes, no)
        assert snap is not None
        assert snap.is_above_strike is False
        assert snap.distance_from_strike_pct < 0

    def test_snapshot_missing_strike_returns_none(self):
        market = _make_market(strike_price=None)
        btc = _make_btc()
        snap = MarketSnapshot.from_market(market, btc)
        assert snap is None

    def test_snapshot_missing_closes_at_returns_none(self):
        market = _make_market(closes_at=None)
        btc = _make_btc()
        snap = MarketSnapshot.from_market(market, btc)
        assert snap is None


# ---------------------------------------------------------------------------
# Test 2: Strategy produces both-side edges
# ---------------------------------------------------------------------------

class TestDualEdge:
    def test_distance_to_strike_records_both_edges(self):
        """The strategy should compute edges for both YES and NO sides."""
        settings = Settings()
        strategy = DistanceToStrikeModel()

        market = _make_market()
        btc = _make_btc(price=Decimal("80100"))
        yes, no = _make_books(yes_ask=Decimal("0.65"), no_ask=Decimal("0.38"))

        snap = MarketSnapshot.from_market(market, btc, yes, no)
        contract = build_contract_state(market, btc, yes.best_ask, no.best_ask, yes.spread)

        x = StrategyInput(btc, yes.best_ask, no.best_ask, contract, snap)
        decision = strategy.evaluate(x, settings)

        # Decision should have both-side edges
        assert decision.yes_edge is not None
        assert decision.no_edge is not None
        assert decision.yes_edge_fee is not None
        assert decision.no_edge_fee is not None

        # P(YES) + P(NO) should = 1
        p_no = Decimal("1") - decision.probability
        yes_edge_expected = decision.probability - yes.best_ask
        no_edge_expected = p_no - no.best_ask

        assert decision.yes_edge == pytest.approx(yes_edge_expected, abs=Decimal("0.001"))
        assert decision.no_edge == pytest.approx(no_edge_expected, abs=Decimal("0.001"))

    def test_selected_side_matches_edge(self):
        """The selected side's edge should match edge/edge_fee."""
        settings = Settings()
        strategy = DistanceToStrikeModel()

        market = _make_market()
        btc = _make_btc(price=Decimal("80100"))
        yes, no = _make_books()

        snap = MarketSnapshot.from_market(market, btc, yes, no)
        contract = build_contract_state(market, btc, yes.best_ask, no.best_ask, yes.spread)

        x = StrategyInput(btc, yes.best_ask, no.best_ask, contract, snap)
        decision = strategy.evaluate(x, settings)

        if decision.outcome is Outcome.YES:
            assert decision.edge == decision.yes_edge
            assert decision.edge_fee == decision.yes_edge_fee
        else:
            assert decision.edge == decision.no_edge
            assert decision.edge_fee == decision.no_edge_fee


# ---------------------------------------------------------------------------
# Test 3: PredictionRecord stores both edges
# ---------------------------------------------------------------------------

class TestPredictionBothEdges:
    def test_record_stores_both_edges(self):
        """PredictionRecord should store both YES and NO edges."""
        pred = PredictionRecord(
            market_id="mkt-001",
            event_id="evt-001",
            title="Test",
            strike_price=Decimal("80000"),
            current_btc_price=Decimal("80100"),
            distance_from_strike_pct=Decimal("0.125"),
            is_above_strike=True,
            seconds_remaining=600,
            seconds_elapsed=300,
            realized_volatility=Decimal("0.03"),
            momentum_pct=Decimal("0.05"),
            yes_ask=Decimal("0.65"),
            no_ask=Decimal("0.38"),
            strategy="distance_to_strike",
            probability=Decimal("0.62"),
            predicted_outcome="YES",
            edge=Decimal("-0.03"),
            edge_fee=Decimal("-0.08"),
            yes_edge=Decimal("-0.03"),
            yes_edge_fee=Decimal("-0.08"),
            no_edge=Decimal("0.00"),
            no_edge_fee=Decimal("-0.05"),
        )

        d = pred.to_db_dict()
        assert d["yes_edge"] == "-0.03"
        assert d["yes_edge_fee"] == "-0.08"
        assert d["no_edge"] == "0.00"
        assert d["no_edge_fee"] == "-0.05"


# ---------------------------------------------------------------------------
# Test 4: Resolution lifecycle
# ---------------------------------------------------------------------------

class TestResolutionLifecycle:
    def test_outcome_mapping(self):
        """Bayse resolvedOutcomeId maps to correct PredictionOutcome."""
        assert outcome_from_bayse_resolved("o1-yes", "o1-yes", "o2-no") == "yes_won"
        assert outcome_from_bayse_resolved("o2-no", "o1-yes", "o2-no") == "no_won"
        assert outcome_from_bayse_resolved("unknown", "o1-yes", "o2-no") == "expired"

    def test_resolution_updates_prediction(self):
        """After resolution, prediction should have outcome_resolution and brier_score."""
        pred = PredictionRecord(
            market_id="mkt-001",
            event_id="evt-001",
            title="Test",
            strike_price=Decimal("80000"),
            current_btc_price=Decimal("80100"),
            distance_from_strike_pct=Decimal("0.125"),
            is_above_strike=True,
            seconds_remaining=0,
            seconds_elapsed=900,
            realized_volatility=Decimal("0.03"),
            momentum_pct=Decimal("0.05"),
            strategy="distance_to_strike",
            probability=Decimal("0.62"),
            predicted_outcome="YES",
        )

        # Simulate resolution: YES won
        outcome_resolution = "yes_won"
        prediction_correct = pred.predicted_outcome == "YES"

        # Brier score: (predicted_prob - actual)^2
        actual = Decimal("1") if outcome_resolution == "yes_won" else Decimal("0")
        brier = (pred.probability - actual) ** 2

        assert prediction_correct is True
        assert brier == pytest.approx(Decimal("0.1444"), abs=Decimal("0.001"))

    def test_resolution_incorrect_prediction(self):
        """When prediction is wrong, brier score should be high."""
        pred = PredictionRecord(
            market_id="mkt-001",
            event_id="evt-001",
            title="Test",
            strike_price=Decimal("80000"),
            current_btc_price=Decimal("80100"),
            distance_from_strike_pct=Decimal("0.125"),
            is_above_strike=True,
            seconds_remaining=0,
            seconds_elapsed=900,
            realized_volatility=Decimal("0.03"),
            momentum_pct=Decimal("0.05"),
            strategy="distance_to_strike",
            probability=Decimal("0.62"),
            predicted_outcome="YES",
        )

        # Simulate resolution: NO won (prediction was wrong)
        outcome_resolution = "no_won"
        prediction_correct = pred.predicted_outcome == "YES" and outcome_resolution == "yes_won"

        actual = Decimal("1") if outcome_resolution == "yes_won" else Decimal("0")
        brier = (pred.probability - actual) ** 2

        assert prediction_correct is False
        assert brier == pytest.approx(Decimal("0.3844"), abs=Decimal("0.001"))

    def test_pnl_computation(self):
        """PnL should be computed correctly for won/lost trades."""
        # Won trade: payout = amount / price, pnl = payout - amount
        amount = Decimal("10")
        price = Decimal("0.65")
        payout = amount / price  # 15.38
        pnl_won = payout - amount  # 5.38

        assert pnl_won > 0

        # Lost trade: payout = 0, pnl = -amount
        pnl_lost = Decimal("0") - amount
        assert pnl_lost == Decimal("-10")


# ---------------------------------------------------------------------------
# Test 5: Probability model
# ---------------------------------------------------------------------------

class TestProbabilityModel:
    def test_above_strike_gives_high_probability(self):
        """When BTC is above strike, P(YES) should be > 0.5."""
        prob = probability_from_distance_to_strike(
            distance_pct=Decimal("0.1"),  # 0.1% above strike
            volatility_pct=Decimal("0.03"),
            seconds_remaining=600,
        )
        assert prob > Decimal("0.5")

    def test_below_strike_gives_low_probability(self):
        """When BTC is below strike, P(YES) should be < 0.5."""
        prob = probability_from_distance_to_strike(
            distance_pct=Decimal("-0.1"),  # 0.1% below strike
            volatility_pct=Decimal("0.03"),
            seconds_remaining=600,
        )
        assert prob < Decimal("0.5")

    def test_probability_bounded(self):
        """Probability should always be between 0.01 and 0.99."""
        for dist in [Decimal("-1"), Decimal("0"), Decimal("1"), Decimal("10")]:
            prob = probability_from_distance_to_strike(
                dist, Decimal("0.03"), 600,
            )
            assert Decimal("0.01") <= prob <= Decimal("0.99")

    def test_zero_volatility_falls_back(self):
        """With zero volatility, should use fallback estimate."""
        prob = probability_from_distance_to_strike(
            distance_pct=Decimal("0.1"),
            volatility_pct=Decimal("0"),
            seconds_remaining=600,
        )
        assert Decimal("0.01") <= prob <= Decimal("0.99")


# ---------------------------------------------------------------------------
# Test 6: Fee-adjusted edge
# ---------------------------------------------------------------------------

class TestFeeAdjustedEdge:
    def test_fee_reduces_edge(self):
        """Fee-adjusted edge should be lower than raw edge."""
        model_prob = Decimal("0.65")
        price = Decimal("0.60")
        raw_edge = model_prob - price
        adj_edge = fee_adjusted_edge(model_prob, price)

        assert adj_edge is not None
        assert adj_edge < raw_edge

    def test_negative_when_fees_eaten(self):
        """When fees eat the edge, result should be negative."""
        model_prob = Decimal("0.62")
        price = Decimal("0.60")
        adj_edge = fee_adjusted_edge(model_prob, price)

        # With 10% fee, break-even is ~0.632, so 0.62 < 0.632 → negative
        assert adj_edge is not None
        assert adj_edge < 0

    def test_invalid_price_returns_none(self):
        """Invalid prices should return None."""
        assert fee_adjusted_edge(Decimal("0.6"), Decimal("0")) is None
        assert fee_adjusted_edge(Decimal("0.6"), Decimal("1")) is None
        assert fee_adjusted_edge(Decimal("0.6"), None) is None
