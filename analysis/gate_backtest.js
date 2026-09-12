// Phase C — Gate backtest harness
// Replay Run 001 data through candidate approval gates and measure what the
// old (anti-selective) gate did vs executable-edge candidates.
//
// Usage: node analysis/gate_backtest.js
// Input: analysis/data/resolved.json (Run 001 core, gitignored, re-fetchable)
// Output: analysis/data/gate_backtest.json + console summary
//
// Fee convention matches strategy.py exactly:
//   p_be = price / (1 - feeRate * max(1 - price, 0.5)), feeRate = 0.10
//   edge_fee = model_p - p_be
// Taker ROI sim (all-in cost incl. fees):
//   c = price * (1 + 0.10 * max(1 - price, 0.5))
//   roi = correct ? (1 - c) / c : -1
const fs = require("fs");
const path = require("path");

const all = require("./data/resolved.json");
const RUN1_START = Date.parse("2026-09-02T00:00:00Z");
const RUN1_END = Date.parse("2026-09-10T22:00:00Z");
const FIT_END = Date.parse("2026-09-06T00:00:00Z"); // temporal split for honest calibration

const rows = all.filter(
  (r) =>
    Date.parse(r.recorded_at) >= RUN1_START &&
    Date.parse(r.recorded_at) < RUN1_END &&
    r.model_version === "distance_to_strike_v2" &&
    r.probability != null
);

const actual = (r) => (r.outcome_resolution === "yes_won" ? 1 : 0);
const r4 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 10000) / 10000);
const mean = (a, f = (x) => x) => (a.length ? a.reduce((s, x) => s + f(x), 0) / a.length : null);

function pBe(price) {
  return price / (1 - 0.1 * Math.max(1 - price, 0.5));
}
function allInCost(price) {
  return price * (1 + 0.1 * Math.max(1 - price, 0.5));
}
function roiSim(rows) {
  if (!rows.length) return null;
  const rois = rows.map((r) => {
    const price = r.predicted_outcome === "YES" ? r.yes_ask : r.no_ask;
    const c = allInCost(price);
    return r.prediction_correct ? (1 - c) / c : -1;
  });
  return {
    n: rows.length,
    hit_rate: r4(mean(rows, (r) => (r.prediction_correct ? 1 : 0))),
    mean_roi_per_trade: r4(mean(rois)),
    total_roi_flat_1u: r4(rois.reduce((a, b) => a + b, 0)),
  };
}

// ---------- Calibration fitting ----------
function fitGaps(data) {
  const buckets = Array.from({ length: 10 }, () => ({ n: 0, sp: 0, sa: 0 }));
  for (const r of data) {
    const b = Math.min(9, Math.floor(r.probability * 10));
    const bk = buckets[b];
    bk.n++; bk.sp += r.probability; bk.sa += actual(r);
  }
  // gap = avg_predicted - actual_rate; calibrate: p_cal = p - gap
  return buckets.map((b) => (b.n >= 30 ? b.sp / b.n - b.sa / b.n : 0));
}
function makeCalibrator(gaps) {
  return (p) => {
    const b = Math.min(9, Math.max(0, Math.floor(p * 10)));
    return Math.min(0.99, Math.max(0.01, p - gaps[b]));
  };
}

// ---------- Gate evaluation ----------
function evalGate(name, data, approveFn, calibrator) {
  const approved = data.filter(approveFn);
  const rejected = data.filter((r) => !approveFn(r));
  const stats = {
    gate: name,
    approved_n: approved.length,
    approved_share: r4(approved.length / data.length),
    accuracy: approved.length ? r4(mean(approved, (r) => (r.prediction_correct ? 1 : 0))) : null,
    brier_raw_model: approved.length ? r4(mean(approved, (r) => (r.probability - actual(r)) ** 2)) : null,
    taker_sim: roiSim(approved.filter((r) => (r.predicted_outcome === "YES" ? r.yes_ask : r.no_ask) != null)),
  };
  // calibrated-model Brier on approved set (what the gate thinks vs truth)
  if (approved.length && calibrator) {
    stats.brier_calibrated_model = r4(
      mean(approved, (r) => {
        const pcal = calibrator(r.probability);
        const pEntry = r.predicted_outcome === "YES" ? pcal : 1 - pcal;
        return (pEntry - (r.prediction_correct ? 1 : 0)) ** 2;
      })
    );
  }
  // market-level paired test vs rejected (same market)
  const byMarket = new Map();
  for (const r of data) {
    if (!byMarket.has(r.market_id)) byMarket.set(r.market_id, { a: [], j: [] });
    (approveFn(r) ? byMarket.get(r.market_id).a : byMarket.get(r.market_id).j).push(r);
  }
  const diffs = [];
  for (const { a, j } of byMarket.values()) {
    if (a.length && j.length >= 5) {
      diffs.push(mean(a, (r) => (r.prediction_correct ? 1 : 0)) - mean(j, (r) => (r.prediction_correct ? 1 : 0)));
    }
  }
  if (diffs.length >= 10) {
    const m = mean(diffs);
    const sd = Math.sqrt(mean(diffs.map((d) => (d - m) ** 2)) * diffs.length / (diffs.length - 1));
    stats.market_level = {
      paired_markets: diffs.length,
      mean_acc_diff_vs_rejected: r4(m),
      t_stat: r4(m / (sd / Math.sqrt(diffs.length))),
    };
  }
  return stats;
}

// ---------- EXEC gate builder ----------
function execGate({ slip = 0.01, minEdge = 0, maxEdge = 0.15, exclHour0 = true, minStrength = 0.35, twoSided = true } = {}) {
  return (r, cal) => {
    // tradability: ask on predicted side
    const entry = r.predicted_outcome === "YES" ? r.yes_ask : r.no_ask;
    if (entry == null) return false;
    if (twoSided && !(r.yes_ask != null && r.no_ask != null)) return false;
    // clean-book proxy (no bids in Run 001 rows): cross-side sum sanity
    if (r.yes_ask != null && r.no_ask != null) {
      const s = r.yes_ask + r.no_ask;
      if (s < 0.9 || s > 1.1) return false;
    }
    if (r.seconds_remaining < 60) return false;
    if (r.signal_strength < minStrength) return false;
    if (exclHour0 && new Date(r.recorded_at).getUTCHours() === 0) return false;
    // executable edge with calibrated probability
    const pYesCal = cal(r.probability);
    const pEntryCal = r.predicted_outcome === "YES" ? pYesCal : 1 - pYesCal;
    const edgeExec = pEntryCal - pBe(entry) - slip;
    return edgeExec > minEdge && edgeExec < maxEdge;
  };
}

// ---------- Run ----------
const out = { meta: {}, baseline: {}, candidates: [], sweep: {}, temporal: {}, evening_pocket: {} };
const fitRows = rows.filter((r) => Date.parse(r.recorded_at) < FIT_END);
const evalRows = rows.filter((r) => Date.parse(r.recorded_at) >= FIT_END);
out.meta = {
  run001_core: rows.length,
  fit_window_rows: fitRows.length,
  eval_window_rows: evalRows.length,
  split_at: "2026-09-06T00:00:00Z",
};

// Baseline: the recorded approved flag (old disagreement gate)
out.baseline = evalGate("G0_recorded_old_gate (disagreement)", rows, (r) => r.approved, null);
out.baseline.rejected_accuracy = r4(mean(rows.filter((r) => !r.approved), (r) => (r.prediction_correct ? 1 : 0)));

// Calibration gaps — full Run 001 (in-sample) and fit-window only (honest)
const gapsFull = fitGaps(rows);
const gapsFit = fitGaps(fitRows);
const calFull = makeCalibrator(gapsFull);
const calFit = makeCalibrator(gapsFit);
out.meta.calibration_gaps_full = gapsFull.map((g, i) => ({ bucket: `${i * 10}-${(i + 1) * 10}%`, gap: r4(g) }));
out.meta.calibration_gaps_fit_window = gapsFit.map((g, i) => ({ bucket: `${i * 10}-${(i + 1) * 10}%`, gap: r4(g) }));

// Reference: counterfactual "trade every positive edge_fee" (ties to Run 001 report)
out.candidates.push(
  evalGate("REF_edge_fee_positive_all_books", rows, (r) => {
    const entry = r.predicted_outcome === "YES" ? r.yes_ask : r.no_ask;
    return entry != null && r.edge_fee != null && r.edge_fee > 0;
  }, null)
);
out.candidates.push(
  evalGate("REF_edge_fee_positive_two_sided", rows, (r) => {
    const entry = r.predicted_outcome === "YES" ? r.yes_ask : r.no_ask;
    return entry != null && r.yes_ask != null && r.no_ask != null && r.edge_fee != null && r.edge_fee > 0;
  }, null)
);

// EXEC candidates, in-sample (gapsFull) — diagnostic only
for (const cfg of [
  { slip: 0.01, minEdge: 0, exclHour0: true },
  { slip: 0.01, minEdge: 0.02, exclHour0: true },
  { slip: 0.02, minEdge: 0, exclHour0: true },
]) {
  out.candidates.push(
    evalGate(`EXEC_insample_slip${cfg.slip}_min${cfg.minEdge}`, rows, (r) => execGate(cfg)(r, calFull), calFull)
  );
}

// ---------- Parameter sweep (in-sample, diagnostic) ----------
const sweep = [];
for (const slip of [0, 0.01, 0.02]) {
  for (const minEdge of [0, 0.01, 0.02, 0.03, 0.05]) {
    const g = execGate({ slip, minEdge });
    const s = evalGate(`slip${slip}_min${minEdge}`, rows, (r) => g(r, calFull), calFull);
    sweep.push({ slip, minEdge, approved: s.approved_n, accuracy: s.accuracy, mean_roi: s.taker_sim?.mean_roi_per_trade ?? null, t: s.market_level?.t_stat ?? null });
  }
}
out.sweep = sweep;

// ---------- Temporal validation (honest): fit 09-02..09-06, evaluate 09-06..09-10 ----------
out.temporal.old_gate_eval_window = evalGate("G0_old_gate (eval window only)", evalRows, (r) => r.approved, null);
for (const cfg of [
  { slip: 0.01, minEdge: 0, exclHour0: true },
  { slip: 0.01, minEdge: 0.01, exclHour0: true },
  { slip: 0.02, minEdge: 0, exclHour0: true },
]) {
  out.temporal[`EXEC_slip${cfg.slip}_min${cfg.minEdge}`] = evalGate(
    `EXEC_slip${cfg.slip}_min${cfg.minEdge}`,
    evalRows,
    (r) => execGate(cfg)(r, calFit),
    calFit
  );
}

// ---------- Evening pocket analysis (two-sided books, by UTC hour) ----------
{
  const twoSided = rows.filter((r) => r.yes_ask != null && r.no_ask != null && r.yes_ask + r.no_ask >= 0.9 && r.yes_ask + r.no_ask <= 1.1);
  const byHour = {};
  for (let h = 0; h < 24; h++) {
    const rs = twoSided.filter((r) => new Date(r.recorded_at).getUTCHours() === h);
    if (!rs.length) continue;
    const mktP = (r) => r.yes_ask;
    byHour[h] = {
      n: rs.length,
      brier_model: r4(mean(rs, (r) => (r.probability - actual(r)) ** 2)),
      brier_model_cal: r4(mean(rs, (r) => (calFit(r.probability) - actual(r)) ** 2)),
      brier_market: r4(mean(rs, (r) => (mktP(r) - actual(r)) ** 2)),
      mean_edge_exec_two_sided: r4(mean(rs, (r) => {
        const entry = r.predicted_outcome === "YES" ? r.yes_ask : r.no_ask;
        if (entry == null) return 0;
        const pEntryCal = r.predicted_outcome === "YES" ? calFit(r.probability) : 1 - calFit(r.probability);
        return pEntryCal - pBe(entry) - 0.01;
      })),
      sim: roiSim(rs.filter((r) => (r.predicted_outcome === "YES" ? r.yes_ask : r.no_ask) != null)),
    };
  }
  out.evening_pocket.two_sided_by_hour = byHour;
  // focus: hours where market brier - model brier is largest
  const ranked = Object.entries(byHour)
    .map(([h, v]) => ({ hour: +h, edge_over_market: r4(v.brier_market - v.brier_model_cal), ...v }))
    .sort((a, b) => b.edge_over_market - a.edge_over_market);
  out.evening_pocket.hours_ranked_by_model_edge = ranked.slice(0, 6);
}

fs.writeFileSync(path.join(__dirname, "data", "gate_backtest.json"), JSON.stringify(out, null, 2));

// ---------- Console summary ----------
console.log("=== BASELINE (old gate) ===");
console.log(JSON.stringify(out.baseline, null, 1));
console.log("\n=== REFERENCES ===");
out.candidates.forEach((c) => console.log(`${c.gate}: n=${c.approved_n} acc=${c.accuracy} roi=${c.taker_sim?.mean_roi_per_trade}`));
console.log("\n=== TEMPORAL (fit 09-02..09-06, eval 09-06..09-10) ===");
for (const [k, v] of Object.entries(out.temporal)) {
  console.log(`${k}: n=${v.approved_n} acc=${v.accuracy} roi=${v.taker_sim?.mean_roi_per_trade} t=${v.market_level?.t_stat}`);
}
console.log("\n=== SWEEP (in-sample diagnostic) ===");
sweep.forEach((s) => console.log(`slip=${s.slip} min=${s.minEdge}: n=${s.approved} acc=${s.accuracy} roi=${s.mean_roi} t=${s.t}`));
console.log("\n=== TOP HOURS: model(cal) edge over market (two-sided) ===");
out.evening_pocket.hours_ranked_by_model_edge.forEach((h) =>
  console.log(`h=${h.hour}: n=${h.n} model_cal=${h.brier_model_cal} market=${h.brier_market} edge=${h.edge_over_market} simROI=${h.sim?.mean_roi_per_trade}`)
);
