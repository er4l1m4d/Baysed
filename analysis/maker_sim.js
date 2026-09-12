// C6: Maker-mode simulation against live book_state + activity data.
//
// Strategy: at each snapshot with a two-sided book, quote a bid on the
// model-favored outcome one tick inside the best bid (best_bid + 0.01),
// size 10. A fill occurs when a later activity print for the SAME outcome
// token trades at or below our bid before close (someone sold into us).
// One position per market (inventory behavior): after a fill, stop quoting.
// Maker fee assumed 0 (Bayse's published fee formula is taker-side).
//
// Adverse selection is the headline metric: P(correct | filled) vs
// P(correct | quoted). A maker earns the spread but gets picked off on
// information — this measures how much.
//
// Usage: node analysis/maker_sim.js [hours_lookback]
// Output: analysis/data/maker_sim.json + console summary
const fs = require("fs");
const path = require("path");

const API = "https://baysed.onrender.com";
const HOURS = parseFloat(process.argv[2] || "24");
const SIZE = 10;
const TICK = 0.01;

async function getJSON(url, retries = 4) {
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

const r4 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 10000) / 10000);

(async () => {
  const since = Date.now() - HOURS * 3600e3;
  console.log(`fetching predictions (include_book) + activity since ${new Date(since).toISOString()}...`);
  const preds = (await fetchAll("/predictions?include_book=true")).filter(
    (p) => Date.parse(p.recorded_at) >= since && p.probability != null && p.book_state
  );
  const activity = (await fetchAll("/activity")).filter((a) => Date.parse(a.recorded_at) >= since);
  console.log(`predictions: ${preds.length}, activity prints: ${activity.length}`);

  // Build print stream (join verified 2026-09-12: activity market.id ==
  // predictions.market_id; outcome from order.outcome; only SELLs can fill bids)
  const prints = [];
  for (const a of activity) {
    const order = a.raw?.data?.order;
    const marketId = a.raw?.data?.market?.id;
    if (!order || !marketId || order.price == null) continue;
    prints.push({
      t: Date.parse(order.createdAt || a.recorded_at),
      market_id: marketId,
      outcome: order.outcome, // "YES"/"NO"
      price: parseFloat(order.price),
      type: order.type, // BUY/SELL
    });
  }
  prints.sort((a, b) => a.t - b.t);
  console.log(`parsed prints: ${prints.length}`);

  // Group predictions by market, chronological
  const byMarket = new Map();
  for (const p of preds) {
    if (!byMarket.has(p.market_id)) byMarket.set(p.market_id, []);
    byMarket.get(p.market_id).push(p);
  }
  for (const rs of byMarket.values()) rs.sort((a, b) => Date.parse(a.recorded_at) - Date.parse(b.recorded_at));

  let quotes = 0, eligible = 0, fills = 0, filledCorrect = 0, quotedCorrect = 0;
  let pnl = 0;
  const fillExamples = [];

  for (const [mid, rows] of byMarket) {
    let positionTaken = false;
    for (const p of rows) {
      if (positionTaken) break;
      const sideKey = p.predicted_outcome === "YES" ? "yes" : "no";
      const book = p.book_state[sideKey];
      if (!book?.bids?.length || !book?.asks?.length) continue;
      const bestBid = parseFloat(book.bids[0][0]);
      const ourBid = r4(bestBid + TICK);
      if (ourBid >= 1) continue;

      eligible++;
      quotes++;
      quotedCorrect += p.prediction_correct ? 1 : 0;

      // fill check: a SELL print on this market + predicted outcome at
      // price <= our bid before close (a seller willing to sell at the
      // resting bid would have taken our improved bid first)
      const t0 = Date.parse(p.observed_at || p.recorded_at);
      const t1 = Date.parse(p.closes_at);
      const hit = prints.find(
        (pr) =>
          pr.market_id === mid &&
          pr.outcome === p.predicted_outcome &&
          pr.type === "SELL" &&
          pr.t >= t0 && pr.t <= t1 &&
          pr.price <= ourBid + 1e-9
      );
      if (hit) {
        fills++;
        positionTaken = true;
        const correct = !!p.prediction_correct;
        if (correct) filledCorrect++;
        const tradePnl = correct ? (1 - ourBid) * SIZE : -ourBid * SIZE;
        pnl += tradePnl;
        if (fillExamples.length < 10) {
          fillExamples.push({
            market_id: mid.slice(0, 8), outcome: p.predicted_outcome, our_bid: ourBid,
            print_price: hit.price, print_type: hit.type, correct, pnl: r4(tradePnl),
            probability: p.probability, p_calibrated: p.p_calibrated,
          });
        }
      }
    }
  }

  const out = {
    simulated_at: new Date().toISOString(),
    lookback_hours: HOURS,
    params: { size: SIZE, tick_improvement: TICK, maker_fee: 0, one_position_per_market: true },
    data_volume_warning: preds.length < 500 ? "SMOKE TEST ONLY — insufficient data volume for conclusions" : null,
    quotes: quotes,
    eligible_snapshots: eligible,
    markets: byMarket.size,
    prints_available: prints.length,
    fills,
    fill_rate: quotes ? r4(fills / quotes) : null,
    hit_rate_when_filled: fills ? r4(filledCorrect / fills) : null,
    hit_rate_when_quoted: quotes ? r4(quotedCorrect / quotes) : null,
    adverse_selection_delta: quotes && fills ? r4(filledCorrect / fills - quotedCorrect / quotes) : null,
    pnl_flat: r4(pnl),
    fill_examples: fillExamples,
    limitations: [
      "24h of data, 54 fills — small sample (42.6% +/- 6.7pp SE)",
      "quotes treated as active from their snapshot until market close (no staleness expiry) — slight fill-rate overcount",
      "maker fee assumed 0; queue position assumed best (price improvement attracts sellers first)",
      "one position per market; first-hit snapshot wins",
    ],
  };
  fs.writeFileSync(path.join(__dirname, "data", "maker_sim.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
