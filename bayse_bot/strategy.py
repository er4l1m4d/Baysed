from __future__ import annotations
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
import math
from .config import Settings
from .contract import ContractState
from .models import BTCFeatures, Decision, Outcome

# ---------------------------------------------------------------------------
# Probability helpers
# ---------------------------------------------------------------------------

def normal_cdf(z: Decimal) -> Decimal:
    """Standard normal CDF via math.erf (accurate to ~1e-7)."""
    try:
        z_float = float(z)
    except (InvalidOperation, ValueError, OverflowError):
        return Decimal("0.5")
    return Decimal(str(0.5 * (1 + math.erf(z_float / math.sqrt(2)))))

def probability_from_momentum(momentum_pct: Decimal) -> Decimal:
    """Legacy momentum-only model. Kept for backward compat."""
    return max(Decimal("0.01"), min(Decimal("0.99"), Decimal("0.5") + momentum_pct * Decimal("4")))

# Bayse fee constants
FEE_RATE = Decimal("0.10")  # 10% taker fee

def fee_adjusted_edge(model_probability: Decimal, price: Decimal) -> Decimal | None:
    """Calculate edge after accounting for Bayse trading fees.

    Bayse fee formula: fee = feeRate * C * P * max(1 - P, 0.5)
    This means the break-even model probability is:
        P_be = P / (1 - feeRate * max(1 - P, 0.5))

    Returns model_probability - P_be. Positive = profitable after fees.
    """
    if price is None or price <= 0 or price >= 1:
        return None
    floor_factor = max(Decimal("1") - price, Decimal("0.5"))
    denom = Decimal("1") - FEE_RATE * floor_factor
    if denom <= 0:
        return None
    p_be = price / denom  # break-even model probability
    return model_probability - p_be

def probability_from_distance_to_strike(
    distance_pct: Decimal,
    volatility_pct: Decimal,
    seconds_remaining: int,
    total_duration: int = 900,
) -> Decimal:
    """Volatility-adjusted distance-to-strike probability model.

    z = distance / expected_move
    expected_move = volatility * sqrt(time_remaining / total_duration)
    P(above strike) = normal_cdf(z)

    When BTC is above strike, z > 0 -> probability > 50%.
    When BTC is below strike, z < 0 -> probability < 50%.
    """
    if volatility_pct <= 0 or total_duration <= 0:
        # No volatility data: fall back to distance-only estimate
        return max(Decimal("0.01"), min(Decimal("0.99"), Decimal("0.5") + distance_pct * Decimal("4")))

    time_frac = Decimal(str(seconds_remaining)) / Decimal(str(total_duration))
    expected_move = volatility_pct * time_frac.sqrt() if time_frac > 0 else volatility_pct

    if expected_move <= 0:
        return max(Decimal("0.01"), min(Decimal("0.99"), Decimal("0.5") + distance_pct * Decimal("4")))

    z = distance_pct / expected_move
    return max(Decimal("0.01"), min(Decimal("0.99"), normal_cdf(z)))

# ---------------------------------------------------------------------------
# Strategy input — now includes ContractState
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class StrategyInput:
    btc: BTCFeatures
    yes_ask: Decimal
    no_ask: Decimal
    contract: ContractState | None = None

# ---------------------------------------------------------------------------
# Base strategy
# ---------------------------------------------------------------------------

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

# ---------------------------------------------------------------------------
# Distance-to-strike model (new primary model)
# ---------------------------------------------------------------------------

class DistanceToStrikeModel(Strategy):
    name = "distance_to_strike"
    version = "2"

    def evaluate(self, x: StrategyInput, s: Settings) -> Decision:
        reasons = []
        contract = x.contract

        if not contract:
            reasons.append("no_contract_state")
            return Decision(self.name, None, None, None, None, Decimal("0"), False, tuple(reasons))

        # Compute probability from distance + volatility + time remaining
        probability = probability_from_distance_to_strike(
            contract.distance_from_strike_pct,
            contract.realized_volatility,
            contract.seconds_remaining,
        )

        # Signal: YES if probability > 50% (above strike), NO if below
        outcome = Outcome.YES if probability > Decimal("0.5") else Outcome.NO
        price = x.yes_ask if outcome is Outcome.YES else x.no_ask

        # Edge: model probability minus market price (raw)
        edge = probability - price if price else None

        # Fee-adjusted edge: accounts for Bayse taker fees
        edge_fee = fee_adjusted_edge(probability, price)

        # Strength: how far z-score is from 0 (normalized)
        time_frac = Decimal(str(contract.seconds_remaining)) / Decimal("900")
        expected_move = contract.realized_volatility * time_frac.sqrt() if time_frac > 0 and contract.realized_volatility > 0 else Decimal("1")
        strength = abs(contract.distance_from_strike_pct) / expected_move if expected_move > 0 else Decimal("0")

        # Book quality checks
        if x.yes_ask is None or x.no_ask is None:
            reasons.append("missing_book_prices")

        # Edge guards — use fee-adjusted edge for approval decisions
        if edge is not None and edge < s.min_model_gap:
            reasons.append("model_edge_below_minimum")
        if edge is not None and edge > s.max_model_gap:
            reasons.append("model_edge_above_guardrail")
        if edge_fee is not None and edge_fee < 0:
            reasons.append("negative_edge_after_fees")
        if strength < s.min_strength:
            reasons.append("signal_strength_below_minimum")

        # Time guard: don't trade in last minute
        if contract.seconds_remaining < 60:
            reasons.append("too_close_to_expiry")

        return Decision(
            self.name, outcome, probability, edge, edge_fee, strength,
            not reasons, tuple(reasons),
        )

# ---------------------------------------------------------------------------
# Legacy momentum strategies (kept for backward compat)
# ---------------------------------------------------------------------------

class MomentumContinuation(Strategy):
    name="momentum_continuation"
    def evaluate(self, x, s):
        reasons=self._qualified(x,s); outcome=Outcome.YES if x.btc.momentum_pct >= 0 else Outcome.NO
        probability=probability_from_momentum(x.btc.momentum_pct); price=x.yes_ask if outcome is Outcome.YES else x.no_ask
        edge=(probability if outcome is Outcome.YES else 1-probability)-price
        edge_fee=fee_adjusted_edge(probability, price)
        strength=abs(x.btc.momentum_pct)/max(s.momentum_threshold,Decimal("0.0001"))
        if edge < s.min_model_gap: reasons.append("model_edge_below_minimum")
        if edge > s.max_model_gap: reasons.append("model_edge_above_guardrail")
        if edge_fee is not None and edge_fee < 0: reasons.append("negative_edge_after_fees")
        if strength < s.min_strength: reasons.append("signal_strength_below_minimum")
        return Decision(self.name,outcome,probability,edge,edge_fee,strength,not reasons,tuple(reasons))

class MeanReversionInversion(MomentumContinuation):
    name="mean_reversion_inversion"
    def evaluate(self,x,s):
        base=super().evaluate(x,s); outcome=Outcome.NO if base.outcome is Outcome.YES else Outcome.YES
        probability=(1-base.probability) if base.probability is not None else None
        price=x.yes_ask if outcome is Outcome.YES else x.no_ask
        edge=(probability-price) if probability is not None else None
        edge_fee=fee_adjusted_edge(probability, price)
        reasons=[r for r in base.reasons if not r.startswith("model_edge")]
        if edge is None or edge < s.min_model_gap: reasons.append("model_edge_below_minimum")
        if edge is not None and edge > s.max_model_gap: reasons.append("model_edge_above_guardrail")
        if edge_fee is not None and edge_fee < 0: reasons.append("negative_edge_after_fees")
        return Decision(self.name,outcome,probability,edge,edge_fee,base.strength,not reasons,tuple(reasons))

class DirectBTCMomentum(MomentumContinuation):
    name="direct_btc_momentum"

class Shadow(Strategy):
    name="shadow"
    def __init__(self, wrapped: Strategy): self.wrapped=wrapped
    def evaluate(self,x,s): return self.wrapped.evaluate(x,s)

def strategy_by_name(name: str) -> Strategy:
    registry={c.name:c for c in (DistanceToStrikeModel,MeanReversionInversion,MomentumContinuation,DirectBTCMomentum)}
    if name not in registry: raise ValueError(f"unknown strategy {name}")
    return registry[name]()
