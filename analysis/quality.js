// Observation Run 001 — Steps 4-8: Forecast quality, Baselines, Signals, Edge, Conditional
// Usage: node analysis/quality.js
const fs = require("fs");
const path = require("path");

const all = require("./data/resolved.json");
const FREEZE_UTC = Date.parse("2026-09-02T00:00:00Z");

// Run 001 core: post-freeze, frozen model
const run001 = all.filter((r) => Date.parse(r.recorded_at) >= FREEZE_UTC && r.model_version === "distance_to_strike_v2");
// Modeled rows: probability present
const modeled = run001.filter((r) => r.probability != null);
// Modeled with prediction_correct computed (should be all resolved)
const M = modeled.filter((r) => r.outcome_resolution === "yes_won" || r.outcome_resolution === "no_won");

const actual = (r) => (r.outcome_resolution === "yes_won" ? 1 : 0);
const brier = (r) => (r.probability - actual(r)) ** 2;
const marketPYes = (r) => {
  // market P(yes) from raw asks: prefer yes_ask; fall back to 1 - no_ask
  if (r.yes_ask != null) return r.yes_ask;
  if (r.no_ask != null) return 1 - r.no_ask;
  return null;
};
const fullBook = (r) => r.yes_ask != null && r.no_ask != null && r.yes_ask + r.no_ask >= 0.90 && r.yes_ask + r.no_ask <= 1.10;

const out = {};
function bucketize(rows, keyFn, buckets) {
  // buckets: [{label, test(v)}]
  return buckets.map((b) => {
    const rs = rows.filter((r) => b.test(keyFn(r)));
    if (!rs.length) return { bucket: b.label, n: 0 };
    return {
      bucket: b.label,
      n: rs.length,
      accuracy: r4(mean(rs, (r) => (r.prediction_correct ? 1 : 0))),
      brier: r4(mean(rs, brier)),
      avg_prob_yes: r4(mean(rs, (r) => r.probability)),
      actual_yes_rate: r4(mean(rs, actual)),
      avg_confidence: r4(mean(rs, (r) => Math.abs(r.probability - 0.5) * 2)),
    };
  });
}

// ---------- STEP 4: FORECAST QUALITY ----------
const step4 = {};
step4.n = M.length;
step4.accuracy = r4(mean(M, (r) => (r.prediction_correct ? 1 : 0)));
step4.brier_mean = r4(mean(M, brier));
step4.brier_skill_vs_5050 = r4(1 - step4.brier_mean / 0.25);
step4.log_loss = r4(mean(M, (r) => {
  const p = Math.min(Math.max(r.probability, 1e-6), 1 - 1e-6);
  return -(actual(r) * Math.log(p) + (1 - actual(r)) * Math.log(1 - p));
}));

// Calibration curve (0.1 buckets) + Brier by bucket
const cal = [];
for (let lo = 0; lo < 10; lo++) {
  const rs = M.filter((r) => r.probability >= lo / 10 && r.probability < (lo + 1) / 10);
  if (!rs.length) continue;
  cal.push({
    bucket: `${lo * 10}-${(lo + 1) * 10}%`,
    n: rs.length,
    avg_predicted: r4(mean(rs, (r) => r.probability)),
    actual_yes_rate: r4(mean(rs, actual)),
    gap: r4(mean(rs, (r) => r.probability) - mean(rs, actual)),
    brier: r4(mean(rs, brier)),
  });
}
step4.calibration_0p1 = cal;

// Confidence bands
step4.by_confidence = bucketize(M, (r) => Math.abs(r.probability - 0.5) * 2, [
  { label: "0-10% (coin flip)", test: (v) => v < 0.1 },
  { label: "10-30%", test: (v) => v >= 0.1 && v < 0.3 },
  { label: "30-50%", test: (v) => v >= 0.3 && v < 0.5 },
  { label: "50-70%", test: (v) => v >= 0.5 && v < 0.7 },
  { label: "70-90%", test: (v) => v >= 0.7 && v < 0.9 },
  { label: "90%+ (confident)", test: (v) => v >= 0.9 },
]);

// Brier decomposition with 0.1 buckets: reliability, resolution, uncertainty
{
  const N = M.length;
  const base = mean(M, actual);
  const unc = base * (1 - base);
  let rel = 0, res = 0;
  const groups = new Map();
  for (const r of M) {
    const k = Math.floor(r.probability * 10);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  for (const g of groups.values()) {
    const nk = g.length / N, ok = mean(g, actual), fk = mean(g, (r) => r.probability);
    rel += nk * (fk - ok) ** 2;
    res += nk * (ok - base) ** 2;
  }
  step4.brier_decomposition = { reliability: r4(rel), resolution: r4(res), uncertainty: r4(unc), check_reliability_minus_resolution_plus_uncertainty: r4(rel - res + unc) };
}
out.step4_forecast_quality = step4;

// ---------- STEP 5: BASELINE COMPARISON ----------
const step5 = {};

// 5a. Verify the bayse_implied semantics bug
const yesRows = M.filter((r) => r.predicted_outcome === "YES" && r.bayse_implied != null && r.yes_ask != null);
const noRows = M.filter((r) => r.predicted_outcome === "NO" && r.bayse_implied != null && r.no_ask != null);
step5.bayse_implied_semantics = {
  yes_predicted_rows_with_bayse_implied: yesRows.length,
  yes_rows_where_bayse_implied_equals_yes_ask: yesRows.filter((r) => Math.abs(r.bayse_implied - r.yes_ask) < 1e-9).length,
  no_predicted_rows_with_bayse_implied: noRows.length,
  no_rows_where_bayse_implied_equals_no_ask: noRows.filter((r) => Math.abs(r.bayse_implied - r.no_ask) < 1e-9).length,
  conclusion: "bayse_implied = ask of PREDICTED side (P(yes) only when predicted YES). /calibration compares it to yes_won => NO rows scored against the wrong side.",
};

// 5b. Brier market as STORED (replicating /calibration bug) vs CORRECTED
const withImplied = M.filter((r) => r.bayse_implied != null);
step5.brier_market_as_stored_bug = r4(mean(withImplied, (r) => (r.bayse_implied - actual(r)) ** 2));

const withMarket = M.filter((r) => marketPYes(r) != null);
const withFullBook = M.filter(fullBook);
const mktBrier = (rs) => mean(rs, (r) => (marketPYes(r) - actual(r)) ** 2);
const mdlBrier = (rs) => mean(rs, brier);
step5.corrected_market_brier = {
  any_ask_available_n: withMarket.length,
  brier_market_corrected: r4(mktBrier(withMarket)),
  brier_model_same_rows: r4(mdlBrier(withMarket)),
  full_two_sided_book_n: withFullBook.length,
  brier_market_full_book: r4(mktBrier(withFullBook)),
  brier_model_full_book_rows: r4(mdlBrier(withFullBook)),
  brier_5050_reference: 0.25,
};

// 5c. Head-to-head per snapshot: who was closer?
const h2h = M.filter((r) => marketPYes(r) != null);
let modelWins = 0, marketWins = 0, ties = 0;
for (const r of h2h) {
  const dm = brier(r), dk = (marketPYes(r) - actual(r)) ** 2;
  if (dm < dk - 1e-9) modelWins++; else if (dk < dm - 1e-9) marketWins++; else ties++;
}
step5.head_to_head = { n: h2h.length, model_closer: modelWins, market_closer: marketWins, tie: ties, model_share: r4(modelWins / h2h.length) };

// 5d. Market accuracy (argmax) on same rows
step5.market_accuracy = r4(mean(h2h, (r) => ((marketPYes(r) >= 0.5 ? 1 : 0) === actual(r) ? 1 : 0)));
step5.model_accuracy_same_rows = r4(mean(h2h, (r) => (r.prediction_correct ? 1 : 0)));
out.step5_baseline_comparison = step5;

// ---------- STEP 6: SIGNAL QUALITY ----------
const step6 = {};
const approved = M.filter((r) => r.approved);
const rejected = M.filter((r) => !r.approved);
step6.approved = {
  n: approved.length,
  accuracy: approved.length ? r4(mean(approved, (r) => (r.prediction_correct ? 1 : 0))) : null,
  brier: approved.length ? r4(mean(approved, brier)) : null,
  predicted_yes: approved.filter((r) => r.predicted_outcome === "YES").length,
  predicted_no: approved.filter((r) => r.predicted_outcome === "NO").length,
  avg_edge_fee: approved.length ? r4(mean(approved.filter((r) => r.edge_fee != null), (r) => r.edge_fee)) : null,
};
step6.rejected = {
  n: rejected.length,
  accuracy: r4(mean(rejected, (r) => (r.prediction_correct ? 1 : 0))),
  brier: r4(mean(rejected, brier)),
};
// rejection reasons (all reasons on rejected rows)
const reasonTally = {};
for (const r of rejected) for (const x of r.reasons || []) reasonTally[x] = (reasonTally[x] || 0) + 1;
step6.rejection_reasons = Object.fromEntries(Object.entries(reasonTally).sort((a, b) => b[1] - a[1]));

// direction balance + per-direction accuracy (modeled, all rows)
step6.direction = {
  predicted_yes_n: M.filter((r) => r.predicted_outcome === "YES").length,
  predicted_no_n: M.filter((r) => r.predicted_outcome === "NO").length,
  accuracy_when_yes: r4(mean(M.filter((r) => r.predicted_outcome === "YES"), (r) => (r.prediction_correct ? 1 : 0))),
  accuracy_when_no: r4(mean(M.filter((r) => r.predicted_outcome === "NO"), (r) => (r.prediction_correct ? 1 : 0))),
  actual_yes_rate: r4(mean(M, actual)),
};

// signal_strength deciles vs accuracy
{
  const withS = [...M].sort((a, b) => a.signal_strength - b.signal_strength);
  const dec = [];
  for (let i = 0; i < 10; i++) {
    const rs = withS.slice(Math.floor((i * withS.length) / 10), Math.floor(((i + 1) * withS.length) / 10));
    dec.push({
      decile: i + 1,
      signal_range: `${r2(rs[0].signal_strength)}-${r2(rs[rs.length - 1].signal_strength)}`,
      n: rs.length,
      accuracy: r4(mean(rs, (r) => (r.prediction_correct ? 1 : 0))),
      brier: r4(mean(rs, brier)),
    });
  }
  step6.signal_strength_deciles = dec;
}
out.step6_signal_quality = step6;

// ---------- STEP 7: EDGE ANALYSIS ----------
const step7 = {};
// 7a. Approved-signal PnL simulation: buy predicted side at its ask, payoff 1 if correct
{
  const trades = approved.filter((r) => (r.predicted_outcome === "YES" ? r.yes_ask != null : r.no_ask != null));
  const sim = trades.map((r) => {
    const price = r.predicted_outcome === "YES" ? r.yes_ask : r.no_ask;
    const win = r.prediction_correct;
    const roi = win ? 1 / price - 1 : -1;
    return { price, win, roi, edge_fee: r.edge_fee, id: r.id };
  });
  step7.approved_trade_sim = {
    n: sim.length,
    hit_rate: r4(mean(sim, (s) => (s.win ? 1 : 0))),
    mean_roi_per_trade: r4(mean(sim, (s) => s.roi)),
    total_roi: r4(sim.reduce((a, s) => a + s.roi, 0)),
    avg_entry_price: r4(mean(sim, (s) => s.price)),
    winners: sim.filter((s) => s.win).length,
    losers: sim.filter((s) => !s.win).length,
  };
}
// 7b. Counterfactual: trade every modeled snapshot with a book, whenever fee-adjusted edge > threshold
//     edge_fee > 0 means model P > breakeven incl. fees (already computed at record time)
{
  const cands = M.filter((r) => r.edge_fee != null && (r.predicted_outcome === "YES" ? r.yes_ask != null : r.no_ask != null));
  step7.counterfactual_pool = { n_with_edge_fee_and_book: cands.length };
  const thresholds = [0, 0.01, 0.02, 0.03, 0.05, 0.08, 0.10, 0.15];
  step7.counterfactual = thresholds.map((th) => {
    const trades = cands.filter((r) => r.edge_fee > th);
    if (!trades.length) return { threshold: th, n: 0 };
    const rois = trades.map((r) => {
      const price = r.predicted_outcome === "YES" ? r.yes_ask : r.no_ask;
      return r.prediction_correct ? 1 / price - 1 : -1;
    });
    return {
      threshold: th,
      n: trades.length,
      hit_rate: r4(mean(trades, (r) => (r.prediction_correct ? 1 : 0))),
      mean_roi_per_trade: r4(mean(rois, (x) => x)),
      total_roi_flat_1u: r4(rois.reduce((a, b) => a + b, 0)),
    };
  });
}
out.step7_edge_analysis = step7;

// ---------- STEP 8: CONDITIONAL PERFORMANCE ----------
const step8 = {};
step8.by_time_to_expiry = bucketize(M, (r) => r.seconds_remaining, [
  { label: "0-1m", test: (v) => v <= 60 },
  { label: "1-3m", test: (v) => v > 60 && v <= 180 },
  { label: "3-5m", test: (v) => v > 180 && v <= 300 },
  { label: "5-10m", test: (v) => v > 300 && v <= 600 },
  { label: "10-15m", test: (v) => v > 600 },
]);
function quintileBuckets(rows, keyFn) {
  const vals = rows.map(keyFn).sort((a, b) => a - b);
  const q = (i) => vals[Math.floor((i * vals.length) / 5)];
  const edges = [q(0), q(1), q(2), q(3), q(4), vals[vals.length - 1]];
  return [0, 1, 2, 3, 4].map((i) => ({
    label: `${r4(edges[i])} to ${r4(edges[i + 1])}`,
    test: (v) => v >= edges[i] && (i === 4 ? v <= edges[i + 1] : v < edges[i + 1]),
  }));
}
step8.by_realized_volatility = bucketize(M, (r) => r.realized_volatility, quintileBuckets(M, (r) => r.realized_volatility));
step8.by_momentum_pct = bucketize(M, (r) => r.momentum_pct, quintileBuckets(M, (r) => r.momentum_pct));
step8.by_abs_distance_from_strike = bucketize(M, (r) => Math.abs(r.distance_from_strike_pct), quintileBuckets(M, (r) => Math.abs(r.distance_from_strike_pct)));
out.step8_conditional_performance = step8;

// ---------- helpers ----------
function mean(arr, f) { return arr.reduce((a, x) => a + f(x), 0) / arr.length; }
function r4(x) { return x == null || Number.isNaN(x) ? null : Math.round(x * 10000) / 10000; }
function r2(x) { return Math.round(x * 100) / 100; }

fs.writeFileSync(path.join(__dirname, "data", "quality.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
