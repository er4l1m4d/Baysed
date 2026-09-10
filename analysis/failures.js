// Observation Run 001 — Step 9: Failure analysis
// Usage: node analysis/failures.js
const fs = require("fs");
const path = require("path");

const all = require("./data/resolved.json");
const FREEZE_UTC = Date.parse("2026-09-02T00:00:00Z");
const run001 = all.filter((r) => Date.parse(r.recorded_at) >= FREEZE_UTC && r.model_version === "distance_to_strike_v2");
const M = run001.filter((r) => r.probability != null);
const actual = (r) => (r.outcome_resolution === "yes_won" ? 1 : 0);
const brier = (r) => (r.probability - actual(r)) ** 2;

const out = {};

// 9a. High-confidence misses (confidence >= 0.8, wrong)
const confident = M.filter((r) => Math.abs(r.probability - 0.5) * 2 >= 0.6); // p<=0.2 or p>=0.8
const confidentWrong = confident.filter((r) => !r.prediction_correct);
out.high_confidence_misses = {
  n_confident: confident.length,
  n_wrong: confidentWrong.length,
  wrong_rate: r4(confidentWrong.length / confident.length),
  wrong_by_time_to_expiry: dist(confidentWrong, [
    ["0-1m", (r) => r.seconds_remaining <= 60],
    ["1-3m", (r) => r.seconds_remaining > 60 && r.seconds_remaining <= 180],
    ["3-5m", (r) => r.seconds_remaining > 180 && r.seconds_remaining <= 300],
    ["5-10m", (r) => r.seconds_remaining > 300 && r.seconds_remaining <= 600],
    ["10-15m", (r) => r.seconds_remaining > 600],
  ]),
  // were these near the strike?
  wrong_abs_distance_pct: quantiles(confidentWrong.map((r) => Math.abs(r.distance_from_strike_pct)), [0.25, 0.5, 0.75]),
  all_abs_distance_pct: quantiles(confident.map((r) => Math.abs(r.distance_from_strike_pct)), [0.25, 0.5, 0.75]),
  wrong_volatility: quantiles(confidentWrong.map((r) => r.realized_volatility), [0.25, 0.5, 0.75]),
  wrong_momentum: quantiles(confidentWrong.map((r) => r.momentum_pct), [0.25, 0.5, 0.75]),
};

// 9b. Top 20 worst Brier scores — pattern review
const worst = [...M].sort((a, b) => brier(b) - brier(a)).slice(0, 20);
out.worst_20 = worst.map((r) => ({
  id: r.id,
  recorded_at: r.recorded_at,
  prob: r.probability,
  resolution: r.outcome_resolution,
  seconds_remaining: r.seconds_remaining,
  distance_pct: r.distance_from_strike_pct,
  volatility: r.realized_volatility,
  momentum: r.momentum_pct,
  brier: r4(brier(r)),
}));

// 9c. 2026-09-04 coverage dip — hourly snapshot counts
{
  const d4 = run001.filter((r) => r.recorded_at.startsWith("2026-09-04"));
  const hours = {};
  for (const r of d4) {
    const h = r.recorded_at.slice(0, 13);
    hours[h] = (hours[h] || 0) + 1;
  }
  const sorted = Object.fromEntries(Object.entries(hours).sort());
  // find gaps: hours with 0 snapshots between first and last of ALL days
  const allDays = {};
  for (const r of run001) {
    const h = r.recorded_at.slice(0, 13);
    allDays[h] = (allDays[h] || 0) + 1;
  }
  const hoursList = Object.keys(allDays).sort();
  const first = Date.parse(hoursList[0]), last = Date.parse(hoursList[hoursList.length - 1]);
  const missingHours = [];
  for (let t = first; t <= last; t += 3600e3) {
    const key = new Date(t).toISOString().slice(0, 13);
    if (!allDays[key]) missingHours.push(key);
  }
  out.coverage = {
    "2026-09-04_hourly": sorted,
    missing_hours_entire_run: missingHours,
  };
}

// 9d. Resolution-lag outlier (the 4.9-day one)
{
  const lagged = all
    .map((r) => ({ id: r.id, market_id: r.market_id, recorded_at: r.recorded_at, closes_at: r.closes_at, resolved_at: r.resolved_at, lag_s: r.resolved_at ? (Date.parse(r.resolved_at) - Date.parse(r.closes_at)) / 1000 : null }))
    .filter((x) => x.lag_s != null)
    .sort((a, b) => b.lag_s - a.lag_s)
    .slice(0, 5);
  out.resolution_lag_top5 = lagged;
}

// 9e. Wrongness by hour-of-day (UTC) — any time-of-day pattern?
{
  const byHour = {};
  for (let h = 0; h < 24; h++) byHour[h] = { n: 0, wrong: 0 };
  for (const r of M) {
    const h = new Date(r.recorded_at).getUTCHours();
    byHour[h].n++;
    if (!r.prediction_correct) byHour[h].wrong++;
  }
  out.wrongness_by_utc_hour = Object.fromEntries(Object.entries(byHour).map(([h, v]) => [h, { n: v.n, wrong_rate: r4(v.wrong / v.n) }]));
}

// 9f. Reversal detection: confident early, wrong — did price cross strike late?
{
  // snapshots with >= 0.8 confidence at >= 5m remaining that were wrong
  const early = M.filter((r) => Math.abs(r.probability - 0.5) * 2 >= 0.6 && r.seconds_remaining >= 300);
  const earlyWrong = early.filter((r) => !r.prediction_correct);
  out.early_confident = { n: early.length, wrong: earlyWrong.length, wrong_rate: r4(earlyWrong.length / early.length) };
}

// helpers
function r4(x) { return x == null || Number.isNaN(x) ? null : Math.round(x * 10000) / 10000; }
function quantiles(arr, qs) {
  const s = [...arr].sort((a, b) => a - b);
  return Object.fromEntries(qs.map((q) => ["p" + q * 100, r4(s[Math.min(s.length - 1, Math.floor(q * s.length))])]));
}
function dist(rows, defs) {
  return defs.map(([label, test]) => {
    const rs = rows.filter(test);
    return { bucket: label, n: rs.length };
  });
}

fs.writeFileSync(path.join(__dirname, "data", "failures.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
