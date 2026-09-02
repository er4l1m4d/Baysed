# Baysed Terminal

Read-only research terminal for the Baysed prediction engine — observation
data, live market state, calibration analytics, and pipeline health.

## Setup

```bash
cd terminal
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Pages

- **Overview** — KPI cards, Brier trend, live market, snapshot feed, resolution feed
- **Predictions** — Full snapshot history with expandable detail
- **Live Market** — The currently open 15-minute BTC contract in detail
- **Calibration** — Calibration curve, Brier vs market/baseline, coverage
- **Resolution** — Every snapshot scored against Bayse's canonical outcome
- **Settings** — Engine config, pipeline-health diagnostics

## Architecture

- **Next.js 16** (App Router, Tailwind CSS v4) — no component or chart libraries
- **Backend required**: REST polls the Baysed API (`NEXT_PUBLIC_API_URL`,
  defaults to the Render deployment) for status, state, predictions and
  calibration
- **Live price**: WebSocket direct to the Render backend (`/ws`), with an
  automatic REST-polling fallback after 8s of silence — the connection
  source (`live` / `polling`) and staleness are tracked and displayed

## Configuration

`NEXT_PUBLIC_API_URL` in `.env.local` — point it at your backend
(e.g. `https://baysed.onrender.com`).
