from __future__ import annotations
import os
from dataclasses import dataclass, field
from decimal import Decimal
from pathlib import Path
from .models import RunMode

def _decimal(name: str, default: str) -> Decimal: return Decimal(os.getenv(name, default))
def _bool(name: str, default: bool) -> bool: return os.getenv(name, str(default)).lower() in {"1", "true", "yes"}

@dataclass(frozen=True)
class Settings:
    mode: RunMode = field(default_factory=lambda: RunMode(os.getenv("BOT_RUN_MODE", "observation")))
    bayse_base_url: str = field(default_factory=lambda: os.getenv("BAYSE_BASE_URL", "https://relay.bayse.markets").rstrip("/"))
    public_key: str = field(default_factory=lambda: os.getenv("BAYSE_PUBLIC_KEY", ""))
    secret_key: str = field(default_factory=lambda: os.getenv("BAYSE_SECRET_KEY", ""))
    currency: str = field(default_factory=lambda: os.getenv("TRADE_CURRENCY", "NGN").upper())
    windows: str = field(default_factory=lambda: os.getenv("TRADING_WINDOWS", "14:00-22:00"))
    position_size: Decimal = field(default_factory=lambda: _decimal("POSITION_SIZE_NGN", "100"))
    max_trades: int = field(default_factory=lambda: int(os.getenv("MAX_TRADES_PER_DAY", "0")))
    daily_loss_limit: Decimal = field(default_factory=lambda: _decimal("DAILY_LOSS_LIMIT_NGN", "0"))
    kill_switch: bool = field(default_factory=lambda: _bool("KILL_SWITCH", False))
    state_path: Path = field(default_factory=lambda: Path(os.getenv("STATE_PATH", "state.json")))
    runs_dir: Path = field(default_factory=lambda: Path(os.getenv("RUNS_DIR", "runs")))
    min_liquidity: Decimal = field(default_factory=lambda: _decimal("MIN_ENTRY_LIQUIDITY_NGN", "300"))
    momentum_threshold: Decimal = field(default_factory=lambda: _decimal("MOMENTUM_THRESHOLD_PCT", "0.01"))
    momentum_window_seconds: int = field(default_factory=lambda: int(os.getenv("MOMENTUM_WINDOW_SECONDS", "120")))
    volume_multiplier: Decimal = field(default_factory=lambda: _decimal("VOLUME_SPIKE_MULTIPLIER", "0.5"))
    min_atr: Decimal = field(default_factory=lambda: _decimal("MIN_ATR_PCT", "0.03"))
    max_atr: Decimal = field(default_factory=lambda: _decimal("MAX_ATR_PCT", "1.50"))
    min_expiry: int = field(default_factory=lambda: int(os.getenv("MIN_TIME_TO_EXPIRY_SECONDS", "240")))
    max_expiry: int = field(default_factory=lambda: int(os.getenv("MAX_TIME_TO_EXPIRY_SECONDS", "480")))
    no_entry_expiry: int = field(default_factory=lambda: int(os.getenv("NO_ENTRY_BEFORE_EXPIRY_SECONDS", "90")))
    max_spread: Decimal = field(default_factory=lambda: _decimal("MAX_SPREAD", "0.06"))
    max_relative_spread: Decimal = field(default_factory=lambda: _decimal("MAX_RELATIVE_SPREAD", "0.12"))
    min_yes_price: Decimal = field(default_factory=lambda: _decimal("MIN_YES_ENTRY_PRICE", "0.47"))
    max_no_price: Decimal = field(default_factory=lambda: _decimal("MAX_NO_ENTRY_PRICE", "0.58"))
    min_displacement: Decimal = field(default_factory=lambda: _decimal("MIN_DISPLACEMENT", "0.03"))
    min_model_gap: Decimal = field(default_factory=lambda: _decimal("MIN_MODEL_ENTRY_GAP", "0.08"))
    max_model_gap: Decimal = field(default_factory=lambda: _decimal("MAX_MODEL_ENTRY_GAP", "0.18"))
    min_strength: Decimal = field(default_factory=lambda: _decimal("MIN_SIGNAL_STRENGTH", "0.35"))
    quote_max_age: int = field(default_factory=lambda: int(os.getenv("MAX_EXECUTION_QUOTE_AGE_S", "20")))
    execution_tolerance: Decimal = field(default_factory=lambda: _decimal("EXECUTION_PRICE_TOLERANCE_ABS", "0.01"))
    strategy: str = field(default_factory=lambda: os.getenv("STRATEGY", "mean_reversion_inversion"))
    btc_terms: tuple[str, ...] = field(default_factory=lambda: tuple(x.strip().lower() for x in os.getenv("BTC_MATCH_TERMS", "btc,bitcoin").split(",")))
    resolution_terms: tuple[str, ...] = field(default_factory=lambda: tuple(x.strip().lower() for x in os.getenv("RESOLUTION_REQUIRED_TERMS", "bybit,btc").split(",")))

    def validate_live(self) -> None:
        if self.mode is RunMode.LIVE and (not self.public_key or not self.secret_key):
            raise RuntimeError("live mode requires BAYSE_PUBLIC_KEY and BAYSE_SECRET_KEY")
