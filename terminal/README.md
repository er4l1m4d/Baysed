# Bayse Terminal

Real-time trading terminal for Bayse prediction markets.

## Setup

```bash
cd terminal
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Pages

- **Dashboard** — Live BTC price, active markets, stats
- **Analytics** — Calibration curves, Brier score, edge decay
- **Predictions** — Full prediction history with resolution
- **Trading** — Order placement, positions, market info

## Architecture

- **Next.js 16** with App Router and Tailwind CSS
- **Direct Bayse WebSocket** — connects to `wss://socket.bayse.markets` for live BTC prices
- **No backend required** — pure frontend app

## Configuration

The WebSocket URL can be configured in `src/lib/bayse-ws.ts`.
