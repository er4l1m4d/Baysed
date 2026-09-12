# Run 002 — Manifest & Launch Protocol

**Status:** LAUNCHED · in progress · gate v2 observation era
**Start:** first `gate_version = "v2_exec_edge"` snapshot (≈ 2026-09-12T01:52Z, the Phase C deploy). Operationally: *all* predictions with `gate_version = "v2_exec_edge"`.
**End:** when the completion criteria below are met (target ≥ 15,000 modeled gate-v2 snapshots; see §5).
**Model/strategy commit:** `a6b7109` (Phase C) · **Terminal commit:** `5d7403f` (Phase E)

---

## 1. Objective

Run 001 proved the *model* is well-calibrated (76.6% acc, Brier 0.1508, +39.7% skill)
but found **no executable edge** after fees, slippage, and adverse selection, and that the
old approval gate was anti-selective (t = −2.61). Run 002 is the **confirmatory
observation run**: with the frozen model + gate v2 recording `exec_edge` on *every*
snapshot (approvals and rejections alike), collect enough out-of-sample data to render a
final, pre-registered verdict on whether any tradeable edge exists.

This is a **measurement run, not a trading run.** The gate may approve trades; given the
Phase C/D evidence it is expected to approve ~none. Approval is not the goal — the
*distribution* of `exec_edge` is.

## 2. What is frozen (locked for Run 002)

| Component | Value | Source |
|---|---|---|
| Probability model | `distance_to_strike_v2` — `P = Φ(d / (vol·√(t/60)))` | strategy.py, unchanged since Run 001 |
| Approval gate | `v2_exec_edge` — calibrated-EV, fee/slippage-aware | bayse_bot/gate.py |
| Calibration table | Run 001 10-bucket gaps (fit 09-02..09-10) | gate.CALIBRATION_GAPS |
| Slippage floor | 0.02 (book-walk-measured; raised when book walk worse) | gate.DEFAULT_SLIP_BUFFER |
| Fee convention | `p_be = price / (1 − 0.10·max(1−price, 0.5))` | strategy.fee_adjusted_edge |
| Guardrails | two-sided book (cross-sum 0.90–1.10), strength ≥ 0.35, sec ≥ 60, **hour-0 UTC excluded**, exec-edge ∈ (0.02, 0.15) | gate.evaluate_gate |

**No model tuning, no gate-parameter changes mid-run.** Phase D established model
structure is not the bottleneck; candidates are preserved as a validated mirror
(`bayse_bot/candidate_models.py`) for *post-run* consideration only.

## 3. What is measured (every snapshot)

- `p_calibrated` — model probability after the calibration discount.
- `exec_edge` — `P_entry_cal − break_even(price) − slippage`; recorded even when rejected.
- `gate_version` — stamps the run, enabling clean filtering.
- Live surfaces: `/analytics` (exec-edge distribution, selectivity t-stat, calibration
  gap, UTC-hour & baseline-ladder cuts) and `/calibration`.

## 4. Pre-registered verdict criteria (anti p-hacking)

Run 002 is "complete" when it has ≥ 15,000 modeled gate-v2 snapshots AND ≥ 200 resolved
markets. The final verdict is rendered by re-running the existing harnesses on Run 002
data (`RUN2=1 node analysis/gate_backtest.js`, `RUN2=1 node analysis/model_candidates.js`,
`node analysis/maker_sim.js` against a fresh Run 002 fetch). Verdict logic, fixed now:

- **PRIMARY — No edge confirmed:** median `exec_edge` < 0.02 for ≥ 95% of snapshots,
  and the selectivity paired t-stat `|t| < 1.5` (gate is neutral, not anti-selective).
  → Conclusion: model is sound, **no tradeable edge exists after costs; do not trade.**
  This confirms Phase C/D out-of-sample.

- **SECONDARY — Investigate:** a material share (≥ 2%) of snapshots fall inside the
  approvable band (0.02–0.15) **and** selector `t > 1.5` (gate adds value) on the
  eval half of the run. → A specific, filterable edge may exist; drill into which
  regime (hour/volatility/book-depth) and re-validate before any capital.

- **CALIBRATION check (allowed re-fit):** recompute Run 002 bucket gaps. If they match
  Run 001 within ±0.02 per bucket, the frozen table holds. If not, **re-fit the
  calibration table** (pre-registered, does not change the model) and re-render — this
  is the one permitted mid-run adjustment because it addresses measurement, not signal.

- **ADVERSE SELECTION check:** re-run `maker_sim.js` on Run 002 activity+book data.
  If the naive +1-tick maker still shows ≥ 15-point adverse selection (hit-rate-filled
  vs hit-rate-quoted), maker execution is dead on arrival (as in Run 001).

## 5. Launch confirmation

- Engine deployed via Render, running `distance_to_strike_v2` + `v2_exec_edge`.
- `gate_version = "v2_exec_edge"` stamped on live predictions (verified 2026-09-12
  02:14–02:18; resumes after each restart's ~22-min BTC warm-up where `probability`
  is transiently null and `gate_version` is null — expected, not a regression).
- Terminal `/analytics` live (Vercel) showing the Run 002 distribution.
- Nightly backup + health-check workflows cover the run (Phase A).

## 6. How to render the verdict (one command each, post-completion)

```bash
RUN2=1 node analysis/fetch.js          # pulls gate-v2 era into analysis/data/run2.json
RUN2=1 node analysis/gate_backtest.js  # honest temporal split on Run 002
RUN2=1 node analysis/model_candidates.js
node analysis/maker_sim.js 168         # ~1 week of book+activity for the maker re-check
```

`analysis/run002_status.js` reports live progress against the §5 completion bar without
a full fetch.

## 7. Kill-switch / risk

- If the engine errors or `gate_version` stops flowing on non-warm-up rows → health-check
  alerts fire (Phase A); investigate before trusting any Run 002 subset.
- A restart injects a ~22-min warm-up gap (null-probability rows). These are excluded from
  verdict stats (they have no `exec_edge`); they do not bias the distribution.
- No live capital is at risk: the gate approves ~nothing on current evidence, and even
  approved signals are research-flagged, not auto-executed.
