# PRODUCT.md — Baysed Terminal

## What this is

Baysed Terminal is the research dashboard for Baysed, a quantitative prediction engine
that trades Bayse Markets' 15-minute BTC binary contracts. The terminal is read-only:
it surfaces what the bot observes, predicts, and how those predictions resolve —
so the operator can judge model calibration quality at a glance.

## Who uses it

A single operator (the researcher running the bot) monitoring Observation Run 001
from a desktop browser, often glancing at it between other work. Ambient light:
dim room, long sessions. Dark theme is functional, not stylistic.

## Platform

Web (Next.js App Router, Tailwind v4, no component library, no chart library).

## Register

Product. Design serves the task: monitoring a live prediction pipeline. Familiarity
is a feature — the tool disappears into the task. Full visual spec: `GLM_UI_SPEC.md`.

## Core surfaces

| Route | Purpose |
|---|---|
| `/` Overview | Pipeline health at a glance: KPIs, Brier trend, live market, snapshot feed |
| `/predictions` | Full prediction snapshot table with expandable detail |
| `/live-market` | The currently open 15-minute BTC contract in detail |
| `/calibration` | Calibration curve + Brier comparison vs market/baseline |
| `/resolution` | How predictions resolved (correct/wrong, Brier per snapshot) |
| `/settings` | Bot mode, strategy, uptime, model version, run id |

## Data

Read-only REST polling against `https://baysed.onrender.com` (`/status`, `/state`,
`/calibration`, `/predictions`, `/trades`) plus a direct WebSocket (`/ws`) for live
BTC price. All state is observation data — no trade execution from the UI.

## Identity

- Name: **Baysed**
- Accent: gold `#F59E0B` on zinc-950 dark surfaces (Bloomberg-research-terminal feel)
- Positive: emerald `#10B981`, negative: rose `#F43F5E`
- Font: Inter, one family, fixed rem scale
- Flats, 12px card radius, 1px zinc-800 borders, no shadows

## Non-goals

- No trading controls, no order placement, no auth screens
- No decorative motion; 150–250ms state transitions only
- Not optimized for mobile-first; responsive down to tablet, functional on mobile
