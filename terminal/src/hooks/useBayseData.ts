"use client";

import { useState, useEffect, useRef } from "react";
import {
  getStatus,
  getCalibration,
  getPredictions,
  getTrades,
  getLiveMarketState,
  connectWebSocket,
  type StatusResponse,
  type Calibration,
  type Prediction,
  type Trade,
  type LiveMarketState,
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

export function usePredictions(limit = 20, resolution?: string) {
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

export function useLiveMarketState() {
  const [liveMarket, setLiveMarket] = useState<LiveMarketState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function fetchLiveMarket() {
      try {
        const data = await getLiveMarketState();
        if (active) setLiveMarket(data);
      } catch (e) {
        console.error("Failed to fetch live market:", e);
      } finally {
        if (active) setLoading(false);
      }
    }

    fetchLiveMarket();
    const interval = setInterval(fetchLiveMarket, 3000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  return { liveMarket, loading };
}

type PriceSource = "live" | "polling";

export function useLivePrice() {
  const [price, setPrice] = useState<number | null>(null);
  const [momentum, setMomentum] = useState(0);
  const [volatility, setVolatility] = useState(0);
  const [connected, setConnected] = useState(false);
  const [source, setSource] = useState<PriceSource>("polling");
  const [lastUpdateAt, setLastUpdateAt] = useState<Date | null>(null);
  const [secondsSinceUpdate, setSecondsSinceUpdate] = useState(0);
  const lastPriceAtRef = useRef<Date | null>(null);

  useEffect(() => {
    let active = true;

    // Primary: REST polling (works reliably on Render free tier + Vercel)
    async function pollPrice() {
      if (!active) return;
      try {
        const status = await getStatus();
        if (active && status.last_btc_price) {
          setPrice(status.last_btc_price);
          setMomentum(status.last_momentum_pct || 0);
          setVolatility(status.last_volatility || 0);
          setConnected(true);
          setSource("polling");
          const now = new Date();
          lastPriceAtRef.current = now;
          setLastUpdateAt(now);
          setSecondsSinceUpdate(0);
        }
      } catch {
        // ignore
      }
    }

    pollPrice();
    const pollInterval = setInterval(pollPrice, 5000);

    // Check staleness every second
    const stalenessInterval = setInterval(() => {
      if (!active) return;
      if (lastPriceAtRef.current) {
        const elapsed = Math.floor((Date.now() - lastPriceAtRef.current.getTime()) / 1000);
        setSecondsSinceUpdate(elapsed);
      }
    }, 1000);

    // Try WebSocket as enhancement (if it connects, upgrade to live)
    let unsub: (() => void) | null = null;
    try {
      unsub = connectWebSocket((p, m, v) => {
        if (!active) return;
        setPrice(p);
        setMomentum(m);
        setVolatility(v);
        setConnected(true);
        setSource("live");
        const now = new Date();
        lastPriceAtRef.current = now;
        setLastUpdateAt(now);
        setSecondsSinceUpdate(0);
      });
    } catch {
      // WebSocket not available, REST polling is fine
    }

    return () => {
      active = false;
      clearInterval(pollInterval);
      clearInterval(stalenessInterval);
      if (unsub) unsub();
      setConnected(false);
      lastPriceAtRef.current = null;
    };
  }, []);

  return { price, momentum, volatility, connected, source, lastUpdateAt, secondsSinceUpdate };
}
