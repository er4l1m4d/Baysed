from __future__ import annotations
import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from .config import Settings

try:
    WAT=ZoneInfo("Africa/Lagos")
except ZoneInfoNotFoundError:  # Minimal containers without system tzdata; Lagos is permanently UTC+1.
    WAT=timezone(timedelta(hours=1), name="Africa/Lagos")
@dataclass
class RiskState:
    consecutive_losses: int=0; cooldown_until: str|None=None; active_market_id: str|None=None; uncertain_market_ids: list[str]=field(default_factory=list); daily_pnl: str="0"; trade_count: int=0

class RiskManager:
    def __init__(self, settings: Settings): self.s=settings; self.state=self._load()
    def _load(self):
        if self.s.state_path.exists(): return RiskState(**json.loads(self.s.state_path.read_text()))
        return RiskState()
    def persist(self):
        self.s.state_path.parent.mkdir(parents=True, exist_ok=True)
        self.s.state_path.write_text(json.dumps(asdict(self.state),sort_keys=True))
    def in_window(self, now: datetime) -> bool:
        local=now.astimezone(WAT).time()
        for window in self.s.windows.split(","):
            start,end=window.strip().split("-")
            if datetime.strptime(start,"%H:%M").time() <= local <= datetime.strptime(end,"%H:%M").time(): return True
        return False
    def approve(self, market_id:str, now:datetime|None=None)->list[str]:
        now=now or datetime.now(timezone.utc); r=[]
        if self.s.kill_switch:r.append("kill_switch_enabled")
        if not self.in_window(now):r.append("outside_wat_trading_window")
        if self.state.active_market_id:r.append("active_position_or_order_exists")
        if market_id in self.state.uncertain_market_ids:r.append("market_requires_manual_review")
        if self.state.cooldown_until and now < datetime.fromisoformat(self.state.cooldown_until):r.append("loss_streak_cooldown")
        if self.s.max_trades and self.state.trade_count>=self.s.max_trades:r.append("daily_trade_cap")
        if self.s.daily_loss_limit and Decimal(self.state.daily_pnl)<=-self.s.daily_loss_limit:r.append("daily_loss_limit")
        return r
    def opened(self, market_id:str): self.state.active_market_id=market_id; self.state.trade_count+=1; self.persist()
    def uncertain(self, market_id:str):
        if market_id not in self.state.uncertain_market_ids:self.state.uncertain_market_ids.append(market_id)
        self.state.active_market_id=None; self.persist()
    def closed(self,pnl:Decimal|None,when:datetime|None=None):
        self.state.active_market_id=None
        if pnl is not None:
            self.state.daily_pnl=str(Decimal(self.state.daily_pnl)+pnl)
            if pnl<0:
                self.state.consecutive_losses+=1
                if self.state.consecutive_losses>=3:self.state.cooldown_until=((when or datetime.now(timezone.utc))+timedelta(hours=1)).isoformat()
            elif pnl>0: self.state.consecutive_losses=0; self.state.cooldown_until=None
            # Flat/unknown: deliberately preserve loss streak; no fabricated conclusion.
        self.persist()
