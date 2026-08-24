"use client";

import { useState, useEffect } from "react";
import { bayseWs, type BayseTicker } from "@/lib/bayse-ws";

export function useBayseTicker() {
  const [ticker, setTicker] = useState<BayseTicker | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    bayseWs.connect();
    setConnected(true);

    const unsub = bayseWs.subscribe((t) => {
      setTicker(t);
    });

    return () => {
      unsub();
    };
  }, []);

  return { ticker, connected };
}

export function usePriceHistory(maxPoints = 60) {
  const [history, setHistory] = useState<{ time: number; price: number }[]>(
    []
  );

  useEffect(() => {
    bayseWs.connect();

    const unsub = bayseWs.subscribe((t) => {
      setHistory((prev) => {
        const next = [...prev, { time: t.timestamp, price: t.price }];
        return next.slice(-maxPoints);
      });
    });

    return () => {
      unsub();
    };
  }, [maxPoints]);

  return history;
}
