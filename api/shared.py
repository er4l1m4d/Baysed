"""Shared state for API + Bot engine in the same process."""
from __future__ import annotations
from decimal import Decimal
from datetime import datetime, timezone
from bayse_bot.feed import MarketState

# Global shared state — both API and bot engine use this
shared_state = MarketState()

# Bot engine diagnostics (mutable dict so run.py can write to it)
bot_diagnostics: dict = {
    "error": None,
    "started": False,
    "init_error": None,
    "cycles": 0,
    "discovered_events": 0,
    "discovered_markets": 0,
    "discovery_error": None,
    "last_discovery_at": None,
    "last_prediction_at": None,
    "last_resolution_at": None,
}

# Current discovered/evaluated market. This is operational live state, not history.
active_market: dict | None = None
