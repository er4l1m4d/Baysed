"""Contract state for a Bayse 15-minute binary market.

Builds a structured representation of the contract: strike price,
current BTC price, time remaining, distance from strike, and
volatility. This becomes the core object for signal generation.
"""
from __future__ import annotations
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from .models import BTCFeatures, Market


@dataclass(frozen=True)
class ContractState:
    """State of a single Bayse binary contract at a point in time."""

    market_id: str
    event_id: str
    title: str

    # Strike and current price
    strike_price: Decimal
    current_btc_price: Decimal

    # Time
    opened_at: datetime | None
    closes_at: datetime
    seconds_elapsed: int
    seconds_remaining: int

    # Derived
    distance_from_strike_pct: Decimal  # (current - strike) / strike * 100
    is_above_strike: bool

    # Volatility (from BTC feature engine)
    realized_volatility: Decimal  # ATR percentage
    momentum_pct: Decimal
    volume_ratio: Decimal

    # Market data
    bayse_yes_price: Decimal | None = None
    bayse_no_price: Decimal | None = None
    spread: Decimal | None = None

    @property
    def time_remaining_fraction(self) -> Decimal:
        """Fraction of total duration remaining (0.0 to 1.0)."""
        total = self.seconds_elapsed + self.seconds_remaining
        if total <= 0:
            return Decimal("0")
        return Decimal(str(self.seconds_remaining)) / Decimal(str(total))


def build_contract_state(
    market: Market,
    btc: BTCFeatures,
    yes_ask: Decimal | None = None,
    no_ask: Decimal | None = None,
    spread: Decimal | None = None,
    now: datetime | None = None,
) -> ContractState | None:
    """Build ContractState from market metadata + live BTC data.

    Returns None if the contract cannot be constructed (missing strike,
    missing closes_at, etc.).
    """
    now = now or datetime.now(timezone.utc)

    if not market.strike_price or not market.closes_at:
        return None

    seconds_remaining = max(0, int((market.closes_at - now).total_seconds()))
    seconds_elapsed = 0
    if market.opens_at:
        seconds_elapsed = max(0, int((now - market.opens_at).total_seconds()))

    distance = Decimal("0")
    is_above = False
    if market.strike_price > 0 and btc.price > 0:
        distance = (btc.price - market.strike_price) / market.strike_price * 100
        is_above = btc.price >= market.strike_price

    return ContractState(
        market_id=market.market_id,
        event_id=market.event_id,
        title=market.title,
        strike_price=market.strike_price,
        current_btc_price=btc.price,
        opened_at=market.opens_at,
        closes_at=market.closes_at,
        seconds_elapsed=seconds_elapsed,
        seconds_remaining=seconds_remaining,
        distance_from_strike_pct=distance,
        is_above_strike=is_above,
        realized_volatility=btc.atr_pct,
        momentum_pct=btc.momentum_pct,
        volume_ratio=btc.volume_ratio,
        bayse_yes_price=yes_ask,
        bayse_no_price=no_ask,
        spread=spread,
    )
