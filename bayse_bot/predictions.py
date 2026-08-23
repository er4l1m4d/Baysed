"""Prediction recording for model training and evaluation.

Every evaluated market is recorded as a PredictionRecord, regardless of
whether the strategy approved or rejected it. This is the raw training
data for the probability model.

Recorded fields:
  - Contract state (strike, distance, time remaining, volatility)
  - Market book prices (yes_ask, no_ask, spread)
  - Strategy output (probability, edge, outcome, reasons)
  - Actual resolution (populated later via outcome API)
"""
from __future__ import annotations
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from decimal import Decimal
from enum import StrEnum
from typing import Any
import json
from pathlib import Path


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
    recorded_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    # Resolution (populated later)
    outcome_resolution: str = "pending"  # "pending" | "yes_won" | "no_won"
    actual_price: Decimal | None = None  # BTC price at resolution


def prediction_to_dict(pred: PredictionRecord) -> dict:
    """Convert to JSON-serializable dict."""
    d = asdict(pred)
    d["recorded_at"] = pred.recorded_at.isoformat()
    for k, v in d.items():
        if isinstance(v, Decimal):
            d[k] = str(v)
        elif isinstance(v, tuple):
            d[k] = list(v)
    return d


class PredictionRecorder:
    """Append-only JSONL writer for predictions."""

    def __init__(self, root: Path):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    def record(self, pred: PredictionRecord) -> None:
        """Append one prediction to predictions.jsonl."""
        path = self.root / "predictions.jsonl"
        item = prediction_to_dict(pred)
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(item, sort_keys=True, ensure_ascii=False) + "\n")
