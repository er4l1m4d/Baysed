// Phase G — Run 002 live status reporter.
// Shows progress against RUN_002_MANIFEST.md §5 completion bar WITHOUT a
// full data dump. Fetches the gate-v2 era from the live API and summarizes.
//
// Usage: node analysis/run002_status.js
const fs = require("fs");
const path = require("path");

const API = "https://baysed.onrender.com";
const TARGET_MODELLED = 15000; // manifest §5

const r4 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 10000) / 10000);
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const median = (a) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};
function std(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)) * (a.length / (a.length - 1)));
}

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
  console.log("fetching gate-v2 era predictions...");
  const rows = (await fetchAll("/predictions")).filter((r) => r.gate_version === "v2_exec_edge");
  if (!rows.length) {
    console.log("No gate-v2 snapshots yet. Run 002 has not started recording.");
    return;
  }

  const modeled = rows.filter((r) => r.probability != null);
  const resolved = modeled.filter((r) => r.outcome_resolution && r.outcome_resolution !== "pending");
  const edges = modeled.map((r) => r.exec_edge).filter((e) => e != null);
  const sharePos = edges.filter((e) => e > 0).length / (edges.length || 1);
  const shareBand = edges.filter((e) => e > 0.02 && e < 0.15).length / (edges.length || 1);
  const shareHi = edges.filter((e) => e >= 0.15).length / (edges.length || 1);

  // Selectivity (resolved only)
  const appr = resolved.filter((r) => r.approved);
  const rej = resolved.filter((r) => !r.approved);
  const acc = (xs) => (xs.length ? mean(xs.map((r) => (r.prediction_correct ? 1 : 0))) : NaN);
  // market-level paired t
  const byMkt = new Map();
  for (const r of resolved) {
    if (!byMkt.has(r.market_id)) byMkt.set(r.market_id, { a: [], j: [] });
    byMkt.get(r.market_id)[r.approved ? "a" : "j"].push(r.prediction_correct ? 1 : 0);
  }
  const diffs = [];
  for (const { a, j } of byMkt.values()) {
    if (a.length >= 1 && j.length >= 5) diffs.push(mean(a) - mean(j));
  }
  const t = diffs.length >= 10 ? mean(diffs) / (std(diffs) / Math.sqrt(diffs.length)) : NaN;

  // Calibration gap (resolved, 10 buckets)
  const buckets = Array.from({ length: 10 }, () => ({ sp: 0, sa: 0, n: 0 }));
  for (const r of resolved) {
    const b = Math.min(9, Math.max(0, Math.floor((r.probability ?? 0) * 10)));
    buckets[b].sp += r.probability ?? 0;
    buckets[b].sa += r.prediction_correct ? 1 : 0;
    buckets[b].n++;
  }
  const gaps = buckets.map((b, i) => ({ bucket: `${i * 10}-${(i + 1) * 10}%`, gap: b.n >= 20 ? r4(b.sp / b.n - b.sa / b.n) : null, n: b.n }));

  const out = {
    generated_at: new Date().toISOString(),
    gate_v2_rows: rows.length,
    modeled: modeled.length,
    resolved_markets: resolved.length,
    progress_vs_target: `${modeled.length}/${TARGET_MODELLED} (${(modeled.length / TARGET_MODELLED * 100).toFixed(1)}%)`,
    first_recorded: rows.reduce((m, r) => (Date.parse(r.recorded_at) < Date.parse(m) ? r.recorded_at : m), rows[0].recorded_at),
    last_recorded: rows.reduce((m, r) => (Date.parse(r.recorded_at) > Date.parse(m) ? r.recorded_at : m), rows[0].recorded_at),
    exec_edge: {
      median: r4(median(edges)),
      mean: r4(mean(edges)),
      share_positive: r4(sharePos),
      share_approvable_band: r4(shareBand),
      share_above_band: r4(shareHi),
    },
    selectivity: {
      approved_acc: r4(acc(appr)),
      rejected_acc: r4(acc(rej)),
      approved_n: appr.length,
      rejected_n: rej.length,
      paired_t_stat: r4(t),
      paired_markets: diffs.length,
    },
    calibration_gaps_run002: gaps,
    verdict_readiness: {
      enough_modeled: modeled.length >= TARGET_MODELLED,
      enough_resolved: resolved.length >= 200,
      gate_neutral: !Number.isNaN(t) && Math.abs(t) < 1.5,
    },
  };

  const dir = path.join(__dirname, "data");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "run2_status.json"), JSON.stringify(out, null, 2));

  // Console
  console.log(`\n=== RUN 002 STATUS (${out.generated_at}) ===`);
  console.log(`gate-v2 rows: ${out.gate_v2_rows} | modeled: ${out.modeled} | resolved: ${out.resolved_markets}`);
  console.log(`window: ${out.first_recorded} -> ${out.last_recorded}`);
  console.log(`progress vs 15k target: ${out.progress_vs_target}`);
  console.log(`\nexec_edge: median ${out.exec_edge.median} | mean ${out.exec_edge.mean}`);
  console.log(`  share >0: ${out.exec_edge.share_positive} | in band (0.02-0.15): ${out.exec_edge.share_approvable_band} | >=0.15: ${out.exec_edge.share_above_band}`);
  console.log(`\nselectivity: approved acc ${out.selectivity.approved_acc} (n=${out.selectivity.approved_n}) | rejected acc ${out.selectivity.rejected_acc} (n=${out.selectivity.rejected_n})`);
  console.log(`  market-level paired t = ${out.selectivity.paired_t_stat} (|t|<1.5 = neutral)`);
  console.log(`\nverdict readiness: enough_modeled=${out.verdict_readiness.enough_modeled} | enough_resolved=${out.verdict_readiness.enough_resolved} | gate_neutral=${out.verdict_readiness.gate_neutral}`);
  if (!out.verdict_readiness.enough_modeled) console.log(`\nStill collecting — need ${TARGET_MODELLED - out.modeled} more modeled snapshots.`);
  else console.log(`\nTarget reached. Re-run: RUN2=1 node analysis/gate_backtest.js && RUN2=1 node analysis/model_candidates.js`);
})().catch((e) => { console.error(e); process.exit(1); });
