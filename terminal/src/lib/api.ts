/**
 * API client for the Bayse Bot backend.
 * REST goes directly to Render (CORS enabled).
 * WebSocket connects directly to Render because Vercel rewrites don't proxy upgrades.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "https://baysed.onrender.com";

export interface StatusResponse {
  is_running: boolean;
  mode: string;
  strategy: string;
  last_cycle_at: string | null;
  last_btc_price: number | null;
  last_momentum_pct: number | null;
  last_volatility: number | null;
  total_predictions: number;
  total_resolved: number;
  total_correct: number;
  accuracy: number | null;
  brier_mean: number | null;
  uptime_seconds: number;
  error_count: number;
  last_error: string | null;
}

export interface Prediction {
  id: number;
  market_id: string;
  event_id: string;
  title: string;
  strike_price: number;
  current_btc_price: number;
  distance_from_strike_pct: number;
  is_above_strike: boolean;
  seconds_remaining: number;
  seconds_elapsed: number;
  realized_volatility: number;
  momentum_pct: number;
  yes_ask: number | null;
  no_ask: number | null;
  spread: number | null;
  strategy: string;
  probability: number | null;
  predicted_outcome: string;
  edge: number | null;
  edge_fee: number | null;
  bayse_implied: number | null;
  signal_strength: number;
  approved: boolean;
  reasons: string[] | null;
  // Both-side edges (for research)
  yes_edge: number | null;
  yes_edge_fee: number | null;
  no_edge: number | null;
  no_edge_fee: number | null;
  model_version: string | null;
  run_id: string | null;
  // Timestamps
  observed_at: string | null;
  decided_at: string | null;
  recorded_at: string;
  // Contract timing
  opened_at: string | null;
  closes_at: string | null;
  volume_ratio: number | null;
  // Outcome IDs
  outcome1_id: string | null;
  outcome2_id: string | null;
  // Resolution
  outcome_resolution: string;
  actual_price: number | null;
  resolved_at: string | null;
  resolved_outcome_id: string | null;
  resolution_source: string | null;
  prediction_correct: boolean | null;
  brier_score: number | null;
}

export interface LiveMarketState {
  market_id: string | null;
  event_id: string | null;
  title: string | null;
  strike_price: number | null;
  btc_price: number | null;
  opens_at: string | null;
  closes_at: string | null;
  seconds_remaining: number | null;
  yes_ask: number | null;
  no_ask: number | null;
  model_probability: number | null;
  model_predicted_outcome: string | null;
  edge: number | null;
  edge_fee: number | null;
  approved: boolean;
  is_active: boolean;
}

export interface Calibration {
  total: number;
  resolved: number;
  pending: number;
  correct: number;
  accuracy: number | null;
  brier_mean: number | null;
  calibration_curve: {
    bucket: string;
    count: number;
    avg_predicted: number;
    actual_rate: number;
    gap: number;
  }[];
  total_snapshots: number;
  total_predictions: number;
  total_signals: number;
  prediction_coverage: number | null;
  signal_coverage: number | null;
  brier_model: number | null;
  brier_market: number | null;
  brier_baseline: number | null;
  edge_vs_market: number | null;
  calibration_by_expiry: {
    bucket: string;
    count: number;
    avg_predicted: number | null;
    avg_market: number | null;
    actual_rate: number | null;
    accuracy: number | null;
  }[];
}

export interface Trade {
  id: number;
  market_id: string;
  outcome: string;
  side: string;
  amount: number;
  price: number;
  shares: number | null;
  fee: number | null;
  status: string;
  mode: string;
  recorded_at: string;
  settled: boolean;
  pnl: number | null;
}

async function fetchApi<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`API error: ${res.status}`);
  }
  return res.json();
}

export async function getStatus(): Promise<StatusResponse> {
  return fetchApi<StatusResponse>("/status");
}

export async function getPredictions(
  limit = 50,
  offset = 0,
  resolution?: string
): Promise<Prediction[]> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (resolution) params.set("resolution", resolution);
  return fetchApi<Prediction[]>(`/predictions?${params}`);
}

export async function getCalibration(): Promise<Calibration> {
  return fetchApi<Calibration>("/calibration");
}

export async function getTrades(limit = 50, offset = 0): Promise<Trade[]> {
  return fetchApi<Trade[]>(`/trades?limit=${limit}&offset=${offset}`);
}

export async function getLiveMarketState(): Promise<LiveMarketState> {
  return fetchApi<LiveMarketState>("/state");
}

export function connectWebSocket(
  onPrice: (price: number, momentum: number, volatility: number) => void,
  onPrediction?: (prediction: Prediction) => void,
  onActiveMarket?: (market: LiveMarketState) => void
): () => void {
  // Vercel rewrites don't support WebSocket upgrades — connect directly to Render
  const wsUrl = "wss://baysed.onrender.com/ws";
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let shouldReconnect = true;

  function connect() {
    ws = new WebSocket(wsUrl);

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "btc_price") {
          onPrice(data.price, data.momentum, data.volatility);
        } else if (data.type === "prediction" && onPrediction) {
          onPrediction(data.data);
        } else if (data.type === "active_market" && onActiveMarket) {
          onActiveMarket(data.data);
        }
      } catch {
        // Ignore parse errors
      }
    };

    ws.onerror = () => {
      console.error("[WS] Connection error");
    };

    ws.onclose = () => {
      if (shouldReconnect) {
        console.log("[WS] Disconnected, reconnecting in 3s...");
        reconnectTimer = setTimeout(connect, 3000);
      }
    };
  }

  connect();

  return () => {
    shouldReconnect = false;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (ws) ws.close();
  };
}
