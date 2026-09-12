// Phase D — Model Candidate Harness (analysis only, NOT deployed to pipeline)
//
// Run 001 established:
//   - the model is EXACTLY P = Phi(d / (vol * sqrt(sec/60)))  (confirmed)
//   - calibration gaps exist (handled at GATE layer, not model layer)
//   - hour-0 UTC regime anomaly: 32.7% wrong rate, 6/8 nights
//   - evening-pocket edge hypothesis: KILLED (market ~ model every hour)
//   - execution (taker + naive maker): no edge on Run 001 data
//
// This harness tests MODEL-STRUCTURE candidates that fit on the Run 001
// FIT window (09-02..09-06) and are evaluated on the EVAL window
// (09-06..09-10), using the SAME gate + calibration + fee-ROI machinery
// as the gate backtest. The calibration layer is held CONSTANT across
// candidates so we isolate model structure only.
//
// We recompute probability from stored raw features (distance, vol, sec,
// momentum, daily_close) — NOT from the stored `probability` column.
// First we assert the baseline formula reproduces the stored probability
// (self-validation of the replay).
//
// Usage: node analysis/model_candidates.js
// Output: analysis/data/model_candidates.json + console summary
const fs = require("fs");
const path = require("path");

const API = "https://baysed.onrender.com";
const RUN1_START = Date.parse("2026-09-02T00:00:00Z");
const RUN1_END = Date.parse("2026-09-10T22:00:00Z");
const FIT_END = Date.parse("2026-09-06T00:00:00Z");

const r4 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 10000) / 10000);
const mean = (a, f = (x) => x) => (a.length ? a.reduce((s, x) => s + f(x), 0) / a.length : null);
const actual = (r) => (r.outcome_resolution === "yes_won" ? 1 : 0);

// ---------- probability helpers (mirror strategy.py exactly) ----------
function erf(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return x >= 0 ? y : -y;
}
function normalCdf(z) {
  return 0.5 * (1 + erf(z / Math.sqrt(2)));
}
function clamp01(p) {
  return Math.max(0.01, Math.min(0.99, p));
}
// Baseline: distance-to-strike v2 (the frozen Run 001 model)
function probBaseline(f) {
  const d = f.distance_from_strike_pct;
  const v = f.realized_volatility;
  const s = f.seconds_remaining;
  if (!(v > 0) || s <= 0) return clamp01(0.5 + d * 4); // fallback path
  const z = d / (v * Math.sqrt(s / 60));
  return clamp01(normalCdf(z));
}

// ---------- candidate model transforms (operate on raw features -> p_raw) ----------
const CANDIDATES = {
  // M0: baseline (reproduce frozen model)
  M0_baseline: {
    label: "distance_to_strike_v2 (frozen)",
    fn: (f, p) => probBaseline(f),
    params: {},
    fit: () => ({}),
  },

  // M1: hour-0 regime hedge — shrink confidence toward 0.5 at UTC hour 0
  // Rationale: Run 001 measured 32.7% wrong rate at hour 0, 6/8 nights.
  M1_hour0_hedge: {
    label: "baseline + hour-0 humility (shrink toward 0.5)",
    fn: (f, p) => {
      const hour = new Date(f.recorded_at).getUTCHours();
      if (hour !== 0) return p.base;
      return 0.5 + (p.base - 0.5) * (1 - p.h);
    },
    params: { h: 0 },
    fit: (rows) => {
      // grid search h on fit window by Brier (only hour-0 rows moved)
      let best = { h: 0 }, bestBrier = Infinity;
      for (const h of [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]) {
        const brier = mean(rows, (f) => {
          const p = clamp01(0.5 + (probBaseline(f) - 0.5) * (1 - h));
          return (p - actual(f)) ** 2;
        });
        if (brier < bestBrier) { bestBrier = brier; best = { h }; }
      }
      return best;
    },
  },

  // M3: momentum blend — does momentum carry signal beyond distance-to-strike?
  // p = (1-w)*dist_p + w*(0.5 + momentum*4)
  M3_momentum_blend: {
    label: "distance + momentum blend (w fitted)",
    fn: (f, p) => {
      const mMom = clamp01(0.5 + f.momentum_pct * 4);
      return (1 - p.w) * p.base + p.w * mMom;
    },
    params: { w: 0 },
    fit: (rows) => {
      let best = { w: 0 }, bestBrier = Infinity;
      for (const w of [0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.4]) {
        const brier = mean(rows, (f) => {
          const mMom = clamp01(0.5 + f.momentum_pct * 4);
          const p = clamp01((1 - w) * probBaseline(f) + w * mMom);
          return (p - actual(f)) ** 2;
        });
        if (brier < bestBrier) { bestBrier = brier; best = { w }; }
      }
      return best;
    },
  },

  // M4: vol-scaling humility — in thin/low-vol/short-expiry regimes, widen
  // effective volatility (more humility -> probability pulled toward 0.5).
  // eff_vol = vol * f when (sec < T) or (vol < V)
  M4_vol_humility: {
    label: "distance + vol-scaling humility (f, T, V fitted)",
    fn: (f, p) => {
      let v = f.realized_volatility;
      if (f.seconds_remaining < p.T || v < p.V) v = v * p.f;
      if (!(v > 0) || f.seconds_remaining <= 0) return clamp01(0.5 + f.distance_from_strike_pct * 4);
      const z = f.distance_from_strike_pct / (v * Math.sqrt(f.seconds_remaining / 60));
      return clamp01(normalCdf(z));
    },
    params: { f: 1, T: 999999, V: 0 },
    fit: (rows) => {
      let best = { f: 1, T: 999999, V: 0 }, bestBrier = Infinity;
      for (const T of [300, 600, 900]) {
        for (const V of [0.1, 0.15, 0.2, 0.25]) {
          for (const f of [1.5, 2, 3]) {
            const brier = mean(rows, (r) => {
              let v = r.realized_volatility;
              if (r.seconds_remaining < T || v < V) v = v * f;
              let z;
              if (!(v > 0) || r.seconds_remaining <= 0) z = r.distance_from_strike_pct * 4;
              else z = r.distance_from_strike_pct / (v * Math.sqrt(r.seconds_remaining / 60));
              return (clamp01(normalCdf(z)) - actual(r)) ** 2;
            });
            if (brier < bestBrier) { bestBrier = brier; best = { f, T, V }; }
          }
        }
      }
      return best;
    },
  },
};

// ---------- calibration + gate (mirror gate_backtest.js) ----------
function fitGaps(data) {
  const buckets = Array.from({ length: 10 }, () => ({ n: 0, sp: 0, sa: 0 }));
  for (const r of data) {
    const p = probBaseline(r);
    const b = Math.min(9, Math.max(0, Math.floor(p * 10)));
    buckets[b].n++; buckets[b].sp += p; buckets[b].sa += actual(r);
  }
  return buckets.map((b) => (b.n >= 30 ? b.sp / b.n - b.sa / b.n : 0));
}
function makeCalibrator(gaps) {
  return (p) => {
    const b = Math.min(9, Math.max(0, Math.floor(p * 10)));
    return Math.min(0.99, Math.max(0.01, p - gaps[b]));
  };
}
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

// Evaluate one candidate on a dataset through the gate (calibrated, exec edge)
function evaluate(name, label, params, data, calibrator, slip = 0.02, minEdge = 0.02, maxEdge = 0.15) {
  const approved = [];
  const scored = [];
  for (const r of data) {
    const base = probBaseline(r);
    const pRaw = clamp01(CANDIDATES[name].fn({ ...r, recorded_at: r.recorded_at }, { base, ...params }));
    const pCal = calibrator(pRaw);
    const predicted = pRaw > 0.5 ? "YES" : "NO";
    const entry = predicted === "YES" ? r.yes_ask : r.no_ask;
    const execEdge =
      entry != null ? (predicted === "YES" ? pCal : 1 - pCal) - pBe(entry) - slip : null;
    const passes =
      entry != null &&
      r.yes_ask != null &&
      r.no_ask != null &&
      r.yes_ask + r.no_ask >= 0.9 &&
      r.yes_ask + r.no_ask <= 1.1 &&
      r.seconds_remaining >= 60 &&
      new Date(r.recorded_at).getUTCHours() !== 0 &&
      execEdge != null &&
      execEdge > minEdge &&
      execEdge < maxEdge;
    const correct = predicted === "YES" ? r.outcome_resolution === "yes_won" : r.outcome_resolution === "no_won";
    const row = { ...r, probability: pRaw, predicted_outcome: predicted, prediction_correct: correct };
    scored.push(row);
    if (passes) approved.push(row);
  }
  // market-level paired test (approved vs rejected within same market)
  const byMarket = new Map();
  for (const row of scored) {
    if (!byMarket.has(row.market_id)) byMarket.set(row.market_id, { a: [], j: [] });
    const m = byMarket.get(row.market_id);
    const isAppr = approved.includes(row);
    (isAppr ? m.a : m.j).push(row);
  }
  const diffs = [];
  for (const { a, j } of byMarket.values()) {
    if (a.length && j.length >= 5) {
      diffs.push(mean(a, (r) => (r.prediction_correct ? 1 : 0)) - mean(j, (r) => (r.prediction_correct ? 1 : 0)));
    }
  }
  let tStat = null;
  if (diffs.length >= 10) {
    const m = mean(diffs);
    const sd = Math.sqrt(mean(diffs.map((d) => (d - m) ** 2)) * diffs.length / (diffs.length - 1));
    tStat = r4(m / (sd / Math.sqrt(diffs.length)));
  }
  return {
    model: name,
    label,
    params: r4params(params),
    n_scored: scored.length,
    brier_raw_model: r4(mean(scored, (r) => (r.probability - actual(r)) ** 2)),
    brier_calibrated_model: r4(mean(scored, (r) => (calibrator(r.probability) - actual(r)) ** 2)),
    approved_n: approved.length,
    approved_share: r4(approved.length / scored.length),
    accuracy: approved.length ? r4(mean(approved, (r) => (r.prediction_correct ? 1 : 0))) : null,
    taker_sim: roiSim(approved.filter((r) => (r.predicted_outcome === "YES" ? r.yes_ask : r.no_ask) != null)),
    market_level: diffs.length >= 10 ? { paired_markets: diffs.length, t_stat: tStat } : null,
  };
}
function r4params(p) {
  const o = {};
  for (const k of Object.keys(p)) o[k] = typeof p[k] === "number" ? r4(p[k]) : p[k];
  return o;
}

// ---------- fetch Run 001 core ----------
async function getJSON(url, retries = 5) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (i === retries) throw e;
      await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
    }
  }
}
async function fetchAll(base) {
  const all = [];
  let offset = 0;
  for (;;) {
    const page = await getJSON(`${API}${base}${base.includes("?") ? "&" : "?"}limit=1000&offset=${offset}`);
    all.push(...page);
    if (page.length < 1000) break;
    offset += 1000;
    await new Promise((r) => setTimeout(r, 250));
  }
  return all;
}

(async () => {
  console.log("fetching Run 001 predictions (with raw features)...");
  const raw = (await fetchAll("/predictions")).filter(
    (r) =>
      Date.parse(r.recorded_at) >= RUN1_START &&
      Date.parse(r.recorded_at) < RUN1_END &&
      r.model_version === "distance_to_strike_v2"
  );
  console.log(`Run 001 core rows: ${raw.length}`);

  // Restrict evaluation universe to well-defined model rows. Some Run 001
  // rows have seconds_remaining=0 / vol<=0 (degenerate near-expiry where the
  // model falls back but stored probability was clamped) — these cannot be
  // replayed and are excluded by the gate (sec>=60) anyway.
  const wellDefined = (r) => r.realized_volatility > 0 && r.seconds_remaining > 0 && r.probability != null;

  // self-validation: baseline formula must reproduce stored probability
  // (only on well-defined rows)
  let maxDev = 0;
  for (const r of raw) {
    if (!wellDefined(r)) continue;
    const rec = probBaseline(r);
    maxDev = Math.max(maxDev, Math.abs(rec - r.probability));
  }
  console.log(`baseline replay max |recomputed - stored| = ${maxDev.toExponential(2)} (expect < 1e-3)`);
  if (maxDev > 0.01) {
    console.log("!! WARNING: baseline does not reproduce stored probability — replay invalid");
  }

  const data = raw.filter(wellDefined);
  const fitRows = data.filter((r) => Date.parse(r.recorded_at) < FIT_END);
  const evalRows = data.filter((r) => Date.parse(r.recorded_at) >= FIT_END);
  const gapsFit = fitGaps(fitRows);
  const gapsFull = fitGaps(data);
  const calFit = makeCalibrator(gapsFit);
  const calFull = makeCalibrator(gapsFull);

  const out = {
    meta: {
      run001_core_rows: data.length,
      fit_rows: fitRows.length,
      eval_rows: evalRows.length,
      split_at: "2026-09-06T00:00:00Z",
      baseline_replay_max_deviation: maxDev,
      note: "calibration layer held constant across candidates; isolates MODEL STRUCTURE",
    },
    calibration_gaps_fit_window: gapsFit.map((g, i) => ({ bucket: `${i * 10}-${(i + 1) * 10}%`, gap: r4(g) })),
    fitted_params: {},
    full_window_in_sample: {},
    eval_window_temporal: {},
  };

  for (const name of Object.keys(CANDIDATES)) {
    const cand = CANDIDATES[name];
    const params = cand.fit(fitRows);
    out.fitted_params[name] = { label: cand.label, params: r4params(params) };
    out.full_window_in_sample[name] = evaluate(name, cand.label, params, raw, calFull);
    out.eval_window_temporal[name] = evaluate(name, cand.label, params, evalRows, calFit);
  }

  fs.writeFileSync(path.join(__dirname, "data", "model_candidates.json"), JSON.stringify(out, null, 2));

  // ---------- console summary ----------
  const show = (title, key) => {
    console.log(`\n=== ${title} ===`);
    for (const name of Object.keys(CANDIDATES)) {
      const e = out[key][name];
      console.log(
        `${name} [${JSON.stringify(e.fitted_params ?? e.params)}]: ` +
          `brier=${e.brier_calibrated_model} approv=${e.approved_n} ` +
          `acc=${e.accuracy} takerROI=${e.taker_sim?.mean_roi_per_trade} ` +
          `t=${e.market_level?.t_stat}`
      );
    }
  };
  console.log("\nfit-window fitted params:");
  for (const name of Object.keys(CANDIDATES))
    console.log(`  ${name}: ${JSON.stringify(out.fitted_params[name].params)}`);
  show("FULL WINDOW (in-sample, diagnostic)", "full_window_in_sample");
  show("EVAL WINDOW (temporal split — honest)", "eval_window_temporal");
})().catch((e) => { console.error(e); process.exit(1); });
