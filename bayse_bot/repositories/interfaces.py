"""Repository interfaces for Bayse Bot.

Provider-neutral abstractions for all persistent state.
Implementations can be PostgreSQL, SQLite, or in-memory for testing.
"""
from __future__ import annotations
from abc import ABC, abstractmethod
from datetime import datetime
from decimal import Decimal
from typing import Any


# ---------------------------------------------------------------------------
# Prediction Repository
# ---------------------------------------------------------------------------

class PredictionRepository(ABC):
    """Abstract interface for prediction persistence."""

    @abstractmethod
    async def save_prediction(self, prediction: dict[str, Any]) -> None:
        """Save a new prediction record."""
        ...

    @abstractmethod
    async def get_latest_prediction(self, market_id: str) -> dict[str, Any] | None:
        """Get the most recent prediction snapshot for a market."""
        ...

    @abstractmethod
    async def get_predictions_for_market(self, market_id: str) -> list[dict[str, Any]]:
        """Get all prediction snapshots for a market, ordered by recorded_at."""
        ...

    @abstractmethod
    async def get_predictions(
        self, limit: int = 50, offset: int = 0, resolution: str | None = None
    ) -> list[dict[str, Any]]:
        """Get predictions with pagination and optional filters."""
        ...

    @abstractmethod
    async def update_resolution(
        self,
        market_id: str,
        outcome_resolution: str,
        actual_price: Decimal | None = None,
        prediction_correct: bool | None = None,
        brier_score: Decimal | None = None,
        resolved_outcome_id: str | None = None,
    ) -> None:
        """Update prediction with resolution data."""
        ...

    @abstractmethod
    async def get_pending_predictions(self) -> list[dict[str, Any]]:
        """Get all predictions with outcome_resolution='pending'."""
        ...

    @abstractmethod
    async def get_pending_predictions_for_markets(self, market_ids: list[str]) -> list[dict[str, Any]]:
        """Get pending predictions only for specific markets (scoped resolution)."""
        ...

    @abstractmethod
    async def get_calibration_stats(self) -> dict[str, Any]:
        """Get calibration statistics (total, resolved, correct, brier_mean, curve)."""
        ...


# ---------------------------------------------------------------------------
# Trade Repository
# ---------------------------------------------------------------------------

class TradeRepository(ABC):
    """Abstract interface for trade persistence."""

    @abstractmethod
    async def save_trade(self, trade: dict[str, Any]) -> int:
        """Save a new trade record. Returns trade ID."""
        ...

    @abstractmethod
    async def get_trade(self, trade_id: int) -> dict[str, Any] | None:
        """Get a trade by ID."""
        ...

    @abstractmethod
    async def get_trades(
        self, limit: int = 50, offset: int = 0
    ) -> list[dict[str, Any]]:
        """Get trades with pagination."""
        ...

    @abstractmethod
    async def update_trade_status(
        self, trade_id: int, status: str, order_id: str | None = None
    ) -> None:
        """Update trade status (pending -> filled/cancelled/rejected)."""
        ...

    @abstractmethod
    async def get_open_trades(self) -> list[dict[str, Any]]:
        """Get all trades with status='pending' or 'open'."""
        ...

    @abstractmethod
    async def get_uncertain_trades(self) -> list[dict[str, Any]]:
        """Get trades with status='unknown' that need reconciliation."""
        ...


# ---------------------------------------------------------------------------
# Bot Status Repository
# ---------------------------------------------------------------------------

class BotStatusRepository(ABC):
    """Abstract interface for bot operational status."""

    @abstractmethod
    async def get_status(self) -> dict[str, Any]:
        """Get current bot status."""
        ...

    @abstractmethod
    async def update_status(self, status: dict[str, Any]) -> None:
        """Update bot status (partial update)."""
        ...

    @abstractmethod
    async def set_heartbeat(self) -> None:
        """Update last_heartbeat_at to now."""
        ...

    @abstractmethod
    async def set_btc_tick(self, price: Decimal, momentum: Decimal, volatility: Decimal) -> None:
        """Record latest BTC data tick."""
        ...

    @abstractmethod
    async def set_feed_status(self, feed_name: str, status: str, last_message_at: datetime | None = None) -> None:
        """Update feed health status."""
        ...


# ---------------------------------------------------------------------------
# Risk Repository
# ---------------------------------------------------------------------------

class RiskRepository(ABC):
    """Abstract interface for risk state persistence."""

    @abstractmethod
    async def load_risk_state(self) -> dict[str, Any]:
        """Load risk state (consecutive losses, cooldown, active market, etc.)."""
        ...

    @abstractmethod
    async def save_risk_state(self, state: dict[str, Any]) -> None:
        """Save risk state."""
        ...

    @abstractmethod
    async def add_uncertain_market(self, market_id: str) -> None:
        """Add market to uncertain list."""
        ...

    @abstractmethod
    async def remove_uncertain_market(self, market_id: str) -> None:
        """Remove market from uncertain list."""
        ...


# ---------------------------------------------------------------------------
# Market Repository
# ---------------------------------------------------------------------------

class MarketRepository(ABC):
    """Abstract interface for market state persistence."""

    @abstractmethod
    async def save_active_market(self, market_id: str, event_id: str, metadata: dict[str, Any]) -> None:
        """Save current active market."""
        ...

    @abstractmethod
    async def get_active_market(self) -> dict[str, Any] | None:
        """Get current active market."""
        ...

    @abstractmethod
    async def clear_active_market(self) -> None:
        """Clear active market (after resolution)."""
        ...


# ---------------------------------------------------------------------------
# Market Outcome Repository
# ---------------------------------------------------------------------------

class MarketOutcomeRepository(ABC):
    """Abstract interface for immutable market outcomes.

    Each resolved market has exactly one outcome record.
    Predictions join to this to compute calibration/Brier.
    """

    @abstractmethod
    async def save_outcome(self, outcome: dict[str, Any]) -> None:
        """Save a market outcome (idempotent — updates if already exists)."""
        ...

    @abstractmethod
    async def get_outcome(self, market_id: str) -> dict[str, Any] | None:
        """Get the resolved outcome for a market."""
        ...

    @abstractmethod
    async def get_outcomes(
        self, limit: int = 50, offset: int = 0
    ) -> list[dict[str, Any]]:
        """Get resolved outcomes with pagination."""
        ...


# ---------------------------------------------------------------------------
# Event Log Repository
# ---------------------------------------------------------------------------

class EventLogRepository(ABC):
    """Abstract interface for operational event logging."""

    @abstractmethod
    async def log_event(self, event: str, **fields: Any) -> None:
        """Log an operational event."""
        ...

    @abstractmethod
    async def get_events(
        self, limit: int = 100, event_type: str | None = None
    ) -> list[dict[str, Any]]:
        """Get recent events with optional filter."""
        ...
