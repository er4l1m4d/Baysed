"""Canonical market snapshot — single source of truth for the decision pipeline.

MarketSnapshot captures the complete state of a market evaluation at a
single point in time. It replaces the ad-hoc assembly of BTCFeatures,
Market, ContractState, OrderBook, etc. that previously flowed through
the engine.

Usage:
    snapshot = MarketSnapshot.from_market(market, btc, yes_book, no_book)
    decision = strategy.evaluate(snapshot, settings)
    prediction = PredictionRecord.from_snapshot(snapshot, decision)

This makes live, paper, replay and backtesting use the exact same
state contract.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from .models import BTCFeatures, Market, OrderBook, Outcome


@dataclass(frozen=True)
class MarketSnapshot:
    """Complete market state at a point in time.

    Immutable — once created, never modified. This is the canonical
    input to strategy.evaluate() and the basis for PredictionRecord.
    """

    # --- Market identity ---
    market_id: str
    event_id: str
    title: str
    strike_price: Decimal

    # --- Timing ---
    opened_at: datetime | None
    closes_at: datetime
    seconds_elapsed: int
    seconds_remaining: int

    # --- BTC state ---
    btc_price: Decimal
    btc_momentum_pct: Decimal
    btc_volume_ratio: Decimal
    btc_atr_pct: Decimal
    btc_complete: bool

    # --- Order books ---
    yes_book: OrderBook | None
    no_book: OrderBook | None

    # --- Derived (computed once, cached) ---
    distance_from_strike_pct: Decimal = Decimal("0")
    is_above_strike: bool = False
    spread: Decimal | None = None
    realized_volatility: Decimal = Decimal("0")

    # --- Source metadata ---
    observed_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    @property
    def yes_ask(self) -> Decimal | None:
        return self.yes_book.best_ask if self.yes_book else None

    @property
    def no_ask(self) -> Decimal | None:
        return self.no_book.best_ask if self.no_book else None

    @property
    def yes_bid(self) -> Decimal | None:
        return self.yes_book.best_bid if self.yes_book else None

    @property
    def no_bid(self) -> Decimal | None:
        return self.no_book.best_bid if self.no_book else None

    @classmethod
    def from_market(
        cls,
        market: Market,
        btc: BTCFeatures,
        yes_book: OrderBook | None = None,
        no_book: OrderBook | None = None,
        now: datetime | None = None,
    ) -> MarketSnapshot | None:
        """Build a MarketSnapshot from market metadata + live data.

        Returns None if the contract cannot be constructed (missing strike, closes_at, etc.).
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

        spread = None
        if yes_book and no_book and yes_book.best_ask and no_book.best_ask:
            # Spread across both sides of the market
            spread = (yes_book.spread or Decimal("0") + no_book.spread or Decimal("0")) / 2

        return cls(
            market_id=market.market_id,
            event_id=market.event_id,
            title=market.title,
            strike_price=market.strike_price,
            opened_at=market.opens_at,
            closes_at=market.closes_at,
            seconds_elapsed=seconds_elapsed,
            seconds_remaining=seconds_remaining,
            btc_price=btc.price,
            btc_momentum_pct=btc.momentum_pct,
            btc_volume_ratio=btc.volume_ratio,
            btc_atr_pct=btc.atr_pct,
            btc_complete=btc.complete,
            yes_book=yes_book,
            no_book=no_book,
            distance_from_strike_pct=distance,
            is_above_strike=is_above,
            spread=spread,
            realized_volatility=btc.atr_pct,
        )

    def to_dict(self) -> dict[str, Any]:
        """Serialize to dict for logging/audit."""
        return {
            "market_id": self.market_id,
            "event_id": self.event_id,
            "title": self.title,
            "strike_price": str(self.strike_price),
            "btc_price": str(self.btc_price),
            "distance_from_strike_pct": str(self.distance_from_strike_pct),
            "is_above_strike": self.is_above_strike,
            "seconds_remaining": self.seconds_remaining,
            "seconds_elapsed": self.seconds_elapsed,
            "yes_ask": str(self.yes_ask) if self.yes_ask else None,
            "no_ask": str(self.no_ask) if self.no_ask else None,
            "spread": str(self.spread) if self.spread else None,
            "btc_momentum_pct": str(self.btc_momentum_pct),
            "btc_atr_pct": str(self.btc_atr_pct),
            "btc_complete": self.btc_complete,
        }
