"""Shared state for API + Bot engine in the same process."""
from __future__ import annotations
from decimal import Decimal
from datetime import datetime, timezone
from bayse_bot.feed import MarketState

# Global shared state — both API and bot engine use this
shared_state = MarketState()

# Bot engine diagnostics (mutable dict so run.py can write to it)
bot_diagnostics: dict = {"error": None, "started": False, "init_error": None, "cycles": 0}
