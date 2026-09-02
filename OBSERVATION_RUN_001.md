# Observation Run 001 — Frozen-Run Manifest

**Status: ACTIVE — do not modify the model during the run window.**

## Run identity

| Field | Value |
|---|---|
| Run ID | 001 |
| Window | 2026-09-02 → 2026-09-10 (or analysis kickoff, whichever is later) |
| Mode | `observation` — trading disabled, snapshots only |
| Frozen system SHA | `5be85df` (deployed on Render, verified live) |
| Model | `distance_to_strike_v2` |
| Strategy | `distance_to_strike` |

## Model lineage (for analysis segmentation)

- `3a3f33f` — critical volatility scaling fix (`time_frac` divides by the
  60s candle window, not 900). **Predictions recorded before this commit
  have overconfident volatility scaling** and should be segmented or
  excluded in forecast-quality analysis.
- `1dce2a4` — observation-run prep: frozen model, snapshot-only pipeline,
  research fields.
- `5be85df` — full-system freeze for this window (housekeeping only after
  this point; no behavioral changes).

Everything analyzed as "Run 001 core" should be predictions recorded by the
system at/after `5be85df`, all of which run identical model logic.

## What is frozen

- Model logic (`strategy.py` probability calculation)
- Strategy weights and signal rules
- All thresholds (gaps, spread, ATR bands, liquidity)
- Volatility calculation and scaling
- Fee assumptions (Bayse taker-fee model)
- Market-selection rules (series slug, eligibility filters)
- Risk logic

## Rules of engagement

**Fix immediately (infrastructure / data integrity only):**
WS permanently disconnected · predictions not persisting · markets not
discovered · resolutions not recorded · wrong timestamps · duplicate or
corrupt records · terminal showing data that differs from the database ·
stale BTC feed · stale market state · genuine implementation bug.

**Do NOT touch during the run (post-run hypotheses instead):**
model conservatism · threshold tuning · signal frequency · probability
shaping · momentum weighting · volatility multipliers · UI analytics
improvements. Any fix in this category invalidates the run window.

## Baseline snapshot at freeze (2026-09-02, live API)

| Metric | Value |
|---|---|
| Total snapshots | 4,543 |
| Resolved | 4,528 (pending 15) |
| Accuracy | 71.97% |
| Brier (model) | 0.1479 |
| Brier (market) | 0.4009 ⚠ |
| Brier (baseline 50/50) | 0.2500 |

## Known flags for Day 8

1. **`brier_market` (0.40) is worse than the random baseline (0.25)** —
   implausible for real market odds. Working hypothesis: observation mode
   deliberately records one-sided/imperfect books (e.g. `yes_ask: null`,
   `no_ask: 0.93`, outcome YES won); if market-implied probability is
   derived from the wrong side or imperfect books are included, the metric
   inflates. Raw `yes_ask`/`no_ask` are stored on every snapshot, so all
   market-side metrics are recomputable post-hoc. Does not contaminate
   model probability/Brier data — the model's probability does not read
   the book.
2. Snapshot cadence vs. signal count (4,543 snapshots / 28 signals at
   freeze) — verify coverage accounting during analysis.

## Day-8 analysis plan

1. Data integrity — do we trust the dataset?
2. Coverage — markets observed, snapshots, predictions
3. Resolution integrity — every prediction has a legitimate outcome
4. Forecast quality — calibration curves, Brier by bucket
5. Baseline comparison — model vs 50/50 vs market-implied (recomputed)
6. Signal quality — are UP/DOWN/SKIP decisions informative?
7. Edge analysis — does apparent edge survive fees?
8. Conditional performance — time-to-expiry, volatility, momentum buckets
9. Failure analysis — biggest recurring mistakes
10. Only then: model iteration, evidence-first
