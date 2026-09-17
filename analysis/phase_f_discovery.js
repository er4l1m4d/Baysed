// Phase F — Discovery (research hypotheses, NOT a verdict, NOT production changes).
//
// Pool: Run 001 resolved snapshots (analysis/data/resolved.json) — a *fixed*,
// historical pool. Discoveries here are hypotheses to be pre-registered and
// confirmed out-of-sample on Run 002. The deployed model/gate/calibration
// stay frozen regardless of what this finds.
//
// Usage: node analysis/phase_f_discovery.js
// Output: analysis/data/phase_f_discovery.json + console summary
const fs = require("fs");
const path = require("path");

const all = require("./data/resolved.json");
const RUN1_START = Date.parse("2026-09-02T00:00:00Z");
const RUN1_END = Date.parse("2026-09-10T22:00:00Z");

const rows = all.filter(
  (r) =>
    Date.parse(r.recorded_at) >= RUN1_START &&
    Date.parse(r.recorded_at) < RUN1_END &&
    r.model_version === "distance_to_strike_v2" &&
    (r.outcome_resolution === "yes_won" || r.outcome_resolution === "no_won") &&
    r.probability != null
);

const actualYes = (r) => (r.outcome_resolution === "yes_won" ? 1 : 0);
const r4 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 10000) / 10000);
const mean = (a, f = (x) => x) => (a.length ? a.reduce((s, x) => s + f(x), 0) / a.length : NaN);
function deciles(arr, f) {
  const xs = arr.map(f).sort((x, y) => x - y);
  const out = [];
  for (let i = 0; i < 10; i++) {
    const lo = Math.floor((i / 10) * xs.length);
    const hi = Math.ceil(((i + 1) / 10) * xs.length);
    out.push(xs.slice(lo, hi));
  }
  return out;
}
// Bucket ROWS into n equal-count bins by key (keeps row objects for access).
function bucketRowsBy(arr, keyFn, nbuckets = 10) {
  const indexed = arr.map((r) => ({ r, key: keyFn(r) })).sort((a, b) => a.key - b.key);
  const buckets = [];
  for (let i = 0; i < nbuckets; i++) {
    const lo = Math.floor((i / nbuckets) * indexed.length);
    const hi = Math.ceil(((i + 1) / nbuckets) * indexed.length);
    buckets.push(indexed.slice(lo, hi).map((x) => x.r));
  }
  return buckets;
}
const twoSided = (r) =>
  r.yes_ask != null && r.no_ask != null && r.yes_ask + r.no_ask >= 0.9 && r.yes_ask + r.no_ask <= 1.1;
// model's z-strength (frozen model uses |d|/(vol*sqrt(t/60)))
function strength(r) {
  if (r.realized_volatility <= 0 || r.seconds_remaining <= 0) return 0;
  return Math.abs(r.distance_from_strike_pct) / (r.realized_volatility * Math.sqrt(r.seconds_remaining / 60));
}

// ---------------------------------------------------------------------------
// F.1 Reversal case studies
// ---------------------------------------------------------------------------
const correct = rows.filter((r) => r.prediction_correct);
const reversed = rows.filter((r) => !r.prediction_correct);

function profile(set) {
  return {
    n: set.length,
    reversal_rate: r4(set.filter((r) => !r.prediction_correct).length / (set.length || 1)),
    brier: set.length ? r4(mean(set, (r) => (r.probability - actualYes(r)) ** 2)) : null,
    mean_abs_distance: r4(mean(set, (r) => Math.abs(r.distance_from_strike_pct))),
    mean_vol: r4(mean(set, (r) => r.realized_volatility)),
    mean_strength: r4(mean(set, (r) => strength(r))),
    mean_secs_remaining: r4(mean(set, (r) => r.seconds_remaining)),
    share_two_sided: r4(mean(set, (r) => (twoSided(r) ? 1 : 0))),
  };
}

const byHour = {};
for (let h = 0; h < 24; h++) {
  const bh = rows.filter((r) => new Date(r.recorded_at).getUTCHours() === h);
  if (!bh.length) continue;
  byHour[h] = r4(mean(bh, (r) => (r.prediction_correct ? 1 : 0)));
}

const reversalProfiles = {
  overall: profile(rows),
  correct: profile(correct),
  reversed: profile(reversed),
  // reversal rate by distance-from-strike magnitude decile
  by_distance_decile: bucketRowsBy(rows, (r) => Math.abs(r.distance_from_strike_pct)).map(
    (chunk, i) => ({
      decile: i,
      n: chunk.length,
      reversal_rate: r4(1 - mean(chunk, (r) => (r.prediction_correct ? 1 : 0))),
      mean_strength: r4(mean(chunk, (r) => strength(r))),
    })
  ),
  by_hour: byHour,
};

// ---------------------------------------------------------------------------
// F.2 Hour x distance calibration-gap interaction
// ---------------------------------------------------------------------------
const hourDistance = [];
for (let h = 0; h < 24; h++) {
  const bh = rows.filter((r) => new Date(r.recorded_at).getUTCHours() === h);
  if (!bh.length) continue;
  hourDistance.push({
    hour: h,
    n: bh.length,
    accuracy: r4(mean(bh, (r) => (r.prediction_correct ? 1 : 0))),
    brier: r4(mean(bh, (r) => (r.probability - actualYes(r)) ** 2)),
    by_distance_decile: bucketRowsBy(bh, (r) => Math.abs(r.distance_from_strike_pct)).map(
      (chunk, i) => ({
        decile: i,
        n: chunk.length,
        model_brier: chunk.length ? r4(mean(chunk, (r) => (r.probability - actualYes(r)) ** 2)) : null,
        brier_market: chunk.length
          ? r4(mean(chunk, (r) => ((r.yes_ask != null ? r.yes_ask : 1 - (r.no_ask ?? 0.5)) - actualYes(r)) ** 2))
          : null,
        actual_rate: r4(mean(chunk, (r) => actualYes(r))),
        avg_predicted: r4(mean(chunk, (r) => r.probability)),
      })
    ),
  });
}

// ---------------------------------------------------------------------------
// F.3 Two-sided vs one-sided market-beats-model
// ---------------------------------------------------------------------------
const two = rows.filter(twoSided);
const one = rows.filter((r) => !twoSided(r));
const mk = (r) => (r.yes_ask != null ? r.yes_ask : 1 - (r.no_ask ?? 0.5));
const edge = (r) => {
  const bm = (r.probability - actualYes(r)) ** 2;
  const bM = (mk(r) - actualYes(r)) ** 2;
  return bM - bm; // >0 model better than market; <0 market better
};

// F.2b: hour x distance, TWO-SIDED ONLY (market Brier is only meaningful on a
// clean two-sided book — see F.3). Flags cells where the market beats the
// calibrated model with adequate n.
const hourDistanceTwoSided = [];
for (let h = 0; h < 24; h++) {
  const bh = two.filter((r) => new Date(r.recorded_at).getUTCHours() === h);
  if (!bh.length) continue;
  hourDistanceTwoSided.push({
    hour: h,
    n: bh.length,
    model_brier: r4(mean(bh, (r) => (r.probability - actualYes(r)) ** 2)),
    market_brier: r4(mean(bh, (r) => (mk(r) - actualYes(r)) ** 2)),
    model_minus_market: r4(mean(bh, (r) => edge(r))),
    market_beats_share: r4(mean(bh, (r) => (edge(r) < 0 ? 1 : 0))),
  });
}
const cellsWhereMarketBeats = hourDistanceTwoSided
  .filter((c) => c.n >= 200 && c.model_minus_market < 0)
  .sort((a, b) => a.model_minus_market - b.model_minus_market);

// ---------------------------------------------------------------------------
// F.4 Clustering by market (episode structure)
// ---------------------------------------------------------------------------
const byMarket = new Map();
for (const r of rows) {
  (byMarket.get(r.market_id) || byMarket.set(r.market_id, []), byMarket.get(r.market_id)).push(r);
}
const multiSnap = [...byMarket.values()].filter((v) => v.length >= 3);
const clusters = multiSnap
  .map((v) => ({
    market_id: v[0].market_id,
    n: v.length,
    avg_probability: r4(mean(v, (r) => r.probability)),
    final_correct: v[v.length - 1].prediction_correct,
    reversal_rate: r4(1 - mean(v, (r) => (r.prediction_correct ? 1 : 0))),
    avg_volatility: r4(mean(v, (r) => r.realized_volatility)),
  }))
  .sort((a, b) => b.n - a.n);

// ---------------------------------------------------------------------------
// F.5 Clustering / effective sample size (significance honesty)
// ---------------------------------------------------------------------------
const effN = (() => {
  const groups = [...byMarket.values()].map((v) => v.map((r) => (r.prediction_correct ? 1 : 0)));
  const N = groups.reduce((s, g) => s + g.length, 0);
  const k = N / groups.length;
  const grand = mean(groups.flat());
  let ssb = 0, ssw = 0;
  for (const g of groups) {
    const gm = mean(g);
    ssb += g.length * (gm - grand) ** 2;
    for (const x of g) ssw += (x - gm) ** 2;
  }
  const msb = ssb / (groups.length - 1);
  const msw = ssw / (N - groups.length);
  const icc = (msb - msw) / (msb + (k - 1) * msw);
  const neff = N / (1 + (k - 1) * Math.max(0, icc));
  return { n_obs: N, n_markets: groups.length, avg_cluster: r4(k), icc: r4(icc), effective_n: Math.round(neff) };
})();

const tsAnalysis = {
  two_sided: {
    n: two.length,
    model_brier: r4(mean(two, (r) => (r.probability - actualYes(r)) ** 2)),
    market_brier: r4(mean(two, (r) => (mk(r) - actualYes(r)) ** 2)),
    model_minus_market_brier: r4(mean(two, (r) => edge(r))),
    market_beats_model_share: r4(mean(two, (r) => (edge(r) < 0 ? 1 : 0))),
    accuracy: r4(mean(two, (r) => (r.prediction_correct ? 1 : 0))),
  },
  one_sided: {
    n: one.length,
    model_brier: r4(mean(one, (r) => (r.probability - actualYes(r)) ** 2)),
    market_brier: r4(mean(one, (r) => (mk(r) - actualYes(r)) ** 2)),
    model_minus_market_brier: r4(mean(one, (r) => edge(r))),
    market_beats_model_share: r4(mean(one, (r) => (edge(r) < 0 ? 1 : 0))),
    accuracy: r4(mean(one, (r) => (r.prediction_correct ? 1 : 0))),
  },
};

const out = {
  meta: { run: "Run 001", rows: rows.length, window: `${rows[0].recorded_at} .. ${rows[rows.length - 1].recorded_at}` },
  f1_reversals: reversalProfiles,
  f2_hour_x_distance: hourDistance,
  f2b_hour_two_sided: { by_hour: hourDistanceTwoSided, cells_where_market_beats: cellsWhereMarketBeats },
  f3_two_sided_vs_one_sided: tsAnalysis,
  f4_clustering: {
    markets_total: byMarket.size,
    markets_multi_snap: multiSnap.length,
    mean_snapshots_per_market: r4(mean([...byMarket.values()], (v) => v.length)),
    top_markets: clusters.slice(0, 20),
  },
  f5_effective_n: effN,
};

fs.writeFileSync(path.join(__dirname, "data", "phase_f_discovery.json"), JSON.stringify(out, null, 2));

console.log("=== PHASE F DISCOVERY (Run 001) ===");
console.log(`rows: ${rows.length} | correct: ${correct.length} | reversed: ${reversed.length} (reversal rate ${r4(reversed.length / rows.length)})`);
console.log("\nF.1 Reversal profiles:");
console.log("  correct:", JSON.stringify(out.f1_reversals.correct));
console.log("  reversed:", JSON.stringify(out.f1_reversals.reversed));
console.log("  by_distance_decile:", JSON.stringify(out.f1_reversals.by_distance_decile));
console.log("  reversal_rate_by_distance increases as |distance| grows? deciles below:");
out.f1_reversals.by_distance_decile.forEach((d) =>
  console.log(`    decile ${d.decile} (low |d| -> high |d|): n=${d.n} rev=${d.reversal_rate} strength=${d.mean_strength}`)
);
console.log("  by_hour (accuracy):", JSON.stringify(out.f1_reversals.by_hour));

console.log("\nF.3 two-sided vs one-sided:");
const t = out.f3_two_sided_vs_one_sided;
console.log(`  two_sided(n=${t.two_sided.n}): model_brier=${t.two_sided.model_brier} market_brier=${t.two_sided.market_brier} model-market=${t.two_sided.model_minus_market_brier} market_beats_share=${t.two_sided.market_beats_model_share} acc=${t.two_sided.accuracy}`);
console.log(`  one_sided (n=${t.one_sided.n}): model_brier=${t.one_sided.model_brier} market_brier=${t.one_sided.market_brier} model-market=${t.one_sided.model_minus_market_brier} market_beats_share=${t.one_sided.market_beats_model_share} acc=${t.one_sided.accuracy}`);

console.log("\nF.4 clustering:");
const c = out.f4_clustering;
console.log(`  markets_total=${c.markets_total} multi_snap(>=3)=${c.markets_multi_snap} mean_snap/market=${c.mean_snapshots_per_market}`);

console.log("\nF.5 effective sample size:");
console.log(`  ${JSON.stringify(out.f5_effective_n)}`);

console.log("\nF.2b two-sided by hour (model-minus-market; negative = market beats model):");
out.f2b_hour_two_sided.by_hour.forEach((h) =>
  console.log(`  h=${String(h.hour).padStart(2, "0")} n=${h.n} model_brier=${h.model_brier} market_brier=${h.market_brier} model-market=${h.model_minus_market} acc=${h.accuracy ?? "-"}`)
);
console.log(`  cells (n>=200) where market beats model: ${out.f2b_hour_two_sided.cells_where_market_beats.length}`);
console.log("  worst:", JSON.stringify(out.f2b_hour_two_sided.cells_where_market_beats.slice(0, 5)));
