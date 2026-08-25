"""Tests for strategy and risk management."""
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from bayse_bot.config import Settings
from bayse_bot.models import BTCFeatures
from bayse_bot.risk import RiskManager
from bayse_bot.strategy import StrategyInput, strategy_by_name


def features():
    return BTCFeatures(Decimal("100"), Decimal(".05"), Decimal("2"), Decimal(".5"), datetime.now(timezone.utc), True)


def test_strategies_and_inversion(tmp_path, monkeypatch):
    monkeypatch.setenv("STATE_PATH", str(tmp_path / "state.json"))
    s = Settings()
    x = StrategyInput(features(), Decimal(".5"), Decimal(".5"))
    assert strategy_by_name("momentum_continuation").evaluate(x, s).outcome.value == "YES"
    assert strategy_by_name("mean_reversion_inversion").evaluate(x, s).outcome.value == "NO"


class MockRiskRepository:
    """In-memory risk repository for testing."""

    def __init__(self):
        self._state = {}

    async def load_risk_state(self):
        return self._state

    async def save_risk_state(self, state):
        self._state = state

    async def add_uncertain_market(self, market_id):
        if market_id not in self._state.get("uncertain_market_ids", []):
            self._state.setdefault("uncertain_market_ids", []).append(market_id)
        self._state["active_market_id"] = None

    async def remove_uncertain_market(self, market_id):
        uncertain = self._state.get("uncertain_market_ids", [])
        if market_id in uncertain:
            uncertain.remove(market_id)


def test_loss_cooldown_persists(tmp_path, monkeypatch):
    monkeypatch.setenv("STATE_PATH", str(tmp_path / "state.json"))
    s = Settings()
    repo = MockRiskRepository()
    r = RiskManager(s, repo)
    now = datetime.now(timezone.utc)

    async def run_test():
        for _ in range(3):
            await r.closed(Decimal("-1"), now)
        reasons = await r.approve("m", now)
        assert "loss_streak_cooldown" in reasons

        r2 = RiskManager(s, repo)
        await r2.load()
        assert r2.state.consecutive_losses == 3

    import asyncio
    asyncio.run(run_test())
