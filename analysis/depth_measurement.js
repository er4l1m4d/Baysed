// C3: Measure book depth from live Run 002 book_state data to inform the
// slippage parameter. Fetches recent predictions with include_book and
// walks the ask side for indicative order sizes.
// Usage: node analysis/depth_measurement.js
const fs = require("fs");
const path = require("path");

const API = "https://baysed.onrender.com";

async function main() {
  const res = await fetch(`${API}/predictions?limit=300&include_book=true`, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const rows = await res.json();
  const withBooks = rows.filter((r) => r.book_state && r.book_state.yes && r.book_state.no);
  console.log(`fetched ${rows.length}, two-sided with books: ${withBooks.length}`);

  const walkAsk = (levels, size) => {
    // levels: [[price, qty]...] best first
    let remaining = size, cost = 0;
    for (const [p, q] of levels) {
      const take = Math.min(remaining, parseFloat(q));
      cost += take * parseFloat(p);
      remaining -= take;
      if (remaining <= 1e-9) break;
    }
    if (remaining > 1e-9) return null; // insufficient depth
    return cost / size;
  };

  const sizes = [5, 10, 25, 50];
  const stats = {};
  for (const size of sizes) {
    const slips = [];
    for (const r of withBooks) {
      for (const side of ["yes", "no"]) {
        const book = r.book_state[side];
        if (!book || !book.asks?.length) continue;
        const best = parseFloat(book.asks[0][0]);
        const vwap = walkAsk(book.asks, size);
        if (vwap != null) slips.push(vwap - best);
      }
    }
    slips.sort((a, b) => a - b);
    if (slips.length) {
      stats[`size_${size}`] = {
        n: slips.length,
        insufficient_depth_share: r4(1 - slips.length / (withBooks.length * 2)),
        median_slip: r4(slips[Math.floor(slips.length / 2)]),
        p90_slip: r4(slips[Math.floor(slips.length * 0.9)]),
        max_slip: r4(slips[slips.length - 1]),
      };
    }
  }

  // level counts + qty at best
  const bestQty = [], levelCounts = [];
  for (const r of withBooks) {
    for (const side of ["yes", "no"]) {
      const book = r.book_state[side];
      if (!book?.asks?.length) continue;
      bestQty.push(parseFloat(book.asks[0][1]));
      levelCounts.push(book.asks.length);
    }
  }
  const q = (arr, p) => arr.sort((a, b) => a - b)[Math.floor(arr.length * p)];
  const out = {
    measured_at: new Date().toISOString(),
    sample: withBooks.length,
    ask_depth_walk: stats,
    qty_at_best_ask: { median: r4(q(bestQty, 0.5)), p10: r4(q(bestQty, 0.1)), p90: r4(q(bestQty, 0.9)) },
    ask_level_counts: { median: q(levelCounts, 0.5), max: Math.max(...levelCounts) },
    conclusion_tentative: "books are thin; slip constant 0.01 for size<=10 is plausible pending more data",
  };
  fs.writeFileSync(path.join(__dirname, "data", "depth_measurement.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}
function r4(x) { return Math.round(x * 10000) / 10000; }

main().catch((e) => { console.error(e); process.exit(1); });
