from datetime import datetime,timedelta,timezone
from decimal import Decimal
from bayse_bot.config import Settings
from bayse_bot.models import BTCFeatures
from bayse_bot.risk import RiskManager
from bayse_bot.strategy import StrategyInput,strategy_by_name

def features(): return BTCFeatures(Decimal("100"),Decimal(".05"),Decimal("2"),Decimal(".5"),datetime.now(timezone.utc),True)
def test_strategies_and_inversion(tmp_path,monkeypatch):
    monkeypatch.setenv("STATE_PATH",str(tmp_path/"state.json"));s=Settings()
    x=StrategyInput(features(),Decimal(".5"),Decimal(".5"))
    assert strategy_by_name("momentum_continuation").evaluate(x,s).outcome.value=="YES"
    assert strategy_by_name("mean_reversion_inversion").evaluate(x,s).outcome.value=="NO"
def test_loss_cooldown_persists(tmp_path,monkeypatch):
    monkeypatch.setenv("STATE_PATH",str(tmp_path/"state.json"));s=Settings();r=RiskManager(s);now=datetime.now(timezone.utc)
    for _ in range(3): r.closed(Decimal("-1"),now)
    assert "loss_streak_cooldown" in r.approve("m",now)
    assert RiskManager(s).state.consecutive_losses==3
