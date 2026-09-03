# Pipeline Health — Daily Runbook

**Endpoint:** `https://baysed.onrender.com/pipeline-health`
**Frequency:** Once per day during Observation Run 001 (2026-09-02 → 2026-09-10)

---

## The Daily Scan

Hit the endpoint once a day. Look for exactly two things:

1. **Any `error` field that is not `null`** — one thing failed
2. **Any `mapping_errors` or `server_error_count` that is not `0`** — data integrity risk

If all three are zero/clean and both feeds show `connected: true`, close the tab. The system is collecting evidence.

---

## Red Flags (action required)

| Signal | What it means |
|---|---|
| `engine.error` not `null` | Current cycle failed — engine may be stuck |
| `engine.init_error` not `null` | Startup failure — engine is down |
| `market_feed.server_error_count` > 0 | Bayse server rejected something |
| `market_feed.mapping_errors` > 0 | Bayse sent unexpected data shape — predictions may be corrupted |
| `btc_feed.connected` = `false` | BTC feed down — no price data for model |
| `market_feed.connected` = `false` | Market feed down — no book/snapshot data |

---

## Field-by-Field Reference

### engine

| Field | Clean | Investigate |
|---|---|---|
| `started` | `true` | `false` — engine crashed |
| `cycles` | Growing (~1 per 15min when active) | Stalled — engine alive but stuck |
| `error` | `null` | Any string — current cycle failed |
| `init_error` | `null` | Any string — startup failure (fatal) |

### btc_feed

| Field | Clean | Investigate |
|---|---|---|
| `connected` | `true` | `false` — feed down |
| `connect_count` | Low single digit (<5) | >10 — reconnect storm |
| `disconnect_count` | Low (<10) | Sudden jump — upstream instability |
| `last_tick_age_ms` | <60000 (<60s) | >120000 — feed is stale |
| `last_error` | `null` | Any string — last failure reason |
| `candle_count` | Growing steadily | Stopped — feed connected but data not flowing |

### market_feed (critical)

| Field | Clean | Investigate |
|---|---|---|
| `connected` | `true` | `false` — market feed down |
| `server_error_count` | 0 | >0 — Bayse server rejected something |
| `mapping_errors` | 0 | >0 — Bayse sent unexpected data shape |
| `reconnect_count` | Low (<10) | >20 — connection instability |
| `last_message_age_ms` | <120000 (<2min) | >300000 — feed went silent |
| `subscribed_events` | ≥1 | 0 — not subscribed to anything |

### discovery

| Field | Clean | Investigate |
|---|---|---|
| `error` | `null` | Any string — API call failing |
| `events` | ≥1 | 0 — not finding markets |
| `slug` | `crypto-btc-15min` | Wrong/missing |

### live_market

| Field | Clean | Investigate |
|---|---|---|
| `active` | `true` or `false` depending on time of day | `null` fields — discovery not populating |
| `closes_at` | Valid future/past ISO timestamp | `null` when `active: true` — broken |

### predictions

| Field | Clean | Investigate |
|---|---|---|
| `total` | Growing over days | Stalled |
| `resolved` | Approaching `total` over time | 0 after several hours — resolution broken |
| `modeled` | Close to `total` | 0 — model not producing predictions |

### resolution

| Field | Clean | Investigate |
|---|---|---|
| `last_at` | Recent timestamp | `null` or stale — resolution not running |
| `has_calibration_data` | `true` after first few hours | `false` after 24h — resolution completely broken |

---

## What "clean" looks like

```json
{
  "engine": {
    "started": true,
    "cycles": 500,
    "error": null,
    "init_error": null
  },
  "btc_feed": {
    "connected": true,
    "connect_count": 2,
    "disconnect_count": 1,
    "last_tick_age_ms": 12000,
    "last_error": null,
    "candle_count": 300
  },
  "market_feed": {
    "connected": true,
    "server_error_count": 0,
    "mapping_errors": 0,
    "reconnect_count": 3,
    "last_message_age_ms": 5000,
    "subscribed_events": 1
  },
  "discovery": {
    "error": null,
    "events": 1,
    "slug": "crypto-btc-15min"
  },
  "predictions": {
    "total": 4800,
    "resolved": 4750,
    "modeled": 4800
  },
  "resolution": {
    "last_at": "2026-09-05T14:30:00Z",
    "has_calibration_data": true
  }
}
```

If your daily scan looks like this, everything is working. Don't touch anything.
