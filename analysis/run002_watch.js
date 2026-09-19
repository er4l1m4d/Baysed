// run002_watch.js — passive readiness watcher for the 15k bar.
//
// Why: Run 002 hit a quota wall — the Baysed Neon project burned its free
// 100 CU-hour monthly allowance, which makes the live engine throw 500 on
// /pipeline-health and /predictions. No engine/code change fixes that; it
// recovers automatically at the next monthly free-tier reset (or when you
// upgrade the Neon project), which the owner can do from the Neon console.
//
// This script waits cheaply: it polls /pipeline-health until it returns 200,
// then runs `node analysis/run002_status.js` to (a) confirm the engine is
// healthy and (b) recheck the >=15,000 modeled bar, then exits. Output goes
// to analysis/run002_watch.log so it can be tailed without a live shell.
//
// Relaunch / stop:
//   relaunch: node analysis/run002_watch.js > analysis/run002_watch.log 2>&1 &
//   stop:     kill <pid>   (or delete analysis/run002_watch.log to reset)

const https = require('https');
const { execSync, spawn } = require('node:child_process');
const fs = require('node:fs');

const LOG = 'analysis/run002_watch.log';
const INTERVAL_SECONDS = 120; // poll every 2 min — light, prompt on recovery

function log(msg) {
  const line = `[${new Date().toISOString().replace('T', ' ').slice(0, 19)}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG, line + '\n'); } catch (_) {}
}

function once() {
  return new Promise((resolve) => {
    log('probe: /pipeline-health ...');
    const req = https.get('https://baysed.onrender.com/pipeline-health', { timeout: 20000 }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        const status = res.statusCode;
        const snippet = (body || '').slice(0, 120).replace(/\s+/g, ' ');
        log(`probe: HTTP ${status} ${snippet}`);
        resolve(status === 200);
      });
    });
    req.on('error', (e) => { log(`probe: ${e.message.slice(0, 80)}`); resolve(false); });
    req.on('timeout', () => { log('probe: timeout'); req.destroy(); resolve(false); });
  });
}

async function runStatus() {
  log('--- engine healthy; running Run 002 readiness check ---');
  try {
    const out = execSync('node analysis/run002_status.js', {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 600000,
    }).toString();
    log(out.split('\n').slice(-24).join('\n'));
    const modeledMatch = out.match(/gate-v2 rows:\s*\d+\s*\|\s*modeled:\s*(\d+)/);
    const enoughMatch = out.match(/verdict readiness:\s*enough_modeled=(true|false)/);
    const modeled = modeledMatch ? parseInt(modeledMatch[1], 10) : null;
    const enough = enoughMatch ? enoughMatch[1] === 'true' : false;
    log(`readiness: modeled=${modeled ?? '?'} / 15000 | enough_modeled=${enough}`);
    if (enough) {
      log('*** >=15,000 modeled snapshots reached. Run 002 is COMPLETE by the frozen bar. ***');
      log('*** Next: RUN2=1 node analysis/fetch.js && RUN2=1 node analysis/gate_backtest.js && RUN2=1 node analysis/model_candidates.js ***');
    } else {
      log(`not yet at threshold (${modeled ?? '?'} < 15000). Continuing to poll.`);
    }
  } catch (e) {
    log(`status run failed: ${e.message}`);
  }
}

(async () => {
  log(`run002_watch started — polling /pipeline-health every ${INTERVAL_SECONDS}s until healthy, then rechecks the 15k bar.`);
  await once();
  while (true) {
    await new Promise((r) => setTimeout(r, INTERVAL_SECONDS * 1000));
    const healthy = await once();
    if (healthy) {
      await runStatus();
      log('Done. Exiting watcher.');
      process.exit(0);
    }
  }
})();
