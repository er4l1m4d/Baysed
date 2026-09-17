# Phase F — Discovery Pass (Run 001)

**Status:** COMPLETE (discovery) · confirmation pass pending on Run 002 data
**Pool:** Run 001 resolved snapshots, `n = 22,481` (12,122 yes-won / 12,563 no-won), window 2026-09-02 → 2026-09-10
**Method:** analysis only — `analysis/phase_f_discovery.js` → `analysis/data/phase_f_discovery.json`
**Discipline:** **no production changes.** The deployed model (`distance_to_strike_v2`), gate (`v2_exec_edge`), and calibration table stay frozen. Everything below is a *hypothesis* to be pre-registered and confirmed out-of-sample on Run 002.

---

## Headline

Run 001's "model beats market" impression is a **one-sided-book composition artifact**. On **clean two-sided books the market is at least as good as the model** (model − market Brier = **−0.0026**). No hour×distance cell rescues an edge, and the sample is far less independent than its raw size suggests (effective N ≈ 2,794, not 22,481).

## F.1 — Reversal case studies

Reversals (model wrong) are a **weak-signal, early-window** phenomenon, not a random tail.

| Group | n | mean \|distance\| | mean strength (\|z\|) | mean secs remaining |
|---|---|---|---|---|
| Correct | 17,215 | 0.0967 | **2.49** | 386 |
| Reversed | 5,266 | 0.0357 | **0.51** | **602** |

Reversal rate by \|distance\| decile is **monotone** — 47.98% (weakest) → 2.36% (strongest):

| decile | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---|---|---|---|---|---|---|---|---|---|---|
| reversal rate | .480 | .431 | .351 | .300 | .256 | .185 | .148 | .096 | .072 | .024 |

**Reading:** almost every error is the model taking a small-z position early in the window. It is exactly the regime the gate's `strength ≥ 0.35` guard already removes. Accuracy by UTC hour ranges 0.673 (hour 0, worst) → 0.837 (hour 16).

## F.2 — Hour × distance (two-sided books only)

On two-sided books the **market beats the model in 16 of 24 hours** (all differences small: −0.001 to −0.014). The "worst for the model" hours — 11 (−0.0138), 21 (−0.0126), 5 (−0.0108), 0 (−0.0065) — are the same hours where model Brier is structurally high (0.17–0.20). There is **no hour×distance cell** where the model holds a meaningful two-sided edge. The Run-001 "evening pocket" does not reappear as an exploitable regime.

## F.3 — Two-sided vs one-sided (the headline)

| Book | n | model Brier | market Brier | model − market | market beats model |
|---|---|---|---|---|---|
| **Two-sided** (cross-sum 0.90–1.10) | 17,238 | 0.1537 | 0.1510 | **−0.0026** | 34.6% |
| **One-sided** (everything else) | 5,243 | 0.1414 | **0.3625** | +0.2211 | 33.4% |

The +0.22 "model edge" lives **entirely in one-sided books**, where the lone ask is not a probability at all (often near 0/1) so the market Brier is meaningless. Restrict to a genuine two-sided quote and the market matches or slightly beats the model. This is the clean quantification of the composition effect flagged in the Run 001 report and Phase C.

## F.4 / F.5 — Clustering & effective sample size

- 816 markets, 814 with ≥3 snapshots, **mean 27.6 snapshots/market**.
- Intraclass correlation (correctness) **ICC = 0.265** → **effective N ≈ 2,794**, not 22,481.

**Implication:** all Run 002 significance must be quoted at the **market level / ICC-adjusted**, or it will be overstated ~8×. The harnesses already do a market-level paired t-test for this reason.

---

## Pre-registered Run 002 sub-checks (frozen before the verdict)

These are *confirmation* tests to run against Run 002 data (Phase F-confirmation, after the Phase G verdict). They were written from Run 001 discovery and are **not** to be tuned once Run 002 results are seen.

1. **Reversal–strength monotonicity.** On Run 002, reversal rate must be monotone decreasing across model-strength deciles; lowest-decile reversal ≈ 40–50%, highest ≈ ≤5%. If this breaks, the model's regime changed and the frozen model must be re-examined.
2. **Two-sided market ≈ model.** On Run 002 two-sided clean books, `model − market Brier` must be within **±0.01**. A deviation where the model *beats* the market on clean two-sided books (e.g., ≤ −0.01 with n≥2,000) is the **only** condition that would justify investigating a tradeable edge.
3. **Hour-0 remains anomalous.** Hour-0 accuracy should stay below the run mean; validate that the gate's hour-0 exclusion is still warranted out-of-sample.
4. **No hour×distance cell as a candidate.** Any cell treated as a potential edge must show `model − market Brier ≤ −0.01` on two-sided books, `n ≥ 200`, **and** survive the temporal split. (Expect none — none exists in Run 001.)
5. **Effective-N guardrail.** The Run 002 verdict must report ICC and effective N alongside raw counts; any t-stat must be market-level.

---

## What this changes

**Nothing in production.** No model, gate, calibration, or threshold was touched. Findings are hypotheses; the sub-checks above are pre-registered so the Run 002 verdict stays honest. The confirmation pass (same script, `RUN2` data) runs only after the verdict is rendered.
