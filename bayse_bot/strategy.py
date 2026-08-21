from __future__ import annotations
from dataclasses import dataclass
from decimal import Decimal
from .config import Settings
from .models import BTCFeatures, Decision, Outcome

def probability_from_momentum(momentum_pct: Decimal) -> Decimal:
    # Bounded, deliberately simple research model; not a claim of predictive validity.
    return max(Decimal("0.01"), min(Decimal("0.99"), Decimal("0.5") + momentum_pct * Decimal("4")))

@dataclass(frozen=True)
class StrategyInput:
    btc: BTCFeatures
    yes_ask: Decimal
    no_ask: Decimal

class Strategy:
    name = "base"; version = "1"
    def evaluate(self, x: StrategyInput, s: Settings) -> Decision: raise NotImplementedError
    def _qualified(self, x: StrategyInput, s: Settings) -> list[str]:
        reasons=[]
        if not x.btc.complete: reasons.append("btc_data_incomplete_or_stale")
        if abs(x.btc.momentum_pct) < s.momentum_threshold: reasons.append("momentum_below_threshold")
        if x.btc.volume_ratio < s.volume_multiplier: reasons.append("volume_below_threshold")
        if not s.min_atr <= x.btc.atr_pct <= s.max_atr: reasons.append("atr_out_of_range")
        return reasons

class MomentumContinuation(Strategy):
    name="momentum_continuation"
    def evaluate(self, x, s):
        reasons=self._qualified(x,s); outcome=Outcome.YES if x.btc.momentum_pct >= 0 else Outcome.NO
        probability=probability_from_momentum(x.btc.momentum_pct); price=x.yes_ask if outcome is Outcome.YES else x.no_ask
        edge=(probability if outcome is Outcome.YES else 1-probability)-price; strength=abs(x.btc.momentum_pct)/max(s.momentum_threshold,Decimal("0.0001"))
        if edge < s.min_model_gap: reasons.append("model_edge_below_minimum")
        if edge > s.max_model_gap: reasons.append("model_edge_above_guardrail")
        if strength < s.min_strength: reasons.append("signal_strength_below_minimum")
        return Decision(self.name,outcome,probability,edge,strength,not reasons,tuple(reasons))

class MeanReversionInversion(MomentumContinuation):
    name="mean_reversion_inversion"
    def evaluate(self,x,s):
        base=super().evaluate(x,s); outcome=Outcome.NO if base.outcome is Outcome.YES else Outcome.YES
        price=x.yes_ask if outcome is Outcome.YES else x.no_ask
        probability=(1-base.probability) if base.probability is not None else None
        edge=(probability-price) if probability is not None else None
        reasons=[r for r in base.reasons if not r.startswith("model_edge")]
        if edge is None or edge < s.min_model_gap: reasons.append("model_edge_below_minimum")
        if edge is not None and edge > s.max_model_gap: reasons.append("model_edge_above_guardrail")
        return Decision(self.name,outcome,probability,edge,base.strength,not reasons,tuple(reasons))

class DirectBTCMomentum(MomentumContinuation):
    name="direct_btc_momentum"

class Shadow(Strategy):
    name="shadow"
    def __init__(self, wrapped: Strategy): self.wrapped=wrapped
    def evaluate(self,x,s): return self.wrapped.evaluate(x,s)

def strategy_by_name(name: str) -> Strategy:
    registry={c.name:c for c in (MeanReversionInversion,MomentumContinuation,DirectBTCMomentum)}
    if name not in registry: raise ValueError(f"unknown strategy {name}")
    return registry[name]()
