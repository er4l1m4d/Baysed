"use client";

import { useState, useEffect } from "react";
import {
  getStatus,
  getCalibration,
  getPredictions,
  getTrades,
  connectWebSocket,
  type StatusResponse,
  type Calibration,
  type Prediction,
  type Trade,
} from "@/lib/api";

// Re-export Bayse WS for direct BTC price feed (fallback)
export { useBayseTicker, usePriceHistory } from "./useBayseDirect";

export function useBotStatus() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function fetchStatus() {
      try {
        const data = await getStatus();
        if (active) {
          setStatus(data);
          setError(null);
        }
      } catch (e) {
        if (active) setError(String(e));
      } finally {
        if (active) setLoading(false);
      }
    }

    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  return { status, loading, error };
}

export function useCalibration() {
  const [calibration, setCalibration] = useState<Calibration | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function fetchCalibration() {
      try {
        const data = await getCalibration();
        if (active) setCalibration(data);
      } catch (e) {
        console.error("Failed to fetch calibration:", e);
      } finally {
        if (active) setLoading(false);
      }
    }

    fetchCalibration();
    const interval = setInterval(fetchCalibration, 30000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  return { calibration, loading };
}

export function usePredictions(limit = 50, resolution?: string) {
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function fetchPredictions() {
      try {
        const data = await getPredictions(limit, 0, resolution);
        if (active) setPredictions(data);
      } catch (e) {
        console.error("Failed to fetch predictions:", e);
      } finally {
        if (active) setLoading(false);
      }
    }

    fetchPredictions();
    const interval = setInterval(fetchPredictions, 10000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [limit, resolution]);

  return { predictions, loading };
}

export function useTrades(limit = 50) {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function fetchTrades() {
      try {
        const data = await getTrades(limit);
        if (active) setTrades(data);
      } catch (e) {
        console.error("Failed to fetch trades:", e);
      } finally {
        if (active) setLoading(false);
      }
    }

    fetchTrades();
    const interval = setInterval(fetchTrades, 10000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [limit]);

  return { trades, loading };
}

export function useLivePrice() {
  const [price, setPrice] = useState<number | null>(null);
  const [momentum, setMomentum] = useState(0);
  const [volatility, setVolatility] = useState(0);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    setConnected(true);

    const unsub = connectWebSocket((p, m, v) => {
      setPrice(p);
      setMomentum(m);
      setVolatility(v);
    });

    return () => {
      unsub();
      setConnected(false);
    };
  }, []);

  return { price, momentum, volatility, connected };
}
