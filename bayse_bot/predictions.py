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


def outcome_from_bayse_resolved(
    resolved_outcome_id: str,
    outcome1_id: str | None,
    outcome2_id: str | None,
) -> str:
    """Map Bayse's resolvedOutcomeId to our PredictionOutcome string.

    This is the canonical resolution method — uses Bayse's own
    resolution rather than a price-based heuristic.
    """
    if resolved_outcome_id == outcome1_id:
        return PredictionOutcome.YES_WON.value
    elif resolved_outcome_id == outcome2_id:
        return PredictionOutcome.NO_WON.value
    return PredictionOutcome.EXPIRED.value


def market_implied_p_yes(yes_ask: Decimal | None, no_ask: Decimal | None) -> Decimal | None:
    """Canonical market-implied P(yes) from raw asks.

    Prefers the YES ask; falls back to 1 - NO ask. Returns None when
    neither side is quoted. This is outcome-independent — always P(yes),
    never the ask of whichever side the model predicted (the old semantics
    made market-Brier comparisons score NO predictions against the wrong
    side).
    """
    if yes_ask is not None:
        return yes_ask
    if no_ask is not None:
        return Decimal("1") - no_ask
    return None


def serialize_book(book, max_levels: int = 10) -> dict | None:
    """Serialize an OrderBook's top-N levels to a JSON-safe dict.

    Levels are [price, quantity] string pairs, best first
    (bids descending, asks ascending — the OrderBook's stored order).
    """
    if book is None:
        return None
    def levels(side) -> list[list[str]]:
        return [[str(l.price), str(l.quantity)] for l in side[:max_levels]]
    return {"bids": levels(book.bids), "asks": levels(book.asks)}


def book_state_from_snapshot(snapshot, max_levels: int = 10) -> dict | None:
    """Full top-of-book state for a snapshot, source-marked.

    Shape:
        {
          "source": "ws" | "rest" | "synthetic_last_trade" | "",
          "yes": {"bids": [[p, q]...], "asks": [[p, q]...]} | null,
          "no":  {...} | null
        }

    Returns None when neither book exists. Levels are strings to avoid
    float rounding; convert at analysis time.
    """
    yes = serialize_book(snapshot.yes_book, max_levels)
    no = serialize_book(snapshot.no_book, max_levels)
    if yes is None and no is None:
        return None
    return {"source": snapshot.book_source, "yes": yes, "no": no}


@dataclass
class PredictionRecord:
    """One prediction snapshot for one market evaluation.

    Each time the bot evaluates a market, a new PredictionRecord is created.
    Multiple snapshots per market are allowed — this captures how the model's
    output changes as BTC price and time evolve.
    """

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

    # Run 002 research: full book depth, second price source, midnight regime
    book_state: dict | None = None          # top-N bids/asks both sides, source-marked
    yes_book_age_ms: float | None = None    # WS book staleness (None for rest/synthetic)
    no_book_age_ms: float | None = None
    market_price: Decimal | None = None     # contract last-trade price
    market_volume: Decimal | None = None    # contract volume
    btc_daily_close: Decimal | None = None  # BTC at last 00:00 UTC rollover
    coinbase_btc_price: Decimal | None = None  # BTC spot from Coinbase

    # Strategy output
    strategy: str = ""
    probability: Decimal | None = None
    predicted_outcome: str = ""  # "YES" or "NO"
    edge: Decimal | None = None
    edge_fee: Decimal | None = None  # Fee-adjusted edge (selected side)
    bayse_implied: Decimal | None = None  # Market-implied P(yes): yes_ask, else 1 - no_ask
    signal_strength: Decimal = Decimal("0")
    approved: bool = False
    reasons: tuple[str, ...] = ()

    # Both-side edges (for research)
    yes_edge: Decimal | None = None
    yes_edge_fee: Decimal | None = None
    no_edge: Decimal | None = None
    no_edge_fee: Decimal | None = None

    # Metadata
    strategy_version: str = "2"
    experiment_tag: str = "distance_to_strike_v2"
    model_version: str = "distance_to_strike_v2"
    run_id: str = ""

    # Timestamps (multi-granularity)
    observed_at: datetime = None      # when market was first seen in scan
    decided_at: datetime = None       # when model produced its output
    recorded_at: datetime = None      # when persisted to DB

    # Contract timing (from ContractState)
    opened_at: datetime | None = None
    closes_at: datetime | None = None
    volume_ratio: Decimal = Decimal("0")

    # Outcome IDs (for resolution mapping)
    outcome1_id: str = ""
    outcome2_id: str = ""

    # Resolution (populated later)
    outcome_resolution: str = PredictionOutcome.PENDING.value
    actual_price: Decimal | None = None  # BTC price at resolution
    resolved_at: datetime | None = None
    resolved_outcome_id: str | None = None  # raw Bayse value for audit trail
    resolution_source: str = ""  # canonical source, e.g. "bayse_api"

    def __post_init__(self):
        now = datetime.now(timezone.utc)
        if self.recorded_at is None:
            self.recorded_at = now
        if self.observed_at is None:
            self.observed_at = now
        if self.decided_at is None:
            self.decided_at = now

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
        resolved_outcome_id: str | None = None,
        resolution_source: str = "",
        prediction_id: int | None = None,
    ) -> None:
        """Update prediction with resolution data."""
        await self.repository.update_resolution(
            market_id, outcome_resolution, actual_price,
            prediction_correct, brier_score, resolved_outcome_id, resolution_source,
            prediction_id,
        )

    async def get_calibration_stats(self) -> dict[str, Any]:
        """Get calibration statistics."""
        return await self.repository.get_calibration_stats()
