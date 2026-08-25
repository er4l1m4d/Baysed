"""Resolution tracker — matches resolved Bayse events against pending predictions.

When a 15-minute contract expires, the Bayse API marks it as "resolved" with
a `resolvedOutcomeId` on each market. This module:
1. Queries resolved events from Bayse
2. Matches them against pending predictions
3. Updates prediction records with the actual outcome
4. Logs Brier score and calibration metrics

Now uses repository pattern for persistence.
"""
from __future__ import annotations
import logging
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from ..repositories.interfaces import PredictionRepository

log = logging.getLogger(__name__)


class ResolutionTracker:
    """Tracks and resolves predictions against Bayse outcome data."""

    def __init__(self, repository: PredictionRepository):
        self.repository = repository

    async def resolve_from_events(self, resolved_events: list[dict[str, Any]]) -> int:
        """Match resolved events against pending predictions. Returns count of newly resolved predictions."""
        if not resolved_events:
            return 0

        pending = await self.repository.get_pending_predictions()
        if not pending:
            return 0

        # Build lookup: market_id -> resolved event data
        market_resolution: dict[str, dict[str, Any]] = {}
        for event in resolved_events:
            event_close_value = event.get("eventCloseValue")
            for market in event.get("markets", []):
                market_id = market.get("id") or market.get("marketId") or market.get("market_id")
                if not market_id:
                    continue
                resolved_outcome_id = market.get("resolvedOutcomeId") or market.get("resolved_outcome_id")
                if resolved_outcome_id:
                    market_resolution[market_id] = {
                        "resolved_outcome_id": resolved_outcome_id,
                        "event_close_value": event_close_value,
                        "market_close_value": market.get("marketCloseValue") or market.get("market_close_value"),
                        "status": market.get("status", "resolved"),
                    }

        # Match against pending predictions
        resolved_count = 0

        for record in pending:
            market_id = record.get("market_id")
            if not market_id or market_id not in market_resolution:
                continue

            resolution = market_resolution[market_id]

            # Determine which outcome won
            strike = Decimal(str(record.get("strike_price", 0)))
            close_value = resolution.get("event_close_value") or resolution.get("market_close_value")

            if close_value and strike > 0:
                close_decimal = Decimal(str(close_value))
                # BTC above strike at close -> YES/UP won
                actual_won = "YES" if close_decimal >= strike else "NO"
            else:
                # Can't determine resolution without close value
                continue

            # Update record
            predicted = record.get("predicted_outcome", "")
            was_correct = predicted == actual_won

            # Calculate Brier score
            probability = Decimal(str(record.get("probability", 0.5)))
            if actual_won == "YES":
                brier_score = (probability - Decimal("1")) ** 2
            else:
                brier_score = (probability - Decimal("0")) ** 2

            # Update in database
            await self.repository.update_resolution(
                market_id=market_id,
                outcome_resolution=f"{actual_won.lower()}_won",
                actual_price=Decimal(str(close_value)) if close_value else None,
                prediction_correct=was_correct,
                brier_score=brier_score,
            )

            resolved_count += 1
            log.info("resolved: %s | predicted=%s actual=%s correct=%s brier=%.4f",
                record.get("title", "")[:30], predicted, actual_won, was_correct, brier_score)

        return resolved_count

    async def calibration_stats(self) -> dict[str, Any]:
        """Get calibration statistics from repository."""
        return await self.repository.get_calibration_stats()
