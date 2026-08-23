"""Model calibration and backtesting.

Analyzes resolved predictions to measure model performance:
- Brier score (overall and by time bucket)
- Calibration curves (predicted probability vs actual win rate)
- Edge decay (does the model's edge hold over time?)
- Parameter sensitivity (how do volatility scaling and time decay affect accuracy?)
"""
from __future__ import annotations
import json
import logging
from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)


def load_predictions(predictions_dir: Path) -> list[dict[str, Any]]:
    """Load all predictions from predictions.jsonl."""
    predictions_file = predictions_dir / "predictions.jsonl"
    if not predictions_file.exists():
        return []
    records = []
    with predictions_file.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return records


def compute_brier_score(predictions: list[dict[str, Any]]) -> Decimal | None:
    """Compute mean Brier score across resolved predictions."""
    resolved = [p for p in predictions if p.get("outcome_resolution") != "pending" and "brier_score" in p]
    if not resolved:
        return None
    scores = [Decimal(str(p["brier_score"])) for p in resolved]
    return sum(scores) / len(scores)


def compute_calibration_curve(predictions: list[dict[str, Any]], n_buckets: int = 10) -> list[dict[str, Any]]:
    """Compute calibration curve: predicted probability vs actual win rate.

    Returns list of buckets with:
    - bucket: probability range (e.g., "50-60%")
    - count: number of predictions in bucket
    - avg_predicted: average predicted probability
    - actual_rate: fraction that actually won
    - gap: avg_predicted - actual_rate (positive = overconfident)
    """
    resolved = [p for p in predictions if p.get("outcome_resolution") != "pending" and "probability" in p]
    if not resolved:
        return []

    buckets: dict[int, list[dict]] = defaultdict(list)
    for p in resolved:
        prob = Decimal(str(p["probability"]))
        bucket_idx = min(int(prob * n_buckets), n_buckets - 1)
        buckets[bucket_idx].append(p)

    curve = []
    for idx in range(n_buckets):
        if idx not in buckets:
            continue
        bucket_records = buckets[idx]
        total = len(bucket_records)
        correct = sum(1 for r in bucket_records if r.get("prediction_correct"))
        avg_prob = sum(Decimal(str(r["probability"])) for r in bucket_records) / total
        actual_rate = Decimal(str(correct / total))

        curve.append({
            "bucket": f"{idx * 100 // n_buckets}-{(idx + 1) * 100 // n_buckets}%",
            "count": total,
            "avg_predicted": str(avg_prob),
            "actual_rate": str(actual_rate),
            "gap": str(avg_prob - actual_rate),
        })

    return curve


def compute_edge_decay(predictions: list[dict[str, Any]], time_buckets: list[int] | None = None) -> list[dict[str, Any]]:
    """Analyze how model edge decays over time.

    Groups predictions by seconds_remaining at prediction time, then
    computes average edge and accuracy for each time bucket.
    """
    if time_buckets is None:
        time_buckets = [0, 60, 120, 180, 240, 300, 360, 420, 480, 540, 600, 660, 720, 780, 840, 900]

    resolved = [p for p in predictions if p.get("outcome_resolution") != "pending" and "edge" in p]
    if not resolved:
        return []

    # Group by time remaining
    time_groups: dict[str, list[dict]] = defaultdict(list)
    for p in resolved:
        seconds = int(p.get("seconds_remaining", 0))
        # Find the bucket this falls into
        for i in range(len(time_buckets) - 1):
            if time_buckets[i] <= seconds < time_buckets[i + 1]:
                bucket_key = f"{time_buckets[i]}-{time_buckets[i + 1]}s"
                time_groups[bucket_key].append(p)
                break
        else:
            time_groups["0-60s"].append(p)

    decay = []
    for bucket_key in sorted(time_groups.keys()):
        records = time_groups[bucket_key]
        total = len(records)
        correct = sum(1 for r in records if r.get("prediction_correct"))
        avg_edge = sum(Decimal(str(r["edge"])) for r in records) / total
        avg_prob = sum(Decimal(str(r["probability"])) for r in records) / total

        decay.append({
            "time_bucket": bucket_key,
            "count": total,
            "accuracy": f"{correct / total:.3f}",
            "avg_edge": str(avg_edge),
            "avg_probability": str(avg_prob),
        })

    return decay


def compute_parameter_sensitivity(predictions: list[dict[str, Any]]) -> dict[str, Any]:
    """Analyze how different model parameters affect accuracy.

    Groups predictions by volatility regime and distance-from-strike
    to identify where the model performs well/poorly.
    """
    resolved = [p for p in predictions if p.get("outcome_resolution") != "pending"]
    if not resolved:
        return {"volatility_regimes": [], "distance_regimes": []}

    # Volatility regimes
    vol_groups: dict[str, list[dict]] = defaultdict(list)
    for p in resolved:
        vol = Decimal(str(p.get("realized_volatility", 0)))
        if vol <= Decimal("0.03"):
            vol_groups["low_vol (<=0.03%)"].append(p)
        elif vol <= Decimal("0.10"):
            vol_groups["med_vol (0.03-0.10%)"].append(p)
        else:
            vol_groups["high_vol (>0.10%)"].append(p)

    vol_analysis = []
    for regime, records in sorted(vol_groups.items()):
        total = len(records)
        correct = sum(1 for r in records if r.get("prediction_correct"))
        brier_scores = [Decimal(str(r["brier_score"])) for r in records if "brier_score" in r]
        avg_brier = sum(brier_scores) / len(brier_scores) if brier_scores else None

        vol_analysis.append({
            "regime": regime,
            "count": total,
            "accuracy": f"{correct / total:.3f}" if total > 0 else "N/A",
            "avg_brier": str(avg_brier) if avg_brier else "N/A",
        })

    # Distance-from-strike regimes
    dist_groups: dict[str, list[dict]] = defaultdict(list)
    for p in resolved:
        dist = abs(Decimal(str(p.get("distance_from_strike_pct", 0))))
        if dist <= Decimal("0.02"):
            dist_groups["close (<=0.02%)"].append(p)
        elif dist <= Decimal("0.05"):
            dist_groups["medium (0.02-0.05%)"].append(p)
        elif dist <= Decimal("0.10"):
            dist_groups["far (0.05-0.10%)"].append(p)
        else:
            dist_groups["very_far (>0.10%)"].append(p)

    dist_analysis = []
    for regime, records in sorted(dist_groups.items()):
        total = len(records)
        correct = sum(1 for r in records if r.get("prediction_correct"))
        brier_scores = [Decimal(str(r["brier_score"])) for r in records if "brier_score" in r]
        avg_brier = sum(brier_scores) / len(brier_scores) if brier_scores else None

        dist_analysis.append({
            "regime": regime,
            "count": total,
            "accuracy": f"{correct / total:.3f}" if total > 0 else "N/A",
            "avg_brier": str(avg_brier) if avg_brier else "N/A",
        })

    return {
        "volatility_regimes": vol_analysis,
        "distance_regimes": dist_analysis,
    }


def generate_report(predictions_dir: Path) -> str:
    """Generate a full calibration report."""
    predictions = load_predictions(predictions_dir)
    resolved = [p for p in predictions if p.get("outcome_resolution") != "pending"]

    if not resolved:
        return "No resolved predictions yet. Run the bot to collect data."

    lines = []
    lines.append("=" * 60)
    lines.append("MODEL CALIBRATION REPORT")
    lines.append("=" * 60)
    lines.append("")

    # Overall stats
    total = len(predictions)
    n_resolved = len(resolved)
    correct = sum(1 for p in resolved if p.get("prediction_correct"))
    accuracy = correct / n_resolved if n_resolved > 0 else 0

    lines.append(f"Total predictions:    {total}")
    lines.append(f"Resolved:             {n_resolved}")
    lines.append(f"Pending:              {total - n_resolved}")
    lines.append(f"Correct:              {correct}")
    lines.append(f"Accuracy:             {accuracy:.3f}")
    lines.append("")

    # Brier score
    brier = compute_brier_score(predictions)
    if brier is not None:
        lines.append(f"Brier score (mean):   {brier}")
        # Interpret: 0 = perfect, 0.25 = coin flip, 1 = worst
        if brier < Decimal("0.15"):
            lines.append("  -> Good calibration (below 0.15)")
        elif brier < Decimal("0.25"):
            lines.append("  -> Moderate calibration (below 0.25)")
        else:
            lines.append("  -> Poor calibration (above 0.25)")
    lines.append("")

    # Calibration curve
    curve = compute_calibration_curve(predictions)
    if curve:
        lines.append("CALIBRATION CURVE")
        lines.append("-" * 60)
        lines.append(f"{'Bucket':<12} {'Count':<8} {'Avg Pred':<12} {'Actual':<12} {'Gap':<12}")
        lines.append("-" * 60)
        for bucket in curve:
            lines.append(f"{bucket['bucket']:<12} {bucket['count']:<8} {bucket['avg_predicted']:<12} {bucket['actual_rate']:<12} {bucket['gap']:<12}")
        lines.append("")

    # Edge decay
    decay = compute_edge_decay(predictions)
    if decay:
        lines.append("EDGE DECAY BY TIME REMAINING")
        lines.append("-" * 60)
        lines.append(f"{'Time':<16} {'Count':<8} {'Accuracy':<12} {'Avg Edge':<12} {'Avg Prob':<12}")
        lines.append("-" * 60)
        for d in decay:
            lines.append(f"{d['time_bucket']:<16} {d['count']:<8} {d['accuracy']:<12} {d['avg_edge']:<12} {d['avg_probability']:<12}")
        lines.append("")

    # Parameter sensitivity
    sensitivity = compute_parameter_sensitivity(predictions)
    if sensitivity["volatility_regimes"]:
        lines.append("VOLATILITY REGIME ANALYSIS")
        lines.append("-" * 60)
        lines.append(f"{'Regime':<24} {'Count':<8} {'Accuracy':<12} {'Avg Brier':<12}")
        lines.append("-" * 60)
        for v in sensitivity["volatility_regimes"]:
            lines.append(f"{v['regime']:<24} {v['count']:<8} {v['accuracy']:<12} {v['avg_brier']:<12}")
        lines.append("")

    if sensitivity["distance_regimes"]:
        lines.append("DISTANCE-FROM-STRIKE ANALYSIS")
        lines.append("-" * 60)
        lines.append(f"{'Regime':<24} {'Count':<8} {'Accuracy':<12} {'Avg Brier':<12}")
        lines.append("-" * 60)
        for d in sensitivity["distance_regimes"]:
            lines.append(f"{d['regime']:<24} {d['count']:<8} {d['accuracy']:<12} {d['avg_brier']:<12}")
        lines.append("")

    lines.append("=" * 60)
    return "\n".join(lines)


def suggest_parameter_adjustments(predictions_dir: Path) -> str:
    """Analyze calibration data and suggest parameter adjustments.

    Returns a human-readable report with specific tuning recommendations.
    """
    predictions = load_predictions(predictions_dir)
    resolved = [p for p in predictions if p.get("outcome_resolution") != "pending"]

    if not resolved:
        return "No resolved predictions yet. Run the bot to collect data."

    lines = []
    lines.append("=" * 60)
    lines.append("PARAMETER TUNING SUGGESTIONS")
    lines.append("=" * 60)
    lines.append("")

    # Analyze calibration curve for systematic bias
    curve = compute_calibration_curve(predictions)
    if curve:
        # Check if model is overconfident or underconfident
        gaps = [Decimal(str(b["gap"])) for b in curve if b["count"] >= 3]
        if gaps:
            avg_gap = sum(gaps) / len(gaps)
            if avg_gap > Decimal("0.05"):
                lines.append("SYSTEMATIC BIAS: Model is OVERCONFIDENT")
                lines.append("  - Predicted probabilities are consistently higher than actual outcomes")
                lines.append("  - SUGGESTION: Increase volatility scaling factor (currently 1.0)")
                lines.append("  - Or reduce the z-score magnitude before applying normal_cdf")
                lines.append("")
            elif avg_gap < Decimal("-0.05"):
                lines.append("SYSTEMATIC BIAS: Model is UNDERCONFIDENT")
                lines.append("  - Predicted probabilities are consistently lower than actual outcomes")
                lines.append("  - SUGGESTION: Decrease volatility scaling factor (currently 1.0)")
                lines.append("  - Or increase the z-score magnitude before applying normal_cdf")
                lines.append("")
            else:
                lines.append("SYSTEMATIC BIAS: Model is well-calibrated")
                lines.append("  - No significant over/underconfidence detected")
                lines.append("")

    # Analyze edge decay
    decay = compute_edge_decay(predictions)
    if decay:
        # Check if edge is better early or late in the contract
        early = [d for d in decay if "300-" in d["time_bucket"] or "360-" in d["time_bucket"] or "420-" in d["time_bucket"]]
        late = [d for d in decay if "60-" in d["time_bucket"] or "120-" in d["time_bucket"] or "180-" in d["time_bucket"]]

        if early and late:
            early_accuracy = sum(Decimal(d["accuracy"]) for d in early) / len(early)
            late_accuracy = sum(Decimal(d["accuracy"]) for d in late) / len(late)

            if early_accuracy > late_accuracy + Decimal("0.05"):
                lines.append("TIME DECAY: Model performs BETTER early in contract")
                lines.append(f"  - Early accuracy: {early_accuracy:.3f}")
                lines.append(f"  - Late accuracy:  {late_accuracy:.3f}")
                lines.append("  - SUGGESTION: Consider entering positions earlier (higher min_expiry)")
                lines.append("")
            elif late_accuracy > early_accuracy + Decimal("0.05"):
                lines.append("TIME DECAY: Model performs BETTER late in contract")
                lines.append(f"  - Early accuracy: {early_accuracy:.3f}")
                lines.append(f"  - Late accuracy:  {late_accuracy:.3f}")
                lines.append("  - SUGGESTION: Consider entering positions later (lower min_expiry)")
                lines.append("")

    # Analyze volatility regime performance
    sensitivity = compute_parameter_sensitivity(predictions)
    if sensitivity["volatility_regimes"]:
        lines.append("VOLATILITY REGIME RECOMMENDATIONS")
        lines.append("-" * 60)
        for regime in sensitivity["volatility_regimes"]:
            if regime["count"] < 3:
                continue
            accuracy = Decimal(regime["accuracy"])
            if accuracy > Decimal("0.60"):
                lines.append(f"  {regime['regime']}: GOOD (accuracy={regime['accuracy']})")
            elif accuracy < Decimal("0.45"):
                lines.append(f"  {regime['regime']}: POOR (accuracy={regime['accuracy']})")
                lines.append(f"    - SUGGESTION: Consider excluding this regime from trading")
        lines.append("")

    # Analyze distance-from-strike performance
    if sensitivity["distance_regimes"]:
        lines.append("DISTANCE-FROM-STRIKE RECOMMENDATIONS")
        lines.append("-" * 60)
        for regime in sensitivity["distance_regimes"]:
            if regime["count"] < 3:
                continue
            accuracy = Decimal(regime["accuracy"])
            if accuracy > Decimal("0.60"):
                lines.append(f"  {regime['regime']}: GOOD (accuracy={regime['accuracy']})")
            elif accuracy < Decimal("0.45"):
                lines.append(f"  {regime['regime']}: POOR (accuracy={regime['accuracy']})")
                lines.append(f"    - SUGGESTION: Consider adjusting min_model_gap or min_strength")
        lines.append("")

    lines.append("=" * 60)
    return "\n".join(lines)
