"""Shared state for API + Bot engine in the same process."""
from __future__ import annotations
from decimal import Decimal
from datetime import datetime, timezone
from .feed import MarketState

# Global shared state — both API and bot engine use this
shared_state = MarketState()
