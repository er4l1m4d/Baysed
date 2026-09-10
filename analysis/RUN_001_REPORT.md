# Observation Run 001 — Final Report

**Run window:** 2026-09-02 → 2026-09-10 (UTC)
**Frozen system SHA:** `5be85df` · **Model:** `distance_to_strike_v2`
**Analysis core:** 22,687 resolved snapshots post-freeze (22,481 modeled) across 818 markets
**Analysis date:** 2026-09-10 · All numbers reproducible via `analysis/*.js` against `analysis/data/`

---

## Executive verdict

**The model works. The strategy built on top of it does not.**

- `distance_to_strike_v2` is well-calibrated with genuine skill: **76.6% accuracy, Brier 0.1508, +39.7% skill vs the 50/50 baseline**, and it beats the market head-to-head on 59% of snapshots.
- The **approval gate is anti-selective**: the 213 snapshots it approved performed *worse* (66.2% accuracy) than the 22,268 it rejected (76.7%).
- **No taker strategy survives fees** at any fee-adjusted-edge threshold in this dataset. The model's Brier edge over the market concentrates in one-sided books (near expiry) — exactly where taker fills are worst.
- **Trading readiness: NOT READY.** Two blockers (gate design, execution path) and a clear path forward (below).

---

## 1. Data integrity — PASS

| Check | Result |
|---|---|
| Duplicate snapshot keys | 0 |
| Brier recompute vs stored (`(p − actual)²`) | 0 mismatches (24,481 modeled rows) |
| `prediction_correct` recompute vs stored | 0 mismatches |
| Probability range | All within [0.01, 0.99]; no exact 0/1; 372 null (1.5%, rejected observations) |
| Timestamp sanity | 534 boundary rows at `seconds_remaining=0` (2.2%) — real expiry-instant snapshots, kept |

Run 001 core = all records ≥ 2026-09-02 UTC with `model_version=distance_to_strike_v2` (22,687). Six engine restarts, all on 09-01→09-03 during final deploys; the final run `observation_20260903_002529` ran uninterrupted for 7.7 days (19,970 snapshots).

## 2. Coverage — PASS (one outage)

818 distinct markets observed (≈96/day expected; 94–97/day actual). ~28 snapshots per market (one per ~30s cycle). Modeled fraction 99.1%.

**One incident:** 2026-09-04, hours 00:00–05:59 UTC — zero snapshots, zero markets (~24 markets missing, 3% of run). Engine process stayed alive (no new `run_id`), so this was a discovery/market-listing gap, not a crash. It self-recovered at 06:00. No corruption of surrounding data. No alerting existed to catch it same-day — see recommendations.

## 3. Resolution integrity — PASS

- `resolution_source`: **100% `bayse_api`** (canonical only)
- `resolved_outcome_id` always ∈ market's outcome pair; `actual_price` never missing
- Outcome balance: 12,563 NO / 12,122 YES wins — no structural bias
- Resolution lag: median 133s, p99 145s. The only extreme lags (4.9 days) are pre-run records from 2026-08-27 backfilled on 09-01 — **zero Run 001 outliers**
- Pending at analysis time: 24, all < 17 min old — nothing stuck

## 4. Forecast quality — the model is sound

**Overall (n=22,481):** accuracy 76.6% · Brier 0.1508 · log loss 0.4555 · **Brier skill vs 50/50: +39.7%**

**Brier decomposition:** reliability 0.0011 (near-perfect calibration) · resolution 0.0990 (of max 0.2499) · uncertainty 0.2499

**Calibration curve (0.1 buckets):**

| Bucket | n | Avg predicted | Actual YES rate | Gap |
|---|---|---|---|---|
| 0–10% | 4,518 | 0.024 | 0.055 | −0.031 |
| 10–20% | 1,374 | 0.151 | 0.215 | **−0.064** |
| 20–30% | 1,456 | 0.252 | 0.264 | −0.012 |
| 30–40% | 1,766 | 0.352 | 0.344 | +0.008 |
| 40–50% | 2,238 | 0.452 | 0.477 | −0.025 |
| 50–60% | 2,458 | 0.544 | 0.545 | −0.001 |
| 60–70% | 1,819 | 0.648 | 0.594 | **+0.054** |
| 70–80% | 1,387 | 0.747 | 0.715 | +0.032 |
| 80–90% | 1,086 | 0.850 | 0.794 | **+0.056** |
| 90–100% | 4,379 | 0.978 | 0.958 | +0.020 |

Pattern: slightly under-confident below 30%, slightly over-confident in the 60–90% band. Only two buckets exceed ±5 points. Confidence bands are perfectly monotone: 51.8% accuracy at coin-flip confidence → 96.9% at 90%+ confidence. **The model knows what it knows.**

## 5. Baseline comparison — anomaly SOLVED

The pre-registered `brier_market` flag (0.40 > 0.25) is a **semantics bug, not a market anomaly**:

- `bayse_implied` stores the ask of the **predicted** side (engine.py:583 — `yes_ask` when predicting YES, `no_ask` when predicting NO)
- `/calibration` scores it against the **yes-won indicator** — so every NO-prediction row compares P(NO)≈0.99 against actual=0, contributing ~0.98 Brier
- Verified in data: `bayse_implied == yes_ask` on 10,297/10,297 YES rows; `== no_ask` on 10,853/10,853 NO rows
- Stored (buggy) value reproduces exactly: 0.374 ≈ server's 0.376 ✓

**Corrected market baselines (market P(yes) = `yes_ask`, falling back to `1 − no_ask`):**

| Baseline | Brier | n |
|---|---|---|
| Model, Run 001 core | **0.1508** | 22,481 |
| 50/50 | 0.2500 | — |
| Market (corrected, any ask) | 0.1995 | 22,089 |
| Model (same rows) | 0.1522 | 22,089 |
| Market (two-sided clean books) | **0.1510** | 17,238 |
| Model (same rows) | 0.1537 | 17,238 |

**The honest picture:** the model beats the market overall (head-to-head closer on 59.1% of snapshots; accuracy 76.4% vs 72.1%), but **on clean two-sided books the market is statistically as good as the model** (0.1510 vs 0.1537). The model's entire Brier advantage comes from one-sided books near expiry — where only one side is quoted and the model fills the informational gap.

## 6. Signal quality — the approval gate is anti-selective ⚠

| Set | n | Accuracy | Brier |
|---|---|---|---|
| Approved signals | 213 | **66.2%** | 0.2363 |
| Rejected snapshots | 22,268 | **76.7%** | 0.1500 |

**The gate selects *worse*-than-average opportunities.** Root cause is structural: approval requires large model-vs-market edge, and large disagreement with the market is enriched in *model errors* (per §5, on liquid books the market is as accurate as the model). The gate harvested exactly those disagreements — avg claimed fee-adjusted edge +0.081 — and delivered 66.2% hits on avg entry 0.694 (breakeven ≈ 69.4% + fees).

Meanwhile the raw model output is an excellent ranker — `signal_strength` deciles are monotone from 56.2% to 99.3% accuracy. **The model is fine; the gate is broken.**

Direction sanity: YES-calls 10,941 (76.5% correct), NO-calls 11,540 (76.6%) — no directional bias. Actual YES rate 49.3%.

Rejection reasons (rows can carry several): `model_edge_below_minimum` 19,588 · `negative_edge_after_fees` 18,019 · `outside_wat_trading_window` 14,620 · spread gates ~16,000 · `signal_strength_below_minimum` 6,576.

## 7. Edge analysis — taker path is unprofitable

**Approved-signal simulation** (buy predicted side at its ask, 1u flat): 213 trades, hit rate 66.2%, avg entry 0.694, **mean ROI −5.2%/trade, total −11.1u**.

**Counterfactual sweep** — trade every modeled snapshot with a book whenever `edge_fee > threshold`:

| Threshold | n | Hit rate | Mean ROI/trade |
|---|---|---|---|
| 0 | 3,131 | 71.6% | −2.8% |
| 0.02 | 2,191 | 70.8% | −3.0% |
| 0.05 | 1,361 | 70.0% | −3.2% |
| 0.10 | 584 | 69.2% | −2.7% |
| 0.15 | 275 | 70.6% | **+0.5%** |

Every threshold loses; the single positive cell (n=275, +0.5%) is pre-fee, post-fee negative, and is the best of 8 swept thresholds — classic selection noise, not evidence. **Apparent model edge does not survive spread + fees at taker prices.** Combined with §5, this is coherent: the market's quotes are efficient on liquid books, and the model's informational edge lives where takers can't get filled well.

## 8. Conditional performance

**Time to expiry** (monotone, and the model's confidence tracks it honestly):

| Remaining | n | Accuracy | Brier | Avg confidence |
|---|---|---|---|---|
| 0–1m | 3,392 | 95.4% | 0.035 | 0.90 |
| 1–3m | 4,284 | 87.1% | 0.095 | 0.83 |
| 3–5m | 1,615 | 83.3% | 0.122 | 0.75 |
| 5–10m | 4,040 | 76.5% | 0.160 | 0.60 |
| 10–15m | 9,150 | 63.5% | 0.221 | 0.32 |

**Distance from strike** (the model's core variable, perfectly monotone):

| \|distance\| | n | Accuracy | Brier | Avg confidence |
|---|---|---|---|---|
| <0.016% | 4,496 | 54.4% | 0.247 | 0.15 |
| 0.016–0.038% | 4,496 | 67.5% | 0.213 | 0.42 |
| 0.038–0.067% | 4,495 | 77.9% | 0.159 | 0.64 |
| 0.067–0.125% | 4,497 | 87.8% | 0.096 | 0.78 |
| >0.125% | 4,497 | 95.2% | 0.040 | 0.91 |

Volatility quintiles: higher vol → better (74.5% → 79.0% accuracy). Momentum: U-shaped — extremes (78–80%) beat the middle (74.9%). All of this says the same thing: **the model is a distance/vol machine that correctly deflates near the strike.**

**Hour-of-day note:** wrong-rate by UTC hour ranges 16.3% (16:00) to **32.7% (00:00)** — hour 00 is a >6σ outlier vs the 23.4% mean (n=819). Real effect, cause unknown (overnight low-liquidity chop?). Post-run hypothesis, not a change.

## 9. Failure analysis

- **High-confidence misses** (conf ≥ 0.6): 954 of 11,357 (8.4%). They sit systematically **closer to strike** than confident hits (median |dist| 0.056% vs 0.098%).
- **Worst-20 Brier (0.98 = p=0.99 wrong):** all are late reversals — price 0.05–0.12% from strike with 1–8 min left, crossing at the end. Two outliers at 7–8 min remaining with |dist| 0.26–0.29% *and* vol 0.035–0.039 (≈1σ move available) — the model's 0.99/0.01 was genuinely over-confident there. Tail risk is real but rare and priced mostly correctly (90–100% bucket: predicted 97.8%, actual 95.8%).
- **09-04 outage:** 6h, self-recovered, 3% data loss, zero corruption (see §2).
- **Market-feed reconnects: 2,018 over 8 days** (~1 per 5.7 min) with zero mapping/server errors — the reconnect logic works but churns. Infra polish item, no data impact.

## 10. Recommendations (evidence-first, in order)

1. **Do not trade real money with the current approval gate.** It is measurably anti-selective (66.2% vs 76.7%). Redesign offline against Run 001 data before any live use. Drop "large edge vs market" as the primary approval criterion — it selects model errors.
2. **Keep `distance_to_strike_v2` as the probability core.** +39.7% skill, reliability 0.0011. Two small, post-hoc calibration fixes worth validating in Run 002: lift the 10–20% bucket (+6.4 pts under-confident) and damp the 60–90% band (−3 to −6 pts over-confident). Fit on Run 001, validate on Run 002 — no in-place tuning.
3. **Pivot execution research from taker to maker.** Taker is dead (−2.8%/trade at best honest threshold). The model's edge lives in one-sided near-expiry books — as a maker quoting the model-favored side inside the spread, you earn the spread instead of paying it. This needs book-depth data to simulate honestly (next point).
4. **Collect full top-of-book (bids + asks, both sides, with sizes) in Run 002.** Current snapshots store only `yes_ask`/`no_ask` — enough for Brier baselines, not enough for maker-fill simulation. This is the single highest-value data upgrade.
5. **Fix the `bayse_implied` / `/calibration` bug** (analytics only, no model impact): store canonical market P(yes) (`yes_ask`, else `1 − no_ask`) or derive at query time from the raw asks already stored.
6. **Add outage alerting.** The 09-04 6-hour gap went unnoticed because health checks were manual. A tiny daily cron (UptimeRobot can't do content checks on free — use a GitHub Action hitting `/pipeline-health` and failing on `last_snapshot_age` > 30 min) closes this.
7. **Run 002 (2 weeks) with:** book depth collection, calibration-validated tweaks from #2, redesigned gate evaluated offline daily against the same integrity pipeline built here. Exit criteria for paper trading: gate-approved subset beats rejected subset, and maker simulation is flat-to-positive after fee/spread assumptions.

---

## Artifacts

- `analysis/fetch.js` — bulk API fetch (pagination, retries)
- `analysis/integrity.js` — steps 1–3 → `data/integrity.json`
- `analysis/quality.js` — steps 4–8 → `data/quality.json`
- `analysis/failures.js` — step 9 → `data/failures.json`
- `analysis/data/*.json` — raw + derived (bulk `resolved.json`/`pending.json` gitignored; re-fetchable from the live API)

**Analysis-script caveat:** `failures.js` `missing_hours` used a local-timezone parse (off by 1h) — the 09-04 outage was established from the direct hourly table, not that loop.
