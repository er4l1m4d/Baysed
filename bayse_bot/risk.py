"""Risk management for Bayse Bot.

Now uses repository pattern for state persistence (PostgreSQL in production,
SQLite for local development).
"""
from __future__ import annotations
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .config import Settings
from .repositories.interfaces import RiskRepository

try:
    WAT = ZoneInfo("Africa/Lagos")
except ZoneInfoNotFoundError:
    WAT = timezone(timedelta(hours=1), name="Africa/Lagos")


@dataclass
class RiskState:
    """Risk state data class."""
    consecutive_losses: int = 0
    cooldown_until: str | None = None
    active_market_id: str | None = None
    uncertain_market_ids: list[str] = field(default_factory=list)
    daily_pnl: str = "0"
    trade_count: int = 0

    def to_dict(self) -> dict:
        """Convert to dictionary for persistence."""
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> "RiskState":
        """Create from dictionary."""
        return cls(
            consecutive_losses=data.get("consecutive_losses", 0),
            cooldown_until=data.get("cooldown_until"),
            active_market_id=data.get("active_market_id"),
            uncertain_market_ids=data.get("uncertain_market_ids", []),
            daily_pnl=data.get("daily_pnl", "0"),
            trade_count=data.get("trade_count", 0),
        )


class RiskManager:
    """Risk manager with repository-backed persistence."""

    def __init__(self, settings: Settings, repository: RiskRepository):
        self.s = settings
        self.repository = repository
        self.state = RiskState()

    async def load(self) -> None:
        """Load risk state from repository."""
        data = await self.repository.load_risk_state()
        self.state = RiskState.from_dict(data)

    async def persist(self) -> None:
        """Save risk state to repository."""
        await self.repository.save_risk_state(self.state.to_dict())

    def in_window(self, now: datetime) -> bool:
        """Check if current time is within trading window."""
        local = now.astimezone(WAT).time()
        for window in self.s.windows.split(","):
            start, end = window.strip().split("-")
            if datetime.strptime(start, "%H:%M").time() <= local <= datetime.strptime(end, "%H:%M").time():
                return True
        return False

    async def approve(self, market_id: str, now: datetime | None = None) -> list[str]:
        """Check if trading is allowed for this market."""
        now = now or datetime.now(timezone.utc)
        r = []
        if self.s.kill_switch:
            r.append("kill_switch_enabled")
        if not self.in_window(now):
            r.append("outside_wat_trading_window")
        if self.state.active_market_id:
            r.append("active_position_or_order_exists")
        if market_id in self.state.uncertain_market_ids:
            r.append("market_requires_manual_review")
        if self.state.cooldown_until and now < datetime.fromisoformat(self.state.cooldown_until):
            r.append("loss_streak_cooldown")
        if self.s.max_trades and self.state.trade_count >= self.s.max_trades:
            r.append("daily_trade_cap")
        if self.s.daily_loss_limit and Decimal(self.state.daily_pnl) <= -self.s.daily_loss_limit:
            r.append("daily_loss_limit")
        return r

    async def opened(self, market_id: str) -> None:
        """Mark position as opened."""
        self.state.active_market_id = market_id
        self.state.trade_count += 1
        await self.persist()

    async def uncertain(self, market_id: str) -> None:
        """Mark market as uncertain (needs reconciliation)."""
        if market_id not in self.state.uncertain_market_ids:
            self.state.uncertain_market_ids.append(market_id)
        self.state.active_market_id = None
        await self.persist()

    async def closed(self, pnl: Decimal | None, when: datetime | None = None) -> None:
        """Mark position as closed with PnL."""
        self.state.active_market_id = None
        if pnl is not None:
            self.state.daily_pnl = str(Decimal(self.state.daily_pnl) + pnl)
            if pnl < 0:
                self.state.consecutive_losses += 1
                if self.state.consecutive_losses >= 3:
                    self.state.cooldown_until = (
                        (when or datetime.now(timezone.utc)) + timedelta(hours=1)
                    ).isoformat()
            elif pnl > 0:
                self.state.consecutive_losses = 0
                self.state.cooldown_until = None
        await self.persist()
