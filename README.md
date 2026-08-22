# Bayse BTC 15-minute research bot

This is a fail-closed research system for NGN-denominated, CLOB-backed BTC binary markets on Bayse. It makes no claim of profitability. Baseline thresholds are unvalidated starting values; do not tune them on the same sample used to claim results.

## Safety model

`observation` (default) discovers and evaluates only. `paper` requires an executable CLOB book and complete fresh quote, then records a conservative simulated trade; it never calls the Bayse order endpoint. `live` additionally requires both API keys and uses signed requests. It is never automatically promoted from paper.

Every candidate, rejection, failure, book, signal, quote and trade attempt is append-only JSONL under `runs/YYYY-MM-DD/<mode>/data`. Paper and live data are separate. State is persisted in `STATE_PATH` to preserve an active/uncertain market, loss streak and cooldown after restart.

The initial `MIN_ENTRY_LIQUIDITY_NGN=300` is intentionally three times the NGN 100 position size: a small, explicit cushion for entry plus a protected exit. It is not evidence that this depth is adequate and must be reviewed against real books.

## Install and verify

```powershell
cd C:\Users\Ifedayo\OneDrive\Documents\Bayse\bayse-btc-bot
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
pytest -q
python -m compileall bayse_bot
python -m bayse_bot --health
```

## Run and report

Copy `.env.example` to `.env` and set non-secret experiment settings in your shell. Do not commit `.env`.

```powershell
$env:BOT_RUN_MODE='observation'; python -m bayse_bot
$env:BOT_RUN_MODE='paper'; python -m bayse_bot
python -m bayse_bot --report runs\2026-08-21\paper
docker build -t bayse-btc-bot .
railway up
```

Railway is configured as a worker. Its local filesystem is ephemeral, so real live reliability requires a durable append-only store and transactional risk-state store (for example, managed Postgres/object storage) before enabling live mode. Use the `--health` command for a no-order health probe.

## Bayse integration notes

The integration follows the official [authentication](https://docs.bayse.markets/authentication), [trading flow](https://docs.bayse.markets/concepts/trading-flow), [order lifecycle](https://docs.bayse.markets/concepts/order-lifecycle), [market data](https://docs.bayse.markets/concepts/market-data), and [fees](https://docs.bayse.markets/concepts/fees) pages: `X-Public-Key` reads; signed writes with deterministic raw bytes; CLOB FOK protection; and fee-aware shares/proceeds. Responses whose precise nesting is not published in those pages are rejected by typed adapters and marked for account/docs verification rather than guessed.

Before any live use, verify with Bayse: exact CLOB book response nesting and per-outcome selection, the precise CLOB order schema accepted for FOK/limit fields, quote authentication requirements, event timestamps/resolution metadata field names, and documented WebSocket/reconciliation response shapes. The bot never invents these values.

No private keys belong in source, fixtures, logs, Markdown, Docker images, or git.

This is Jigz' Version.
