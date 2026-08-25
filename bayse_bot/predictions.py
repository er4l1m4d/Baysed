"""Prediction recording for model training and evaluation.

Every evaluated market is recorded as a PredictionRecord, regardless of
whether the strategy approved or rejected it. This is the raw training
data for the probability model.

Now uses repository pattern for persistence (PostgreSQL in production,
SQLite for local development).
"""
from __future__ import annotations
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from decimal import Decimal
from enum import StrEnum
from typing import Any

from .repositories.interfaces import PredictionRepository


class PredictionOutcome(StrEnum):
    """Resolution of a prediction."""
    PENDING = "pending"
    YES_WON = "yes_won"
    NO_WON = "no_won"
    EXPIRED = "expired"


@dataclass
class PredictionRecord:
    """One prediction for one market evaluation."""

    # Identity
    market_id: str
    event_id: str
    title: str

    # Contract state at prediction time
    strike_price: Decimal
    current_btc_price: Decimal
    distance_from_strike_pct: Decimal
    is_above_strike: bool
    seconds_remaining: int
    seconds_elapsed: int
    realized_volatility: Decimal
    momentum_pct: Decimal

    # Book state at prediction time
    yes_ask: Decimal | None = None
    no_ask: Decimal | None = None
    spread: Decimal | None = None

    # Strategy output
    strategy: str = ""
    probability: Decimal | None = None
    predicted_outcome: str = ""  # "YES" or "NO"
    edge: Decimal | None = None
    signal_strength: Decimal = Decimal("0")
    approved: bool = False
    reasons: tuple[str, ...] = ()

    # Metadata
    strategy_version: str = "2"
    experiment_tag: str = "distance_to_strike_v1"
    recorded_at: datetime = None

    # Resolution (populated later)
    outcome_resolution: str = "pending"  # "pending" | "yes_won" | "no_won"
    actual_price: Decimal | None = None  # BTC price at resolution

    def __post_init__(self):
        if self.recorded_at is None:
            self.recorded_at = datetime.now(timezone.utc)

    def to_db_dict(self) -> dict[str, Any]:
        """Convert to dictionary suitable for database insertion."""
        d = asdict(self)
        # Convert Decimal to string for PostgreSQL
        for k, v in d.items():
            if isinstance(v, Decimal):
                d[k] = str(v)
            elif isinstance(v, tuple):
                d[k] = list(v)
            elif isinstance(v, datetime):
                d[k] = v
        return d


class PredictionRecorder:
    """Records predictions to database via repository."""

    def __init__(self, repository: PredictionRepository):
        self.repository = repository

    async def record(self, pred: PredictionRecord) -> None:
        """Save one prediction to database."""
        await self.repository.save_prediction(pred.to_db_dict())

    async def get_pending(self) -> list[dict[str, Any]]:
        """Get all pending predictions."""
        return await self.repository.get_pending_predictions()

    async def update_resolution(
        self,
        market_id: str,
        outcome_resolution: str,
        actual_price: Decimal | None = None,
        prediction_correct: bool | None = None,
        brier_score: Decimal | None = None,
    ) -> None:
        """Update prediction with resolution data."""
        await self.repository.update_resolution(
            market_id, outcome_resolution, actual_price, prediction_correct, brier_score
        )

    async def get_calibration_stats(self) -> dict[str, Any]:
        """Get calibration statistics."""
        return await self.repository.get_calibration_stats()
