from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from decimal import Decimal
from enum import StrEnum
from typing import Any


class RunMode(StrEnum):
    OBSERVATION = "observation"
    PAPER = "paper"
    LIVE = "live"


class Outcome(StrEnum):
    YES = "YES"
    NO = "NO"


class OrderStatus(StrEnum):
    PENDING = "pending"
    OPEN = "open"
    PARTIAL_FILLED = "partial_filled"
    FILLED = "filled"
    CANCELLED = "cancelled"
    REJECTED = "rejected"
    EXPIRED = "expired"
    UNKNOWN = "unknown"


TERMINAL_ORDER_STATUSES = {OrderStatus.FILLED, OrderStatus.CANCELLED, OrderStatus.REJECTED, OrderStatus.EXPIRED}


class EventType(StrEnum):
    """Typed event names for operational logging."""
    CANDIDATE_REJECTED = "candidate_rejected"
    BOOK_ISSUES = "book_issues"
    MARKET_EVALUATED = "market_evaluated"
    MARKET_EVALUATION_FAILURE = "market_evaluation_failure"
    SCAN_FAILURE = "scan_failure"
    TRADE_ATTEMPT_FAILED = "trade_attempt_failed"
    LIVE_ORDER_AMBIGUOUS = "live_order_ambiguous"
    RESOLUTION_PROCESSED = "resolution_processed"
    PREDICTION_RECORDED = "prediction_recorded"


@dataclass(frozen=True)
class MarketOutcome:
    """Immutable outcome of a resolved market.

    This is the canonical resolution record — once set, it never changes.
    Predictions join to this via (market_id, resolved_at) to compute
    calibration and Brier scores.
    """
    market_id: str
    event_id: str
    resolved_outcome_id: str  # raw Bayse value
    outcome_resolution: str   # "yes_won" or "no_won"
    event_close_value: str | None = None
    btc_close_price: Decimal | None = None
    resolved_at: datetime | None = None


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


@dataclass(frozen=True)
class Market:
    event_id: str
    market_id: str
    title: str
    question: str
    engine: str
    currency: str
    outcomes: tuple[str, ...]
    status: str
    opens_at: datetime | None
    closes_at: datetime | None
    resolution_rules: str | None
    resolution_source: str | None
    strike_price: Decimal | None = None
    series_slug: str | None = None
    outcome1_id: str | None = None
    outcome2_id: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class BookLevel:
    price: Decimal
    quantity: Decimal


@dataclass(frozen=True)
class OrderBook:
    market_id: str
    outcome: Outcome
    bids: tuple[BookLevel, ...]
    asks: tuple[BookLevel, ...]
    captured_at: datetime

    @property
    def best_bid(self) -> Decimal | None: return self.bids[0].price if self.bids else None
    @property
    def best_ask(self) -> Decimal | None: return self.asks[0].price if self.asks else None
    @property
    def spread(self) -> Decimal | None:
        return self.best_ask - self.best_bid if self.best_ask is not None and self.best_bid is not None else None
    @property
    def relative_spread(self) -> Decimal | None:
        return self.spread / self.best_ask if self.spread is not None and self.best_ask else None

    def depth_at_or_better(self, side: str, limit: Decimal) -> Decimal:
        levels = self.asks if side.upper() == "BUY" else self.bids
        return sum((l.price * l.quantity for l in levels if (l.price <= limit if side.upper() == "BUY" else l.price >= limit)), Decimal("0"))


@dataclass(frozen=True)
class Quote:
    side: str
    outcome: Outcome
    expected_price: Decimal
    expected_shares: Decimal
    fee: Decimal
    amount: Decimal
    complete_fill: bool
    captured_at: datetime
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class BTCFeatures:
    price: Decimal
    momentum_pct: Decimal
    volume_ratio: Decimal
    atr_pct: Decimal
    captured_at: datetime
    complete: bool


@dataclass(frozen=True)
class Decision:
    strategy: str
    outcome: Outcome | None
    probability: Decimal | None
    edge: Decimal | None
    strength: Decimal
    approved: bool
    reasons: tuple[str, ...]


@dataclass
class Position:
    market_id: str
    outcome: Outcome
    shares: Decimal
    entry_price: Decimal
    opened_at: datetime
    status: str = "open"
    mfe: Decimal = Decimal("0")
    mae: Decimal = Decimal("0")
    settled: bool = False


def to_jsonable(value: Any) -> Any:
    if isinstance(value, Decimal): return str(value)
    if isinstance(value, datetime): return value.isoformat()
    if isinstance(value, StrEnum): return value.value
    if hasattr(value, "__dataclass_fields__"): return {k: to_jsonable(v) for k, v in asdict(value).items()}
    if isinstance(value, dict): return {str(k): to_jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)): return [to_jsonable(v) for v in value]
    return value
