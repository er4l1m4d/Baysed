// Observation Run 001 — Steps 1-3: Data integrity, Coverage, Resolution integrity
// Usage: node analysis/integrity.js
const fs = require("fs");
const path = require("path");

const resolved = require("./data/resolved.json");
const pending = require("./data/pending.json");

const FREEZE_UTC = Date.parse("2026-09-02T00:00:00Z");
const isRun001 = (r) => Date.parse(r.recorded_at) >= FREEZE_UTC && r.model_version === "distance_to_strike_v2";

const t = (r) => Date.parse(r.recorded_at);
const fmt = (ms) => new Date(ms).toISOString();

function quantiles(arr, qs) {
  const s = [...arr].sort((a, b) => a - b);
  return Object.fromEntries(qs.map((q) => [q, s[Math.min(s.length - 1, Math.floor(q * s.length))]]));
}

const out = {};
const log = (k, v) => { out[k] = v; };

// ---------- STEP 1: DATA INTEGRITY ----------
const step1 = {};

step1.total_records = resolved.length + pending.length;
step1.time_range = { oldest: resolved[resolved.length - 1].recorded_at, newest: resolved[0].recorded_at };

// Segmentation: pre-window vs Run 001 core
const preWindow = resolved.filter((r) => t(r) < FREEZE_UTC);
const run001 = resolved.filter((r) => t(r) >= FREEZE_UTC);
step1.segmentation = {
  pre_window_resolved: preWindow.length,
  run001_resolved: run001.length,
  pre_window_model_versions: tally(preWindow.map((r) => r.model_version)),
  run001_model_versions: tally(run001.map((r) => r.model_version)),
  // baseline cross-check: manifest said 4,528 resolved at freeze (2026-09-02)
  // note: freeze baseline was taken during 2026-09-02; pre-window here = strictly before midnight UTC
};

// run_id distribution within Run 001 (engine restarts during the window)
const run001Runs = tally(run001.map((r) => r.run_id));
step1.run001_restarts = { count: Object.keys(run001Runs).length, runs: run001Runs };

// Duplicates: same market_id + observed_at
const seen = new Set();
let dupes = 0;
for (const r of resolved) {
  const k = `${r.market_id}|${r.observed_at}`;
  if (seen.has(k)) dupes++;
  else seen.add(k);
}
step1.duplicate_keys = dupes;

// Probability sanity
const withProb = resolved.filter((r) => r.probability != null);
step1.probability = {
  null_count: resolved.length - withProb.length,
  out_of_range: withProb.filter((r) => r.probability < 0 || r.probability > 1).length,
  exact_extremes: withProb.filter((r) => r.probability === 0 || r.probability === 1).length,
  min: Math.min(...withProb.map((r) => r.probability)),
  max: Math.max(...withProb.map((r) => r.probability)),
};

// Brier recompute check: brier = (prob - actual)^2, actual = 1 if yes_won
let brierMismatch = 0;
for (const r of withProb) {
  if (r.brier_score == null) { brierMismatch++; continue; }
  const actual = r.outcome_resolution === "yes_won" ? 1 : 0;
  if (Math.abs(r.brier_score - (r.probability - actual) ** 2) > 1e-6) brierMismatch++;
}
step1.brier_recompute_mismatches = brierMismatch;

// prediction_correct recompute check
let correctMismatch = 0;
for (const r of resolved) {
  if (!r.predicted_outcome) continue;
  const expected = (r.predicted_outcome.toLowerCase() + "_won") === r.outcome_resolution;
  if (expected !== r.prediction_correct) correctMismatch++;
}
step1.prediction_correct_mismatches = correctMismatch;

// Timestamp sanity
let tsViol = 0, tsExamples = [];
for (const r of resolved) {
  const obs = Date.parse(r.observed_at), rec = Date.parse(r.recorded_at), close = Date.parse(r.closes_at), res = Date.parse(r.resolved_at);
  let bad = rec < obs - 1000 || close <= obs;
  if (r.resolved_at) {
    if (res < close - 1000) bad = true;
    const sr = (close - obs) / 1000;
    if (Math.abs(sr - r.seconds_remaining) > 5) bad = true;
  }
  if (bad) { tsViol++; if (tsExamples.length < 3) tsExamples.push({ id: r.id, market_id: r.market_id, observed_at: r.observed_at, closes_at: r.closes_at, resolved_at: r.resolved_at, seconds_remaining: r.seconds_remaining }); }
}
step1.timestamp_violations = { count: tsViol, examples: tsExamples };

log("step1_data_integrity", step1);

// ---------- STEP 2: COVERAGE (Run 001 core only) ----------
const step2 = {};
const byMarket = new Map();
for (const r of run001) {
  if (!byMarket.has(r.market_id)) byMarket.set(r.market_id, []);
  byMarket.get(r.market_id).push(r);
}
const markets = [...byMarket.values()].map((rows) => {
  rows.sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at));
  return rows;
});
const snapsPerMarket = markets.map((m) => m.length);
const dayTally = tally(run001.map((r) => r.recorded_at.slice(0, 10)));

// expected 15-min markets per day: 96
const perDay = {};
for (const [day, rows] of Object.entries(groupBy(run001, (r) => r.recorded_at.slice(0, 10)))) {
  const mids = new Set(rows.map((r) => r.market_id));
  perDay[day] = { snapshots: rows.length, markets: mids.size };
}

step2.markets_observed = markets.length;
step2.expected_markets_8d = 96 * 8;
step2.snapshots = { total: run001.length, per_market: { mean: avg(snapsPerMarket), ...quantiles(snapsPerMarket, [0, 0.5, 1]) }, min_market: Math.min(...snapsPerMarket), max_market: Math.max(...snapsPerMarket) };
step2.per_day = perDay;
step2.snapshots_per_day = dayTally;
step2.modeled_fraction = run001.filter((r) => r.probability != null).length / run001.length;
step2.approved_fraction = run001.filter((r) => r.approved).length / run001.length;

// Inter-snapshot interval (within a market)
const intervals = [];
for (const m of markets) for (let i = 1; i < m.length; i++) intervals.push((Date.parse(m[i].observed_at) - Date.parse(m[i - 1].observed_at)) / 1000);
step2.inter_snapshot_interval_seconds = quantiles(intervals, [0, 0.5, 0.9, 0.99, 1]);

log("step2_coverage", step2);

// ---------- STEP 3: RESOLUTION INTEGRITY ----------
const step3 = {};
step3.outcome_resolution_values = tally(resolved.map((r) => r.outcome_resolution));
step3.resolution_source_values = tally(resolved.map((r) => r.resolution_source));

let badOutcomeId = 0, nullOutcomeId = 0;
for (const r of resolved) {
  if (!r.resolved_outcome_id) { nullOutcomeId++; continue; }
  if (r.resolved_outcome_id !== r.outcome1_id && r.resolved_outcome_id !== r.outcome2_id) badOutcomeId++;
}
step3.resolved_outcome_id = { null: nullOutcomeId, not_in_market_outcomes: badOutcomeId };
step3.actual_price_missing = resolved.filter((r) => r.actual_price == null).length;
step3.resolved_at_missing = resolved.filter((r) => r.resolved_at == null).length;

// Resolution lag: resolved_at - closes_at
const lags = resolved.filter((r) => r.resolved_at).map((r) => (Date.parse(r.resolved_at) - Date.parse(r.closes_at)) / 1000);
step3.resolution_lag_seconds = quantiles(lags, [0, 0.5, 0.9, 0.99, 1]);

// Pending: ages
const now = Date.now();
step3.pending = {
  count: pending.length,
  ages_seconds: quantiles(pending.map((r) => (now - Date.parse(r.recorded_at)) / 1000), [0, 0.5, 1]),
  oldest: pending.length ? fmt(Math.min(...pending.map((r) => t(r)))) : null,
  older_than_1h: pending.filter((r) => now - t(r) > 3600e3).length,
};

// Unmodeled resolved rows (no probability) — why?
const unmodeled = resolved.filter((r) => r.probability == null);
step3.unmodeled_resolved = { count: unmodeled.length, reason_samples: [...new Set(unmodeled.flatMap((r) => r.reasons || []))].slice(0, 15) };

log("step3_resolution_integrity", step3);

// ---------- helpers ----------
function tally(arr) {
  const m = {};
  for (const x of arr) m[x] = (m[x] || 0) + 1;
  return m;
}
function groupBy(arr, f) {
  const m = {};
  for (const x of arr) { const k = f(x); (m[k] = m[k] || []).push(x); }
  return m;
}
function avg(a) { return a.reduce((x, y) => x + y, 0) / a.length; }

fs.writeFileSync(path.join(__dirname, "data", "integrity.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
