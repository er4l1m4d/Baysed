# Baysed — Bayse BTC 15-minute research engine

Baysed is a fail-closed quantitative research engine for **USD-denominated**,
CLOB-backed BTC binary markets on [Bayse Markets](https://bayse.markets)
(15-minute contracts, resolution from Binance). It makes no claim of
profitability. Baseline thresholds are unvalidated starting values; do not
tune them on the same sample used to claim results.

The engine is currently running **Observation Run 001**: the model
(`distance_to_strike_v2`) and data schema are frozen, no orders are placed,
and every scan cycle records prediction snapshots that resolve against
Bayse's canonical outcome for calibration analysis.

## Safety model

`observation` (default) discovers and evaluates only. `paper` requires an
executable CLOB book and complete fresh quote, then records a conservative
simulated trade; it never calls the Bayse order endpoint. `live`
additionally requires both API keys and uses signed requests. It is never
automatically promoted from paper.

Every candidate, rejection, failure, book, signal, quote and trade attempt is
append-only JSONL under `runs/YYYY-MM-DD/<mode>/data`. Paper and live data
are separate. State is persisted in `STATE_PATH` to preserve an
active/uncertain market, loss streak and cooldown after restart.

## Architecture

```
Binance BTC WS feed ──┐
Bayse market WS ──────┤→ engine cycle → snapshot → prediction → Neon Postgres
Bayse REST (discovery)┘                                                ↓
                                                          canonical resolution (Bayse API)
                                                                       ↓
                                              FastAPI (Render) ← calibration analytics
                                                       ↓
                                        Next.js terminal (Vercel) — read-only
```

- **Engine**: Python 3.12, deployed on Render (worker)
- **Database**: Neon Postgres
- **API**: FastAPI on Render — `/status`, `/state`, `/predictions`,
  `/calibration`, `/pipeline-health`, `/debug/*`
- **Terminal**: Next.js App Router on Vercel, connects to the Render API
  (REST polling + WebSocket for live BTC price)

Key operational details:

- Bayse API keys (`BAYSE_PUBLIC_KEY`, `BAYSE_SECRET_KEY`) live in the Render
  environment, never in source.
- `SERIES_SLUG` must be `crypto-btc-15min` — discovery is bounded to the
  current series event via the lean-events endpoint.
- Market WS (`socket.bayse.markets`) pings every ~54s and closes at 60s
  no-pong; the client disables its own ping and uses a 70s recv timeout.
- Feed health (connect/disconnect/reconnect counts, message ages,
  mapping errors) is self-reported and exposed via `/pipeline-health`.

## Install and verify

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
pytest -q
python -m compileall bayse_bot
python -m bayse_bot --health
```

## Run

Copy `.env.example` to `.env` and set non-secret experiment settings in your
shell. Do not commit `.env`.

```powershell
$env:BOT_RUN_MODE='observation'; python -m bayse_bot
$env:BOT_RUN_MODE='paper'; python -m bayse_bot
python -m bayse_bot --report runs\2026-08-21\paper
```

Production deploys via Render (engine + API) and Vercel (terminal); see the
service dashboards. The local Dockerfile remains available for containerized
runs.

## Bayse integration notes

The integration follows the official [authentication](https://docs.bayse.markets/authentication),
[trading flow](https://docs.bayse.markets/concepts/trading-flow),
[order lifecycle](https://docs.bayse.markets/concepts/order-lifecycle),
[market data](https://docs.bayse.markets/concepts/market-data), and
[fees](https://docs.bayse.markets/concepts/fees) pages: `X-Public-Key`
reads; signed writes with deterministic raw bytes; CLOB FOK protection; and
fee-aware shares/proceeds. Responses whose precise nesting is not published
in those pages are rejected by typed adapters and marked for account/docs
verification rather than guessed.

No private keys belong in source, fixtures, logs, Markdown, Docker images,
or git.
