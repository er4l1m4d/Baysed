"""Resolution tracker — matches resolved Bayse events against pending predictions.

When a 15-minute contract expires, the Bayse API marks it as "resolved" with
a `resolvedOutcomeId` on each market. This module:
1. Queries resolved events from Bayse
2. Matches them against pending predictions using resolvedOutcomeId (canonical)
3. Saves immutable MarketOutcome record (one per market)
4. Updates the LATEST prediction snapshot with the actual outcome
5. Calculates Brier score as (predicted_prob - actual_outcome)^2

The MarketOutcome is the canonical resolution record — once saved, it never
changes. Predictions reference it via market_id for calibration.

Resolution is transactional: BEGIN, save outcome, update prediction, COMMIT.

Additionally, for predictions on markets whose closes_at is in the past but
that don't appear in the latest resolved events batch (aged out of API pagination),
we resolve using BTC price at close time vs strike price (same source Bayse uses).
"""
from __future__ import annotations
import logging
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from .predictions import outcome_from_bayse_resolved, PredictionOutcome
from .repositories.interfaces import PredictionRepository, MarketOutcomeRepository

log = logging.getLogger(__name__)


class ResolutionTracker:
    """Tracks and resolves predictions against Bayse outcome data."""

    def __init__(self, prediction_repo: PredictionRepository, outcome_repo: MarketOutcomeRepository):
        self.prediction_repo = prediction_repo
        self.outcome_repo = outcome_repo

    async def resolve_from_events(self, resolved_events: list[dict[str, Any]]) -> tuple[int, list[str]]:
        """Match resolved events against pending predictions.

        Returns (count of newly resolved predictions, list of resolved market IDs).
        Uses resolvedOutcomeId as canonical resolution source.

        For each resolved market:
        - Save immutable MarketOutcome (idempotent, one per market)
        - Update the LATEST prediction snapshot with resolution data
        - Leave older snapshots as historical records
        """
        if not resolved_events:
            return 0, []

        # Build lookup: market_id -> resolved event data
        market_resolution: dict[str, dict[str, Any]] = {}
        for event in resolved_events:
            event_close_value = event.get("eventCloseValue")
            event_id = event.get("id", "")
            for market in event.get("markets", []):
                market_id = market.get("id") or market.get("marketId") or market.get("market_id")
                if not market_id:
                    continue
                resolved_outcome_id = market.get("resolvedOutcomeId") or market.get("resolved_outcome_id")
                if resolved_outcome_id:
                    market_resolution[market_id] = {
                        "event_id": event_id,
                        "resolved_outcome_id": resolved_outcome_id,
                        "event_close_value": event_close_value,
                        "market_close_value": market.get("marketCloseValue") or market.get("market_close_value"),
                        "status": market.get("status", "resolved"),
                    }

        if not market_resolution:
            log.info("resolution: no markets with resolvedOutcomeId in resolved events")
            return 0, []

        # Only fetch pending predictions for resolved markets (not all pending)
        pending = await self.prediction_repo.get_pending_predictions_for_markets(
            list(market_resolution.keys())
        )
        log.info("resolution: %d resolved markets, %d matching pending predictions",
            len(market_resolution), len(pending))

        # Match against pending predictions
        resolved_count = 0
        resolved_market_ids = []

        for record in pending:
            market_id = record.get("market_id")
            if not market_id or market_id not in market_resolution:
                continue

            resolution = market_resolution[market_id]
            resolved_outcome_id = resolution["resolved_outcome_id"]

            # Get outcome IDs from the prediction record
            outcome1_id = record.get("outcome1_id", "")
            outcome2_id = record.get("outcome2_id", "")

            # Use resolvedOutcomeId as canonical resolution (not price heuristic)
            actual_won = outcome_from_bayse_resolved(resolved_outcome_id, outcome1_id, outcome2_id)

            # Get close price for audit trail
            actual_price = None
            close_value = resolution.get("event_close_value") or resolution.get("market_close_value")
            if close_value:
                try:
                    actual_price = Decimal(str(close_value))
                except Exception:
                    pass

            # Save immutable MarketOutcome (idempotent)
            await self.outcome_repo.save_outcome({
                "market_id": market_id,
                "event_id": resolution.get("event_id", ""),
                "resolved_outcome_id": resolved_outcome_id,
                "outcome_resolution": actual_won,
                "event_close_value": str(close_value) if close_value else None,
                "btc_close_price": actual_price,
                "resolved_at": datetime.now(timezone.utc),
            })

            # Calculate Brier score: (predicted_prob - actual_outcome)^2
            probability = Decimal(str(record.get("probability", 0.5)))
            actual_binary = Decimal("1") if actual_won == PredictionOutcome.YES_WON.value else Decimal("0")
            brier_score = (probability - actual_binary) ** 2

            # Determine correctness
            predicted = record.get("predicted_outcome", "")
            was_correct = predicted == actual_won

            # Update the LATEST prediction snapshot with resolution
            await self.prediction_repo.update_resolution(
                market_id=market_id,
                outcome_resolution=actual_won,
                actual_price=actual_price,
                prediction_correct=was_correct,
                brier_score=brier_score,
                resolved_outcome_id=resolved_outcome_id,
            )

            resolved_count += 1
            resolved_market_ids.append(market_id)
            log.info("resolved: %s | predicted=%s actual=%s correct=%s brier=%.4f source=resolvedOutcomeId",
                record.get("title", "")[:30], predicted, actual_won, was_correct, brier_score)

        return resolved_count, resolved_market_ids

    async def resolve_aged_out_predictions(self, btc_price: Decimal) -> tuple[int, list[str]]:
        """Resolve predictions on markets whose closes_at is in the past
        but that weren't found in the latest resolved events batch.

        Uses BTC price at close time vs strike price (same resolution source as Bayse).
        This handles the case where old predictions have fallen off the API's
        resolved events pagination.
        """
        resolved_count = 0
        resolved_market_ids = []

        try:
            # Get all pending predictions
            all_pending = await self.prediction_repo.get_pending_predictions()
            now = datetime.now(timezone.utc)

            for record in all_pending:
                market_id = record.get("market_id")
                closes_at_str = record.get("closes_at")
                if not market_id or not closes_at_str:
                    continue

                # Parse closes_at
                try:
                    if isinstance(closes_at_str, str):
                        closes_at = datetime.fromisoformat(closes_at_str.replace("Z", "+00:00"))
                    else:
                        closes_at = closes_at_str
                except Exception:
                    continue

                # Skip if market hasn't closed yet (with 60s buffer for API lag)
                if closes_at > now or (now - closes_at).total_seconds() < 60:
                    continue

                # Skip if already resolved
                outcome = await self.outcome_repo.get_outcome(market_id)
                if outcome:
                    continue

                # Determine resolution from BTC price vs strike
                strike_price = Decimal(str(record.get("strike_price", 0)))
                if strike_price <= 0:
                    continue

                # YES wins if BTC closed above strike
                yes_won = btc_price >= strike_price
                outcome_resolution = PredictionOutcome.YES_WON.value if yes_won else PredictionOutcome.NO_WON.value

                # Save MarketOutcome
                await self.outcome_repo.save_outcome({
                    "market_id": market_id,
                    "event_id": record.get("event_id", ""),
                    "resolved_outcome_id": "",  # Not available from API
                    "outcome_resolution": outcome_resolution,
                    "event_close_value": str(btc_price),
                    "btc_close_price": btc_price,
                    "resolved_at": now,
                })

                # Calculate Brier score
                probability = Decimal(str(record.get("probability", 0.5)))
                actual_binary = Decimal("1") if yes_won else Decimal("0")
                brier_score = (probability - actual_binary) ** 2

                # Determine correctness
                predicted = record.get("predicted_outcome", "")
                was_correct = predicted == outcome_resolution

                # Update the LATEST prediction snapshot
                await self.prediction_repo.update_resolution(
                    market_id=market_id,
                    outcome_resolution=outcome_resolution,
                    actual_price=btc_price,
                    prediction_correct=was_correct,
                    brier_score=brier_score,
                    resolved_outcome_id="",
                )

                resolved_count += 1
                resolved_market_ids.append(market_id)
                log.info("resolved_aged: %s | predicted=%s actual=%s correct=%s brier=%.4f source=btc_vs_strike",
                    record.get("title", "")[:30], predicted, outcome_resolution, was_correct, brier_score)

        except Exception as exc:
            log.warning("resolve_aged_out failed: %s: %s", type(exc).__name__, exc)

        return resolved_count, resolved_market_ids

    async def calibration_stats(self) -> dict[str, Any]:
        """Get calibration statistics from repository."""
        return await self.prediction_repo.get_calibration_stats()
