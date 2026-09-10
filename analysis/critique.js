// Post-critique analysis: clustering correction, time-of-day, baseline ladder, outage boundary
// Usage: node analysis/critique.js
const fs = require("fs");
const path = require("path");

const all = require("./data/resolved.json");
const FREEZE_UTC = Date.parse("2026-09-02T00:00:00Z");
const run001 = all.filter((r) => Date.parse(r.recorded_at) >= FREEZE_UTC && r.model_version === "distance_to_strike_v2");
const M = run001.filter((r) => r.probability != null && (r.outcome_resolution === "yes_won" || r.outcome_resolution === "no_won"));

const actual = (r) => (r.outcome_resolution === "yes_won" ? 1 : 0);
const brier = (r) => (r.probability - actual(r)) ** 2;
const marketP = (r) => (r.yes_ask != null ? r.yes_ask : r.no_ask != null ? 1 - r.no_ask : null);
const mBrier = (r) => (marketP(r) - actual(r)) ** 2;
const erf = (x) => { // Abramowitz-Stegun 7.1.26, max error 1.5e-7
  const s = Math.sign(x), ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
  return s * y;
};
const normCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
const logloss = (p, a) => { p = Math.min(Math.max(p, 1e-4), 1 - 1e-4); return -(a * Math.log(p) + (1 - a) * Math.log(1 - p)); };
const out = {};
const r4 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 10000) / 10000);

// ---------- 1. GAUSSIAN RECOMPUTE — is stored probability == Phi(z)? ----------
{
  let matched = 0, checked = 0, maxDiff = 0;
  for (const r of M) {
    if (r.realized_volatility <= 0 || r.seconds_remaining <= 0) continue;
    const tf = r.seconds_remaining / 60;
    const z = r.distance_from_strike_pct / (r.realized_volatility * Math.sqrt(tf));
    let p = normCdf(z);
    p = Math.max(0.01, Math.min(0.99, p));
    checked++;
    const d = Math.abs(p - r.probability);
    maxDiff = Math.max(maxDiff, d);
    if (d < 0.003) matched++;
  }
  out.gaussian_recompute = { checked, matched_within_0p003: matched, match_rate: r4(matched / checked), max_abs_diff: r4(maxDiff) };
  // sample mismatches for diagnosis
  const samples = [];
  for (const r of M) {
    if (r.realized_volatility <= 0 || r.seconds_remaining <= 0) continue;
    const tf = r.seconds_remaining / 60;
    const z = r.distance_from_strike_pct / (r.realized_volatility * Math.sqrt(tf));
    let p = Math.max(0.01, Math.min(0.99, normCdf(z)));
    if (Math.abs(p - r.probability) > 0.003 && samples.length < 5) {
      samples.push({ id: r.id, z: r4(z), recomputed: r4(p), stored: r.probability, dist: r.distance_from_strike_pct, vol: r.realized_volatility, secs: r.seconds_remaining, strength: r4(r.signal_strength) });
    }
  }
  out.gaussian_recompute.mismatch_samples = samples;
}

// ---------- 2. MARKET-LEVEL CLUSTERING CORRECTION ----------
{
  const byMarket = new Map();
  for (const r of M) {
    if (!byMarket.has(r.market_id)) byMarket.set(r.market_id, []);
    byMarket.get(r.market_id).push(r);
  }
  const k = byMarket.size;

  // Per-market means (each market = ONE episode)
  const mAcc = [], mBrierModel = [], mBrierMarket = [], diffs = [];
  let pairedMarkets = 0, modelWins = 0, marketWins = 0;
  for (const rows of byMarket.values()) {
    mAcc.push(rows.reduce((a, r) => a + (r.prediction_correct ? 1 : 0), 0) / rows.length);
    const bm = rows.reduce((a, r) => a + brier(r), 0) / rows.length;
    mBrierModel.push(bm);
    const mk = rows.filter((r) => marketP(r) != null);
    if (mk.length >= rows.length / 2) {
      const bmk = mk.reduce((a, r) => a + mBrier(r), 0) / mk.length;
      mBrierMarket.push(bmk);
      diffs.push(bm - bmk);
      pairedMarkets++;
      if (bm < bmk - 1e-9) modelWins++; else if (bmk < bm - 1e-9) marketWins++;
    }
  }
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const sd = (a) => Math.sqrt(a.reduce((x, y) => x + (y - mean(a)) ** 2, 0) / (a.length - 1));

  // ICC (one-way random effects) on per-snapshot Brier clustered by market
  const grand = mean(M.map(brier));
  let ssb = 0, ssw = 0;
  const N = M.length;
  const ns = [...byMarket.values()].map((v) => v.length);
  for (const rows of byMarket.values()) {
    const mu = rows.reduce((a, r) => a + brier(r), 0) / rows.length;
    ssb += rows.length * (mu - grand) ** 2;
    for (const r of rows) ssw += (brier(r) - mu) ** 2;
  }
  const msb = ssb / (k - 1), msw = ssw / (N - k);
  const m0 = (N - ns.reduce((a, b) => a + b * b, 0) / N) / (k - 1);
  const icc = (msb - msw) / (msb + (m0 - 1) * msw);
  const deff = 1 + (m0 - 1) * icc;

  // Paired t-test on per-market model-vs-market Brier (normal approx, df large)
  const dbar = mean(diffs), dsd = sd(diffs);
  const t = dbar / (dsd / Math.sqrt(diffs.length));
  const pTwo = 2 * (1 - 0.5 * (1 + erf(Math.abs(t) / Math.SQRT2)));

  out.market_level = {
    episodes: k,
    snapshots: N,
    mean_snapshots_per_market: r4(N / k),
    pooled: { accuracy: r4(M.filter((r) => r.prediction_correct).length / N), brier_model: r4(mean(M.map(brier))) },
    mean_of_market_means: { accuracy: r4(mean(mAcc)), brier_model: r4(mean(mBrierModel)) },
    clustering: {
      icc_brier_within_market: r4(icc),
      avg_cluster_size_m0: r4(m0),
      design_effect: r4(deff),
      effective_sample_size: Math.round(N / deff),
      note: "22.7k snapshots are ~N_eff independent observations for within-market metrics",
    },
    model_vs_market_per_market: {
      paired_markets: pairedMarkets,
      model_better_markets: modelWins,
      market_better_markets: marketWins,
      model_share: r4(modelWins / pairedMarkets),
      mean_per_market_diff_brier: r4(dbar),
      sd_per_market_diff: r4(dsd),
      t_stat: r4(t),
      p_value: pTwo < 1e-10 ? "<1e-10" : pTwo.toExponential(3),
    },
  };

  // Model vs coin-flip, clustered: per-market Brier vs 0.25
  const d50 = mBrierModel.map((b) => b - 0.25);
  const t50 = mean(d50) / (sd(d50) / Math.sqrt(d50.length));
  out.market_level.model_vs_5050_per_market = {
    mean_diff: r4(mean(d50)), sd: r4(sd(d50)), t_stat: r4(t50),
    markets_where_model_beats_coinflip: d50.filter((d) => d < 0).length,
    share: r4(d50.filter((d) => d < 0).length / d50.length),
  };
}

// ---------- 3. BASELINE LADDER (all on rows with market available, n fixed) ----------
{
  const rows = M.filter((r) => marketP(r) != null);
  const ladder = [];
  const evalModel = (name, pf) => {
    const bs = rows.map((r) => (pf(r) - actual(r)) ** 2);
    const ll = rows.map((r) => logloss(pf(r), actual(r)));
    ladder.push({ model: name, brier: r4(bs.reduce((a, b) => a + b, 0) / bs.length), log_loss: r4(ll.reduce((a, b) => a + b, 0) / ll.length) });
  };
  evalModel("A1 coin flip (0.5)", () => 0.5);
  evalModel("A2 side-sign, confident (0.99/0.01)", (r) => (r.distance_from_strike_pct > 0 ? 0.99 : 0.01));
  evalModel("A3 side-sign, moderate (0.75/0.25)", (r) => (r.distance_from_strike_pct > 0 ? 0.75 : 0.25));
  evalModel("B  distance-linear (code fallback: 0.5+4d)", (r) => Math.max(0.01, Math.min(0.99, 0.5 + 4 * r.distance_from_strike_pct)));
  evalModel("C  Gaussian full = the model", (r) => r.probability);
  evalModel("D  market implied (corrected)", (r) => marketP(r));
  // E: Gaussian WITHOUT time scaling (vol only) — isolates the sqrt(t) ingredient
  evalModel("E  Gaussian no-time (z = d/vol)", (r) => {
    const z = r.distance_from_strike_pct / r.realized_volatility;
    return Math.max(0.01, Math.min(0.99, normCdf(z)));
  });
  out.baseline_ladder = { n: rows.length, ladder };
}

// ---------- 4. TIME-OF-DAY (full) ----------
{
  const hours = {};
  for (let h = 0; h < 24; h++) hours[h] = { n: 0, correct: 0, brierSum: 0, predYes: 0, actYes: 0, mktSum: 0, mktN: 0, divSum: 0 };
  for (const r of M) {
    const h = new Date(r.recorded_at).getUTCHours();
    const x = hours[h];
    x.n++; x.correct += r.prediction_correct ? 1 : 0; x.brierSum += brier(r);
    x.predYes += r.probability; x.actYes += actual(r);
    if (marketP(r) != null) { x.mktSum += mBrier(r); x.mktN++; }
    x.divSum += Math.abs(r.probability - (marketP(r) ?? r.probability));
  }
  out.time_of_day = Object.fromEntries(Object.entries(hours).map(([h, x]) => [h, {
    n: x.n,
    accuracy: r4(x.correct / x.n),
    brier: r4(x.brierSum / x.n),
    mean_pred_yes: r4(x.predYes / x.n),
    actual_yes_rate: r4(x.actYes / x.n),
    brier_market: x.mktN ? r4(x.mktSum / x.mktN) : null,
    mean_model_market_divergence: r4(x.divSum / x.n),
  }]));

  // Hour-00 spike decomposition
  const h0 = M.filter((r) => new Date(r.recorded_at).getUTCHours() === 0);
  const byNight = {};
  for (const r of h0) {
    const night = r.recorded_at.slice(0, 10);
    (byNight[night] = byNight[night] || []).push(r);
  }
  out.hour0_decomposition = {
    per_night: Object.fromEntries(Object.entries(byNight).map(([n, rs]) => [n, { n: rs.length, wrong_rate: r4(1 - rs.filter((r) => r.prediction_correct).length / rs.length), brier: r4(rs.reduce((a, r) => a + brier(r), 0) / rs.length) }])),
    by_distance: distTable(h0, (r) => Math.abs(r.distance_from_strike_pct), [0, 0.016, 0.0375, 0.0675, 0.125, 99]),
    by_expiry: distTable(h0, (r) => r.seconds_remaining, [0, 60, 180, 300, 600, 9999]),
    same_buckets_other_hours: (() => {
      const other = M.filter((r) => new Date(r.recorded_at).getUTCHours() !== 0);
      return { by_distance: distTable(other, (r) => Math.abs(r.distance_from_strike_pct), [0, 0.016, 0.0375, 0.0675, 0.125, 99]), by_expiry: distTable(other, (r) => r.seconds_remaining, [0, 60, 180, 300, 600, 9999]) };
    })(),
  };
}
function distTable(rows, keyFn, edges) {
  const res = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const rs = rows.filter((r) => keyFn(r) >= edges[i] && keyFn(r) < edges[i + 1]);
    if (!rs.length) { res.push({ bucket: `${edges[i]}-${edges[i + 1]}`, n: 0 }); continue; }
    res.push({ bucket: `${edges[i]}-${edges[i + 1]}`, n: rs.length, wrong_rate: r4(1 - rs.filter((r) => r.prediction_correct).length / rs.length), brier: r4(rs.reduce((a, r) => a + brier(r), 0) / rs.length) });
  }
  return res;
}

// ---------- 5. 09-04 OUTAGE BOUNDARY ----------
{
  const before = run001.filter((r) => r.recorded_at < "2026-09-04").sort((a, b) => Date.parse(b.recorded_at) - Date.parse(a.recorded_at))[0];
  const after = run001.filter((r) => r.recorded_at >= "2026-09-04").sort((a, b) => Date.parse(a.recorded_at) - Date.parse(b.recorded_at))[0];
  // hours 0-5 on other days
  const otherDaysH0to5 = {};
  for (const r of run001) {
    const d = r.recorded_at.slice(0, 10);
    if (d === "2026-09-04") continue;
    const h = new Date(r.recorded_at).getUTCHours();
    if (h <= 5) otherDaysH0to5[d] = (otherDaysH0to5[d] || 0) + 1;
  }
  const dow = new Date("2026-09-04T00:00:00Z").getUTCDay(); // 0=Sun..5=Fri,6=Sat
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  out.outage_0904 = {
    last_snapshot_before: { recorded_at: before.recorded_at, closes_at: before.closes_at, outcome: before.outcome_resolution },
    first_snapshot_after: { recorded_at: after.recorded_at, market_id: after.market_id, opened_at: after.opened_at, closes_at: after.closes_at },
    gap_hours: r4((Date.parse(after.recorded_at) - Date.parse(before.recorded_at)) / 3600e3),
    day_of_week: dayNames[dow],
    hours_00_05_snapshot_counts_on_other_days: otherDaysH0to5,
    missed_markets_estimate: "24 (six 15-min intervals x ~4 discovered per interval? no — 6h x 4/h = 24 intervals)",
  };
}

// ---------- 6. MODEL vs MARKET by condition (valuation layer) ----------
{
  const twoSided = M.filter((r) => r.yes_ask != null && r.no_ask != null && r.yes_ask + r.no_ask >= 0.9 && r.yes_ask + r.no_ask <= 1.1);
  const oneSided = M.filter((r) => marketP(r) != null && !(r.yes_ask != null && r.no_ask != null));
  const cond = (rows) => ({ n: rows.length, brier_model: r4(rows.reduce((a, r) => a + brier(r), 0) / rows.length), brier_market: r4(rows.reduce((a, r) => a + mBrier(r), 0) / rows.length) });
  out.model_vs_market_by_condition = {
    two_sided_book: cond(twoSided),
    one_sided_book: cond(oneSided),
    by_expiry: [["0-1m", 0, 60], ["1-3m", 61, 180], ["3-5m", 181, 300], ["5-10m", 301, 600], ["10-15m", 601, 9999]].map(([l, lo, hi]) => {
      const rs = M.filter((r) => marketP(r) != null && r.seconds_remaining >= lo && r.seconds_remaining <= hi);
      return { bucket: l, ...cond(rs) };
    }),
    by_expiry_two_sided_only: [["0-1m", 0, 60], ["1-3m", 61, 180], ["3-5m", 181, 300], ["5-10m", 301, 600], ["10-15m", 601, 9999]].map(([l, lo, hi]) => {
      const rs = twoSided.filter((r) => r.seconds_remaining >= lo && r.seconds_remaining <= hi);
      return { bucket: l, ...cond(rs) };
    }),
  };

  // Approved signals: market-level clustering check (is the anti-selectivity finding robust?)
  {
    const approved = M.filter((r) => r.approved);
    const byMkt = new Map();
    for (const r of approved) {
      if (!byMkt.has(r.market_id)) byMkt.set(r.market_id, []);
      byMkt.get(r.market_id).push(r);
    }
    const perMktAcc = [...byMkt.values()].map((rs) => rs.filter((r) => r.prediction_correct).length / rs.length);
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    const sd = (a) => Math.sqrt(a.reduce((x, y) => x + (y - mean(a)) ** 2, 0) / (a.length - 1));
    // per-market paired: approved accuracy vs same-market rejected accuracy
    const pairedDiffs = [];
    for (const [mid, rs] of byMkt) {
      const rej = M.filter((r) => r.market_id === mid && !r.approved);
      if (rej.length >= 5) {
        pairedDiffs.push(
          rs.filter((r) => r.prediction_correct).length / rs.length - rej.filter((r) => r.prediction_correct).length / rej.length
        );
      }
    }
    const tApp = mean(pairedDiffs) / (sd(pairedDiffs) / Math.sqrt(pairedDiffs.length));
    out.approved_signals_clustering = {
      approved_n: approved.length,
      distinct_markets: byMkt.size,
      market_mean_accuracy: r4(mean(perMktAcc)),
      per_market_paired_diff_vs_rejected: { n_markets: pairedDiffs.length, mean_diff: r4(mean(pairedDiffs)), t_stat: r4(tApp) },
    };
  }
}

fs.writeFileSync(path.join(__dirname, "data", "critique.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
