"""Database models for Bayse Bot API."""
from __future__ import annotations
from datetime import datetime, timezone
from decimal import Decimal
from sqlalchemy import (
    Column, String, Numeric, Boolean, DateTime, Integer, Text, JSON,
    create_engine, Index
)
from sqlalchemy.orm import DeclarativeBase, sessionmaker


class Base(DeclarativeBase):
    pass


class Prediction(Base):
    """Prediction record from the bot.

    Each row is one snapshot of a market evaluation. Multiple snapshots
    per market_id are allowed — this captures how the model's output
    changes as BTC price and time evolve.
    """
    __tablename__ = "predictions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    market_id = Column(String(255), nullable=False, index=True)  # NOT unique — multiple snapshots per market
    event_id = Column(String(255), nullable=False, index=True)
    title = Column(String(500), nullable=False)

    # Contract state
    strike_price = Column(Numeric(20, 8), nullable=False)
    current_btc_price = Column(Numeric(20, 8), nullable=False)
    distance_from_strike_pct = Column(Numeric(10, 6), nullable=False)
    is_above_strike = Column(Boolean, nullable=False)
    seconds_remaining = Column(Integer, nullable=False)
    seconds_elapsed = Column(Integer, nullable=False)
    realized_volatility = Column(Numeric(10, 6), nullable=False)
    momentum_pct = Column(Numeric(10, 6), nullable=False)

    # Book state
    yes_ask = Column(Numeric(10, 6))
    no_ask = Column(Numeric(10, 6))
    spread = Column(Numeric(10, 6))

    # Strategy output
    strategy = Column(String(100), nullable=False)
    probability = Column(Numeric(10, 6))
    predicted_outcome = Column(String(10))
    edge = Column(Numeric(10, 6))
    edge_fee = Column(Numeric(10, 6))  # Fee-adjusted edge
    signal_strength = Column(Numeric(10, 6))
    approved = Column(Boolean, default=False)
    reasons = Column(JSON)

    # Metadata
    strategy_version = Column(String(20), default="2")
    experiment_tag = Column(String(100), default="distance_to_strike_v1")

    # Timestamps (multi-granularity)
    observed_at = Column(DateTime(timezone=True))       # when market was first seen in scan
    decided_at = Column(DateTime(timezone=True))        # when model produced its output
    recorded_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))

    # Contract timing (from ContractState)
    opened_at = Column(DateTime(timezone=True))
    closes_at = Column(DateTime(timezone=True))
    volume_ratio = Column(Numeric(10, 6))

    # Outcome IDs (for resolution mapping)
    outcome1_id = Column(String(255))
    outcome2_id = Column(String(255))

    # Resolution
    outcome_resolution = Column(String(20), default="pending")
    actual_price = Column(Numeric(20, 8))
    resolved_at = Column(DateTime(timezone=True))
    resolved_outcome_id = Column(String(255))  # raw Bayse value for audit trail
    prediction_correct = Column(Boolean)
    brier_score = Column(Numeric(10, 6))

    # Indexes
    __table_args__ = (
        Index("ix_predictions_market_time", "market_id", "recorded_at"),
        Index("ix_predictions_resolution", "outcome_resolution"),
        Index("ix_predictions_recorded", "recorded_at"),
    )


class BotStatus(Base):
    """Bot operational status."""
    __tablename__ = "bot_status"

    id = Column(Integer, primary_key=True, default=1)
    is_running = Column(Boolean, default=False)
    mode = Column(String(50), default="observation")
    strategy = Column(String(100), default="distance_to_strike")
    last_cycle_at = Column(DateTime(timezone=True))
    last_btc_price = Column(Numeric(20, 8))
    last_momentum_pct = Column(Numeric(10, 6))
    last_volatility = Column(Numeric(10, 6))
    total_predictions = Column(Integer, default=0)
    total_resolved = Column(Integer, default=0)
    total_correct = Column(Integer, default=0)
    brier_mean = Column(Numeric(10, 6))
    uptime_seconds = Column(Integer, default=0)
    error_count = Column(Integer, default=0)
    last_error = Column(Text)  # Actual error messages (string)
    feed_health = Column(JSON)  # Feed health status (separate from errors)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class TradeRecord(Base):
    """Trade execution record."""
    __tablename__ = "trades"

    id = Column(Integer, primary_key=True, autoincrement=True)
    market_id = Column(String(255), nullable=False, index=True)
    event_id = Column(String(255), nullable=False)
    outcome = Column(String(10), nullable=False)
    side = Column(String(10), nullable=False, default="BUY")
    amount = Column(Numeric(20, 8), nullable=False)
    price = Column(Numeric(10, 6), nullable=False)
    shares = Column(Numeric(20, 8))
    fee = Column(Numeric(10, 6))
    status = Column(String(50), default="pending")
    mode = Column(String(50), default="paper")
    order_id = Column(String(255))
    recorded_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    settled = Column(Boolean, default=False)
    pnl = Column(Numeric(20, 8))
