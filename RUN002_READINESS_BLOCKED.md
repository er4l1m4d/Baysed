# Run 002 Readiness — Blocker & Recovery Plan

**Status:** BLOCKED on infra (not a code/data bug)
**Date:** 2026-09-19
**Last confirmed good Run 002 figure (live, pre-outage):** 13,696 modeled / 15,000 target (91.3%) — `enough_modeled=false`

---

## Root cause of the current HTTP 500

From the Baysed Neon console (the project owner, you, received this directly):

> Your project **Baysed** has used **100% of its 100 CU-hour monthly compute
> allowance**. Apps for this project may fail to connect. Operations like
> inserts, updates, and queries will error until your allowance resets next
> month — or you can upgrade to the Neon Launch Plan to get back online
> immediately.

Translation: Postgres on the free tier is rejecting reads/writes, so the
live engine returns **HTTP 500** on `/pipeline-health` and `/predictions`.

This is **not** a deployment or engine-code bug. No change I make to this
repo will clear it. Two recovery paths exist, both Neon-side:

1. **Upgrade the Baysed Neon project to the Launch Plan** → allowance lifts
   immediately; engine recovers within minutes.
2. **Wait for the free-tier monthly reset** (next month; no payment needed)
   → engine recovers automatically at reset.

---

## Why the project must NOT be touched while down

During Phase F we made a deliberately frozen, no-deploy decision: the live
model (`distance_to_strike_v2`), gate (`v2_exec_edge`), and calibration
table stay frozen; Run 002 is accruing untouched as a clean confirmation
sample. Any deploy now (to work around the 500) would risk contaminating
that clean confirmation window. So: **do not deploy; do not change the
model/gate/calibration. Only restore Neon.**

---

## Discipline reminder — the 15k bar is pre-registered, do not fudge it

Phase F pre-registered the 15k bar in `PHASE_F_DISCOVERY.md` precisely so
we don't declare "complete" at 91.3% just because the read looks clean.
The verdict must wait until `modeled >= 15000` **and** the engine is
healthy enough to fetch the real Run 002 data. I will not guess the number.

---

## What happens when Neon is back

Once you confirm the Baysed Neon project is restored, I run **in order**,
one shot:

1. **Confirm recovery**
   ```
   curl -s https://baysed.onrender.com/pipeline-health   # expect HTTP 200 + JSON
   ```

2. **Recheck the bar**
   ```
   cd "C:\Users\hp\Documents\my builds\Baysed"
   node analysis\run002_status.js
   ```
   - If `verdict readiness: enough_modeled=true` → proceed.
   - If still < 15,000 → let it accrue a little more (accrues ~2,600/day
     at current rate) and re-check.

3. **Pull Run 002 data fresh**
   ```
   RUN2=1 node analysis\fetch.js
   ```

4. **Run the verdict harnesses on Run 002**
   ```
   RUN2=1 node analysis\gate_backtest.js
   RUN2=1 node analysis\model_candidates.js
   ```

5. **Phase G verdict write-up** against the pre-registered criteria:
   - PRIMARY no-edge (median exec_edge < 0.02 for >=95% of snapshots,
     gate paired |t| < 1.5)
   - SECONDARY checks (exec_band <=4%, selector |t|<1.5, calibrated
     exec-edge vs model-only exec-edge, one-sided vs two-sided)
   - Calibration table re-fit comparison (Run 001 vs Run 002)

6. **Phase F confirmation** on Run 002 — re-run `phase_f_discovery.js`
   to test the 5 pre-registered sub-checks out-of-sample:
   1. reversal–strength monotonicity (48% → <=5% across deciles)
   2. two-sided `model - market Brier` within +/-0.01 (only a model win
      on clean two-sided books justifies investigating an edge)
   3. hour-0 accuracy anomaly persists
   4. no hour x distance cell qualifies (two-sided, n>=200, survives
      temporal split)
   5. effective-N guardrail honored on all verdict stats (~2,794
      effective obs in Run 001)

All artifacts land in `analysis/data/` (prefixed `run2_*`) and are
committed + reported to you; nothing is pushed/deployed as part of this
analysis-only phase.

---

## Quick reference — commands to run (copy/paste)

```bat
cd "C:\Users\hp\Documents\my builds\Baysed"

:: 1) confirm recovery
curl -s https://baysed.onrender.com/pipeline-health

:: 2) recheck bar
node analysis\run002_status.js

:: 3) pull Run 002 data
RUN2=1 node analysis\fetch.js

:: 4) verdict harnesses
RUN2=1 node analysis\gate_backtest.js
RUN2=1 node analysis\model_candidates.js

:: 5) Phase F confirmation on Run 002 (optional)
node analysis\phase_f_discovery.js
```

---

## Files that document the whole plan (commit anchors)

- `PHASE_F_DISCOVERY.md` — Phase F discovery hypotheses + the 5
  pre-registered Run 002 sub-checks (commit a49af91)
- `MANIFEST.md` — the frozen Run 002 bar (15,000 modeled / 200 resolved),
  verdict criteria, and Phase G structure (commit 4324399 / 7d5147a)
- `analysis/run002_status.js` — prints the `verdict readiness` line
- `analysis/gate_backtest.js` — PRIMARY + SECONDARY criteria eval
- `analysis/model_candidates.js` — exec_edge band + strength/reversal
  summary (the model_only v exec model_only exec-edge v gate_exec check)
- `analysis/phase_f_discovery.js` — Phase F confirmation pass

---

## Summary to tell yourself later

- We are waiting on **Neon free-tier quota**, not code.
- **13,696/15,000** at last healthy read; gate already neutral
  (paired t = -0.39), exec_edge median -0.092, only ~6% in band.
- Do **not** deploy to "fix" the 500 — it would break the clean
  confirmation window.
- The second Neon is healthy, run the 6-step sequence above; Phase G
  verdict + Phase F confirmation follow in the same pass.
