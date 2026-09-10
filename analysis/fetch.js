// Fetch all Run 001 predictions from the live API into analysis/data/
// Usage: node analysis/fetch.js
const fs = require("fs");
const path = require("path");

const API = "https://baysed.onrender.com";
const OUT_DIR = path.join(__dirname, "data");

async function getJSON(url, retries = 4) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      return await res.json();
    } catch (err) {
      if (i === retries) throw err;
      console.log(`  retry ${i + 1}/${retries} after error: ${err.message}`);
      await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
    }
  }
}

async function fetchAllPages(base) {
  const all = [];
  let offset = 0;
  for (;;) {
    const url = `${API}${base}${base.includes("?") ? "&" : "?"}limit=1000&offset=${offset}`;
    const page = await getJSON(url);
    if (!Array.isArray(page)) throw new Error(`non-array response from ${url}`);
    all.push(...page);
    console.log(`  fetched ${page.length} (total ${all.length}) from offset ${offset}`);
    if (page.length < 1000) break;
    offset += 1000;
    await new Promise((r) => setTimeout(r, 250));
  }
  return all;
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log("Fetching resolved predictions...");
  const resolved = await fetchAllPages("/predictions?resolution=resolved");
  fs.writeFileSync(path.join(OUT_DIR, "resolved.json"), JSON.stringify(resolved));
  console.log(`resolved: ${resolved.length}`);

  console.log("Fetching pending predictions...");
  const pending = await fetchAllPages("/predictions?resolution=pending");
  fs.writeFileSync(path.join(OUT_DIR, "pending.json"), JSON.stringify(pending));
  console.log(`pending: ${pending.length}`);

  console.log("Fetching /calibration (server-side cross-check)...");
  const calibration = await getJSON(`${API}/calibration`);
  fs.writeFileSync(path.join(OUT_DIR, "calibration.json"), JSON.stringify(calibration, null, 2));

  console.log("Fetching /status (server-side cross-check)...");
  let status = null;
  try {
    status = await getJSON(`${API}/status`);
  } catch (e) {
    console.log(`  /status failed: ${e.message}`);
  }
  if (status) fs.writeFileSync(path.join(OUT_DIR, "status.json"), JSON.stringify(status, null, 2));

  console.log("Fetching /pipeline-health (final vitals)...");
  const health = await getJSON(`${API}/pipeline-health`);
  fs.writeFileSync(path.join(OUT_DIR, "pipeline-health.json"), JSON.stringify(health, null, 2));

  console.log("Done. Files in analysis/data/:");
  for (const f of fs.readdirSync(OUT_DIR)) {
    const kb = Math.round(fs.statSync(path.join(OUT_DIR, f)).size / 1024);
    console.log(`  ${f} (${kb} KB)`);
  }
})();
