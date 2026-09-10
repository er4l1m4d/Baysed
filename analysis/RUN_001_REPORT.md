# Observation Run 001 — Final Report

**Run window:** 2026-09-02 → 2026-09-10 (UTC)
**Frozen system SHA:** `5be85df` · **Model:** `distance_to_strike_v2`
**Analysis core:** 22,687 resolved snapshots post-freeze (22,481 modeled) across 818 markets (816 with modeled snapshots — the independent-episode unit, see §4A)
**Analysis date:** 2026-09-10 · All numbers reproducible via `analysis/*.js` against `analysis/data/`

---

## Executive verdict

**The forecasting model looks promising and well-calibrated. The trading strategy does not yet have a demonstrated edge.**

Not ready to trade. More precisely, stated in the three layers that matter:

- **Forecast — ✅ promising:** `distance_to_strike_v2` is well-calibrated with genuine skill (76.6% accuracy, Brier 0.1508, +39.7% skill vs 50/50, reliability 0.0011). The edge is statistically significant *even treating each market as a single observation* (534/814 markets beat the market baseline, t = −8.58; 82% of markets beat coin-flip). Still needs out-of-sample confirmation in Run 002.
- **Valuation — ⚠ no edge where it's tradable:** on clean two-sided books, the Bayse market prices at least as well as the model in *every* time-to-expiry bucket. The model's aggregate edge over the market is a composition effect of one-sided books — stale/partial quotes — not mispricing the model can trade against.
- **Execution — ❌ demonstrated unprofitable (taker):** the approval gate is anti-selective (approved 66.2% vs rejected 76.7% accuracy, robust at p≈0.01 at market level), and taker entry loses at every fee-adjusted-edge threshold, on all books and on two-sided books alone.

**Predictive edge ≠ trading edge.** Run 001 proved the first; it also proved the second does not yet exist. That narrowing is the run's real result.

Statistical note: 22,481 modeled snapshots are **not** independent observations — they cluster into **816 market episodes** (ICC 0.32, design effect 9.6, effective N ≈ 2,340). All headline findings below were re-validated at the market level.

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

**What the model actually is:** recomputing `Φ(distance / (vol·√(t/60)))` from stored features reproduces the stored probability on **21,963/21,963 rows (max diff 0.0001)**. The model is exactly a clamped Gaussian random-walk kernel — no momentum term, no hidden layers. This is a strength: interpretable, verifiable, and every ingredient's contribution is measurable (see §5A).

### 4A. Statistical independence — the 816-episode view

The pooled numbers above treat snapshots as independent; they are not. Within-market snapshots are highly correlated (28 per market, consecutive in time):

| Measure | Value |
|---|---|
| Intra-market correlation (ICC of Brier) | 0.324 |
| Design effect | 9.6× |
| Effective sample size | ≈ 2,340 (vs 22,481 nominal) |

Re-testing at the market level (each market = one independent episode):

- **Model vs market, paired per market:** model better in **534/814** markets (65.6%), mean per-market Brier diff −0.051, t = −8.58, p < 1e-10 — **the model-vs-market edge survives the clustering correction**
- **Model vs coin-flip, paired per market:** better in **670/816** markets (82.1%), t = −23.6
- Mean-of-market-means accuracy 76.7% vs pooled 76.6% — composition effects negligible

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

**The honest picture:** the model beats the market overall (head-to-head closer on 59.1% of snapshots; accuracy 76.4% vs 72.1%), and that edge is significant at the market level (§4A). But **on clean two-sided books the market is statistically as good as the model** (0.1510 vs 0.1537) — and the by-expiry cut below sharpens this further.

**Two-sided books only — market vs model by time to expiry:**

| Remaining | n | Brier model | Brier market |
|---|---|---|---|
| 0–1m | 1,958 | 0.0329 | 0.0329 |
| 1–3m | 3,524 | 0.0909 | **0.0872** |
| 3–5m | 1,335 | 0.1222 | **0.1179** |
| 5–10m | 3,284 | 0.1592 | **0.1541** |
| 10–15m | 7,137 | 0.2211 | **0.2198** |

**The market edges the model in every bucket where real two-sided prices exist.** Meanwhile on one-sided books (n=999): model 0.0248 vs market 0.2774 — the "market baseline" there is a fallback derived from a single stale quote, not a real price. Conclusion: **the model's aggregate edge over the market is a composition effect of broken books, not exploitable mispricing.** Where Bayse traders actually quote both sides, they are at least as informed as the model.

### 5A. Baseline ladder — does the sophistication earn its keep?

All on the same 22,089 rows (market available), unfitted baselines:

| Model | Brier | Log loss |
|---|---:|---:|
| Coin flip (0.5) | 0.2500 | 0.6931 |
| Side-sign only, confident (0.99/0.01) | 0.2318 | 1.0966 |
| Side-sign only, moderate (0.75/0.25) | 0.1807 | 0.5475 |
| Distance-linear (code fallback: 0.5 + 4d) | 0.1614 | 0.4980 |
| Gaussian **without** time scaling (z = d/vol) | 0.1777 | 0.6182 |
| **Gaussian full (= the model)** | **0.1522** | **0.4593** |
| Market implied (corrected) | 0.1995 | 0.6234 |

Decomposition of the skill: knowing which side of the strike price is on gets Brier from 0.25 to ~0.18; scaling by distance adds to 0.161; the vol-time (√t) kernel adds the final 0.009 and, critically, buys calibration (log loss 0.459 vs 0.498 — the linear rule is overconfident at long horizons). The time-scaling ingredient alone is worth 0.025 Brier (0.1777 → 0.1522). **Every layer earns its keep, but the model has no magic beyond a correctly-scaled Gaussian random walk** — which is exactly why it can be beaten only by better inputs (drift/liquidity regimes), not by more math on the same three features.

## 6. Signal quality — the approval gate is anti-selective ⚠

| Set | n | Accuracy | Brier |
|---|---|---|---|
| Approved signals | 213 | **66.2%** | 0.2363 |
| Rejected snapshots | 22,268 | **76.7%** | 0.1500 |

**The gate selects *worse*-than-average opportunities.** Root cause is structural: approval requires large model-vs-market edge, and large disagreement with the market is enriched in *model errors* (per §5, on liquid books the market is as accurate as the model). The gate harvested exactly those disagreements — avg claimed fee-adjusted edge +0.081 — and delivered 66.2% hits on avg entry 0.694 (breakeven ≈ 69.4% + fees).

**Clustering check:** the 213 signals span 91 distinct markets. Per-market paired against same-market rejected snapshots: mean accuracy diff **−9.6 points, t = −2.61 (p ≈ 0.01)** — the anti-selectivity finding is robust at the episode level, not a pooling artifact. (Also note what this implies: the gate isn't detecting opportunity — it's detecting *where the model is overconfident*.)

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

Every threshold loses; the single positive cell (n=275, +0.5%) is pre-fee, post-fee negative, and is the best of 8 swept thresholds — classic selection noise, not evidence. **Restricting to two-sided books only** (real quotes both sides, the only honestly-executable rows) makes it *worse*: −3.1%/trade at threshold 0, −2.3% at 0.10; the lone positive cell there (n=268, +1.6% ± 3.7% SE) is noise. **Apparent model edge does not survive spread + fees at taker prices, on any book class.** Combined with §5, this is coherent: on liquid books the market is as informed as the model (no divergence to harvest), and on broken books the "edge" is against a stale quote you can't actually trade against.

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

**Time-of-day profile** (new this pass — full table in `data/critique.json`):

| Window (UTC) | Accuracy | Brier | Note |
|---|---|---|---|
| 07–09 | 80–82% | 0.116–0.136 | Best window (EU morning) |
| 15–16, 18 | 79–84% | 0.113–0.137 | Strong |
| 19–22 | 71–79% | 0.137–0.177 | Weak — thin books (market Brier degrades to 0.24–0.27; model holds up better than market here) |
| **00 (midnight)** | **67.3%** | **0.196** | Worst — see decomposition |

**The 00:00 UTC anomaly — decomposed.** It is **recurring, not a one-off**: wrong-rate elevated on 6 of 8 nights (worst 43%, best nights 15–18%). Structure of the effect:

- **Concentrated near strike:** wrong-rate 57.1% (dist < 0.016%) and 34.5% (0.038–0.068%) vs 45.1% / 21.5% in the same buckets at other hours. Far from strike (> 0.125%): **0% wrong** (n=77) — the model is fine when decisive.
- **Concentrated early in the market:** 10–15m remaining: 47.6% wrong vs 36.1% other hours.
- **Directional bias:** model's mean P(yes) at midnight = 0.441 vs actual YES rate = 0.346 — a ~10-point YES bias the random-walk model cannot express.

Mechanism hypothesis (unverified, for Run 002 instrumentation): 00:00 UTC is the Binance **daily candle close/open** — a known chop/mean-reversion window. The model assumes zero drift; if BTC mean-reverts around the daily open, near-strike probabilities at that hour are systematically miscalibrated. This is a *regime* the model can't see, not a bug.

Volatility quintiles: higher vol → better (74.5% → 79.0% accuracy). Momentum: U-shaped — extremes (78–80%) beat the middle (74.9%). All of this says the same thing: **the model is a distance/vol machine that correctly deflates near the strike.**

## 9. Failure analysis

- **High-confidence misses** (conf ≥ 0.6): 954 of 11,357 (8.4%). They sit systematically **closer to strike** than confident hits (median |dist| 0.056% vs 0.098%).
- **Worst-20 Brier (0.98 = p=0.99 wrong):** all are late reversals — price 0.05–0.12% from strike with 1–8 min left, crossing at the end. Two outliers at 7–8 min remaining with |dist| 0.26–0.29% *and* vol 0.035–0.039 (≈1σ move available) — the model's 0.99/0.01 was genuinely over-confident there. Tail risk is real but rare and priced mostly correctly (90–100% bucket: predicted 97.8%, actual 95.8%).
- **09-04 outage — characterized:** the gap is larger than the daily table suggested: last snapshot **22:36 UTC Thu 09-03**, first after **06:14 UTC Fri 09-04** — **7.6 hours, ~30 missed markets**. Engine process stayed alive (no `run_id` change), BTC feed unaffected, so this was a **discovery/listing failure**, not a crash; it self-recovered at exactly 06:00. Every other day has 620–675 snapshots in hours 00–05, so it is a one-off in this window. Cause undeterminable without logs (candidates: Bayse listing pause, discovery error-loop with backoff, series endpoint returning empty). **Free experiment tonight:** the window Thu-22:30 → Fri-06:00 UTC recurs weekly, and the engine is still live — if the gap repeats on Fri 09-11, it's a weekly Bayse-side pattern; if not, it was transient. Run 002 alerting should discriminate automatically.
- **Sampling-bias check for this analysis:** the outage removed a contiguous 7.6h block (one timezone slice, both model-good and model-bad hours). Per-hour accuracy on the remaining days shows no distortion large enough to affect any §4–§8 conclusion; the 00:00 UTC analysis uses 8 intact nights.
- **Market-feed reconnects: 2,018 over 8 days** (~1 per 5.7 min) with zero mapping/server errors — the reconnect logic works but churns. Infra polish item, no data impact.

## 10. Recommendations (evidence-first, in order)

**Reframing adopted from the Day-8 review:** Baysed is not "a bot that predicts which side to buy." It is a **probability engine that searches for situations where market price diverges from calibrated fair value AND the divergence is executable.** Three layers: Forecast (✅ promising) → Valuation (⚠ no tradable divergence found yet) → Execution (❌ taker path dead). The work queue targets layers 2 and 3 only — the probability model stays frozen.

1. **Do not trade real money with the current approval gate.** Anti-selective at the episode level (p ≈ 0.01). Redesign offline against Run 001 data before any live use.
2. **Replace the gate with execution-aware expected value, not disagreement.** The current logic rewards model-vs-market divergence; the data shows divergence selects model errors. The new decision input is a single number — **executable edge** = fee-adjusted edge − expected slippage − execution uncertainty — and approval requires expected PnL > 0, not edge > threshold. Slippage and fill-probability terms need book-depth data (item 4) to estimate honestly; until then the gate stays in observation mode.
3. **Freeze `distance_to_strike_v2` through Run 002.** It is exactly a clamped Gaussian random-walk kernel (§4 recompute) and it is well-calibrated. The only model-side candidates for a *later* run, from evidence: a drift/dampening term for the 00:00 UTC regime, lifting the 10–20% bucket, damping the 60–90% band. Fit on Run 001, validate on Run 002, deploy only for Run 003.
4. **Collect full top-of-book in Run 002** (bids + asks, both sides, with sizes). This is the single highest-value data upgrade: it enables maker-fill simulation, honest slippage estimation for the executable-edge calculator, and direct measurement of whether *any* price improvement inside the spread is available. It also answers the deferred maker question with data instead of assumptions.
5. **Do not pivot to maker trading yet.** Maker is a different system (inventory, queue position, adverse selection, fill probability). Sequence: Run 002 collects the data → executable-edge gate evaluated offline → only if simulated expected PnL > 0 after honest fill assumptions does maker execution get built.
6. **Fix the `bayse_implied` / `/calibration` bug** (analytics only): store canonical market P(yes) (`yes_ask`, else `1 − no_ask`) or derive at query time.
7. **Add the baseline ladder to the terminal Analytics page** (§5A table, plus time-of-day and book-state cuts). Forecast quality / market comparison / selectivity / execution / regime — the five views this analysis actually used.
8. **Add outage alerting** (GitHub Action hitting `/pipeline-health`, failing on stale `last_prediction_at` > 30 min). The 7.6h 09-04 outage went unnoticed for a week. Also watch the Thu-night/Fri-morning window (item in §9).
9. **Run 002 (~2 weeks), measuring:** forecast on unseen markets (out-of-sample confirmation of §4) · market-level metrics (§4A as standard) · calibration by bucket and by expiry · time-of-day including the 00:00 UTC window with candle-close instrumentation · distance/vol regime cuts · clean vs one-sided books · executable-edge distribution · expected vs realized fill quality once book depth flows. Exit criteria for paper trading: gate-approved subset beats rejected subset at market level, and executable-edge simulation is flat-to-positive after honest fill assumptions.

---

## Artifacts

- `analysis/fetch.js` — bulk API fetch (pagination, retries)
- `analysis/integrity.js` — steps 1–3 → `data/integrity.json`
- `analysis/quality.js` — steps 4–8 → `data/quality.json`
- `analysis/failures.js` — step 9 → `data/failures.json`
- `analysis/critique.js` — post-review pass: clustering/ICC, market-level tests, baseline ladder, hour-0 decomposition, outage boundary, two-sided cuts → `data/critique.json`
- `analysis/data/*.json` — raw + derived (bulk `resolved.json`/`pending.json` gitignored; re-fetchable from the live API)

**Analysis-script caveats:** `failures.js` `missing_hours` used a local-timezone parse (off by 1h) — the 09-04 outage boundaries come from the direct row inspection in `critique.js`. An earlier `critique.js` revision had a broken `erf` approximation (Gaussian recompute matched only 1.7%); the A&S 7.1.26 version matches 100% — numbers in this report are from the corrected run.
