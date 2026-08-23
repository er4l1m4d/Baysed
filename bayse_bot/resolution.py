"""Resolution tracker — matches resolved Bayse events against pending predictions.

When a 15-minute contract expires, the Bayse API marks it as "resolved" with
a `resolvedOutcomeId` on each market. This module:
1. Queries resolved events from Bayse
2. Matches them against pending predictions
3. Updates prediction records with the actual outcome
4. Logs Brier score and calibration metrics
"""
from __future__ import annotations
import json
import logging
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)


class ResolutionTracker:
    """Tracks and resolves predictions against Bayse outcome data."""

    def __init__(self, predictions_dir: Path):
        self.predictions_dir = predictions_dir
        self.predictions_file = predictions_dir / "predictions.jsonl"

    def load_pending(self) -> list[dict[str, Any]]:
        """Load all predictions with outcome_resolution='pending'."""
        if not self.predictions_file.exists():
            return []
        pending = []
        with self.predictions_file.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                    if record.get("outcome_resolution") == "pending":
                        pending.append(record)
                except json.JSONDecodeError:
                    continue
        return pending

    def resolve_from_events(self, resolved_events: list[dict[str, Any]]) -> int:
        """Match resolved events against pending predictions. Returns count of newly resolved predictions."""
        if not resolved_events:
            return 0

        pending = self.load_pending()
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
        updated_records = []

        for record in pending:
            market_id = record.get("market_id")
            if not market_id or market_id not in market_resolution:
                updated_records.append(record)
                continue

            resolution = market_resolution[market_id]
            resolved_outcome_id = resolution["resolved_outcome_id"]

            # Determine which outcome won
            # outcome1_id = Up/Yes, outcome2_id = Down/No
            # We need to check which outcome ID matches the resolved one
            outcome1_id = record.get("outcome1_id")  # Not in PredictionRecord yet
            outcome2_id = record.get("outcome2_id")  # Not in PredictionRecord yet

            # Simple heuristic: if we don't have outcome IDs, check the predicted outcome
            # and the close value against strike
            predicted = record.get("predicted_outcome", "")
            strike = Decimal(str(record.get("strike_price", 0)))
            close_value = resolution.get("event_close_value") or resolution.get("market_close_value")

            if close_value and strike > 0:
                close_decimal = Decimal(str(close_value))
                # BTC above strike at close -> YES/UP won
                actual_won = "YES" if close_decimal >= strike else "NO"
            else:
                # Fallback: can't determine resolution without close value
                updated_records.append(record)
                continue

            # Update record
            record["outcome_resolution"] = f"{actual_won.lower()}_won"
            record["actual_price"] = str(close_value) if close_value else None
            record["resolved_at"] = datetime.now(timezone.utc).isoformat()

            # Calculate if prediction was correct
            was_correct = predicted == actual_won
            record["prediction_correct"] = was_correct

            # Calculate Brier score for this prediction
            probability = Decimal(str(record.get("probability", 0.5)))
            if actual_won == "YES":
                actual_score = (probability - Decimal("1")) ** 2
            else:
                actual_score = (probability - Decimal("0")) ** 2
            record["brier_score"] = str(actual_score)

            updated_records.append(record)
            resolved_count += 1

            log.info("resolved: %s | predicted=%s actual=%s correct=%s brier=%.4f",
                record.get("title", "")[:30], predicted, actual_won, was_correct, actual_score)

        # Rewrite predictions file with updated records
        self._rewrite_predictions(updated_records)

        return resolved_count

    def _rewrite_predictions(self, records: list[dict[str, Any]]) -> None:
        """Rewrite predictions.jsonl with updated records."""
        if not self.predictions_file.exists():
            return

        # Read all records (including already resolved ones)
        all_records = []
        with self.predictions_file.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    all_records.append(json.loads(line))
                except json.JSONDecodeError:
                    continue

        # Merge updated records back
        updated_ids = {r.get("market_id") for r in records}
        final_records = []
        for record in all_records:
            market_id = record.get("market_id")
            if market_id in updated_ids:
                # Find the updated version
                updated = next((r for r in records if r.get("market_id") == market_id), record)
                final_records.append(updated)
            else:
                final_records.append(record)

        # Write back
        with self.predictions_file.open("w", encoding="utf-8") as f:
            for record in final_records:
                f.write(json.dumps(record, sort_keys=True, ensure_ascii=False) + "\n")

    def calibration_stats(self) -> dict[str, Any]:
        """Calculate calibration statistics from resolved predictions."""
        if not self.predictions_file.exists():
            return {"total": 0, "resolved": 0, "brier_mean": None, "calibration": []}

        all_records = []
        with self.predictions_file.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    all_records.append(json.loads(line))
                except json.JSONDecodeError:
                    continue

        resolved = [r for r in all_records if r.get("outcome_resolution") != "pending"]

        if not resolved:
            return {"total": len(all_records), "resolved": 0, "brier_mean": None, "calibration": []}

        # Calculate mean Brier score
        brier_scores = [Decimal(r.get("brier_score", "0")) for r in resolved if "brier_score" in r]
        brier_mean = sum(brier_scores) / len(brier_scores) if brier_scores else None

        # Calibration buckets: group by predicted probability, check actual win rate
        buckets: dict[str, list[dict]] = {}
        for r in resolved:
            prob = Decimal(str(r.get("probability", 0.5)))
            # Bucket: 0.0-0.1, 0.1-0.2, ..., 0.9-1.0
            bucket_idx = min(int(prob * 10), 9)
            bucket_key = f"{bucket_idx * 10}-{(bucket_idx + 1) * 10}%"
            if bucket_key not in buckets:
                buckets[bucket_key] = []
            buckets[bucket_key].append(r)

        calibration = []
        for bucket_key in sorted(buckets.keys()):
            bucket_records = buckets[bucket_key]
            total = len(bucket_records)
            correct = sum(1 for r in bucket_records if r.get("prediction_correct"))
            avg_prob = sum(Decimal(str(r.get("probability", 0.5))) for r in bucket_records) / total
            actual_rate = correct / total

            calibration.append({
                "bucket": bucket_key,
                "count": total,
                "avg_predicted": str(avg_prob),
                "actual_rate": f"{actual_rate:.3f}",
                "gap": str(avg_prob - Decimal(str(actual_rate))),
            })

        return {
            "total": len(all_records),
            "resolved": len(resolved),
            "brier_mean": str(brier_mean) if brier_mean else None,
            "calibration": calibration,
        }
