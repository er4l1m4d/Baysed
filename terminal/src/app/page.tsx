"use client";

import { useState, useEffect } from "react";
import { useBotStatus, useCalibration, useLivePrice, useLiveMarketState, usePredictions, useTrades } from "@/hooks/useBayseData";

function PriceCard() {
  const { price, momentum, volatility, connected, source, lastUpdateAt, secondsSinceUpdate } = useLivePrice();
  const { status } = useBotStatus();

  const displayPrice = price || status?.last_btc_price;

  const sourceConfig = {
    live: {
      label: "LIVE",
      sublabel: "Bayse WS",
      color: "bg-emerald-900 text-emerald-400",
      dotColor: "bg-emerald-400 animate-pulse",
    },
    polling: {
      label: "API",
      sublabel: `Updated ${secondsSinceUpdate}s ago`,
      color: "bg-blue-900 text-blue-400",
      dotColor: "bg-blue-400",
    },
    fallback: {
      label: "CONNECTING",
      sublabel: "Waiting for data",
      color: "bg-yellow-900 text-yellow-400",
      dotColor: "bg-yellow-400 animate-pulse",
    },
  };

  const config = sourceConfig[source];

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-gray-400">BTC/USD</span>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${config.dotColor}`} />
            <span className={`text-xs px-2 py-0.5 rounded ${config.color}`}>
              {config.label}
            </span>
          </div>
          <span className="text-xs text-gray-600">{config.sublabel}</span>
          {status?.is_running && (
            <span className="text-xs px-2 py-0.5 rounded bg-blue-900 text-blue-400">
              Bot Running
            </span>
          )}
        </div>
      </div>
      <div className="text-4xl font-bold text-white">
        {displayPrice
          ? `$${displayPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          : "Loading..."}
      </div>
      <div className="flex gap-4 mt-2 text-xs text-gray-500">
        <span>Momentum: {(momentum || status?.last_momentum_pct || 0).toFixed(4)}%</span>
        <span>Vol: {(volatility || status?.last_volatility || 0).toFixed(2)}%</span>
      </div>
    </div>
  );
}

function StatsRow() {
  const { calibration, loading } = useCalibration();

  if (loading) {
    return (
      <div className="grid grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-gray-900 border border-gray-800 rounded-lg p-4 animate-pulse">
            <div className="h-4 bg-gray-800 rounded w-20 mb-2" />
            <div className="h-8 bg-gray-800 rounded w-16" />
          </div>
        ))}
      </div>
    );
  }

  const stats = [
    {
      label: "Snapshots",
      value: String(calibration?.total_snapshots || 0),
      color: "text-white",
    },
    {
      label: "Predictions",
      value: calibration?.prediction_coverage != null
        ? `${calibration.total_predictions} (${(calibration.prediction_coverage * 100).toFixed(0)}%)`
        : String(calibration?.total_predictions || 0),
      color: "text-blue-400",
    },
    {
      label: "Signals",
      value: calibration?.signal_coverage != null
        ? `${calibration.total_signals} (${(calibration.signal_coverage * 100).toFixed(0)}%)`
        : String(calibration?.total_signals || 0),
      color: "text-emerald-400",
    },
    {
      label: "Resolved",
      value: calibration?.resolved ? `${calibration.resolved} (${(calibration.accuracy || 0) * 100}%)` : "0",
      color: "text-yellow-400",
    },
  ];

  return (
    <div className="grid grid-cols-4 gap-4">
      {stats.map((stat) => (
        <div key={stat.label} className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div className="text-xs text-gray-500 mb-1">{stat.label}</div>
          <div className={`text-2xl font-bold ${stat.color}`}>{stat.value}</div>
        </div>
      ))}
    </div>
  );
}

function LiveMarketCard() {
  const { liveMarket, loading } = useLiveMarketState();
  const [countdown, setCountdown] = useState<number | null>(null);

  // Live countdown: update every second from closes_at
  useEffect(() => {
    if (!liveMarket?.closes_at || !liveMarket.is_active) {
      setCountdown(null);
      return;
    }

    const closesAt = new Date(liveMarket.closes_at);

    function updateCountdown() {
      const now = new Date();
      const remaining = Math.max(0, Math.floor((closesAt.getTime() - now.getTime()) / 1000));
      setCountdown(remaining);
    }

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [liveMarket?.closes_at, liveMarket?.is_active]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  if (loading) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 animate-pulse">
        <div className="h-6 bg-gray-800 rounded w-40 mb-4" />
        <div className="grid grid-cols-3 gap-4">
          <div className="h-16 bg-gray-800 rounded" />
          <div className="h-16 bg-gray-800 rounded" />
          <div className="h-16 bg-gray-800 rounded" />
        </div>
      </div>
    );
  }

  if (!liveMarket || !liveMarket.is_active) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Live Market</h2>
          <span className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-500">No active market</span>
        </div>
        <div className="text-gray-500 text-sm">Waiting for market to open...</div>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 border border-blue-800 rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Live Market</h2>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs px-2 py-0.5 rounded bg-emerald-900 text-emerald-400">LIVE</span>
        </div>
      </div>

      <div className="text-sm text-gray-400 mb-3">{liveMarket.title}</div>

      <div className="grid grid-cols-3 gap-4 mb-4">
        <div>
          <div className="text-xs text-gray-500">Strike</div>
          <div className="text-lg font-mono text-white">
            ${liveMarket.strike_price?.toLocaleString() || "--"}
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Time Left</div>
          <div className={`text-lg font-mono ${countdown !== null && countdown < 120 ? "text-yellow-400" : "text-white"}`}>
            {countdown !== null ? formatTime(countdown) : "--"}
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Signal</div>
          <div className={`text-lg font-bold ${
            !liveMarket.model_predicted_outcome ? "text-gray-500" :
            liveMarket.approved ? (
              liveMarket.model_predicted_outcome === "YES" ? "text-emerald-400" : "text-red-400"
            ) : "text-yellow-400"
          }`}>
            {!liveMarket.model_predicted_outcome ? "--" :
             liveMarket.approved ? (
              liveMarket.model_predicted_outcome === "YES" ? "Up" : "Down"
            ) : "Skip"}
          </div>
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        <div className="flex-1 bg-emerald-900/30 border border-emerald-800 rounded px-3 py-2 text-center">
          <div className="text-xs text-emerald-400">UP</div>
          <div className="text-sm font-mono text-emerald-300">
            {liveMarket.yes_ask?.toFixed(2) || "--"}
          </div>
        </div>
        <div className="flex-1 bg-red-900/30 border border-red-800 rounded px-3 py-2 text-center">
          <div className="text-xs text-red-400">DOWN</div>
          <div className="text-sm font-mono text-red-300">
            {liveMarket.no_ask?.toFixed(2) || "--"}
          </div>
        </div>
      </div>

      <div className="flex justify-between text-xs text-gray-500">
        <span>Model: {liveMarket.model_probability ? `${(liveMarket.model_probability * 100).toFixed(1)}%` : "--"}</span>
        <div className="flex gap-3">
          <span className={liveMarket.edge && liveMarket.edge > 0 ? "text-emerald-400" : "text-red-400"}>
            Edge: {liveMarket.edge ? `${liveMarket.edge > 0 ? "+" : ""}${liveMarket.edge.toFixed(4)}` : "--"}
          </span>
          <span className={liveMarket.edge_fee && liveMarket.edge_fee > 0 ? "text-emerald-300" : "text-red-300"}>
            After fees: {liveMarket.edge_fee ? `${liveMarket.edge_fee > 0 ? "+" : ""}${liveMarket.edge_fee.toFixed(4)}` : "--"}
          </span>
        </div>
      </div>
    </div>
  );
}

function RecentPredictions() {
  const { predictions, loading } = usePredictions(20);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
      <h2 className="text-lg font-semibold mb-4">Recent Predictions</h2>
      {loading ? (
        <div className="text-gray-500">Loading predictions...</div>
      ) : predictions.length === 0 ? (
        <div className="text-gray-500 text-sm">No predictions yet. Start the bot to collect data.</div>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {predictions.map((pred) => (
            <div
              key={pred.id}
              className="flex justify-between items-center py-2 border-b border-gray-800 text-sm"
            >
              <div className="flex-1">
                <div className="text-gray-300 truncate max-w-[200px]">{pred.title}</div>
                <div className="text-xs text-gray-600">
                  {pred.recorded_at ? new Date(pred.recorded_at).toLocaleTimeString() : ""}
                  {pred.seconds_remaining != null && (
                    <span className="ml-2">{formatTime(pred.seconds_remaining)} left</span>
                  )}
                </div>
              </div>
              <div className="text-right ml-4">
                <div className={`font-mono ${pred.predicted_outcome === "YES" ? "text-emerald-400" : "text-red-400"}`}>
                  {pred.probability ? `${(pred.probability * 100).toFixed(1)}%` : "--"}
                </div>
                <div className="text-xs text-gray-600">
                  {pred.outcome_resolution === "pending" ? (
                    <span className="text-yellow-600">pending</span>
                  ) : pred.outcome_resolution === "yes_won" ? (
                    <span className="text-emerald-600">won YES</span>
                  ) : (
                    <span className="text-red-600">won NO</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PositionSummary() {
  const { status } = useBotStatus();

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
      <h3 className="text-lg font-semibold mb-4">Bot Status</h3>
      <div className="space-y-3">
        <div className="flex justify-between">
          <span className="text-gray-400">Mode</span>
          <span className="font-mono">{status?.mode || "observation"}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Strategy</span>
          <span className="font-mono">{status?.strategy || "distance_to_strike"}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Uptime</span>
          <span className="font-mono">
            {status?.uptime_seconds
              ? `${Math.floor(status.uptime_seconds / 3600)}h ${Math.floor((status.uptime_seconds % 3600) / 60)}m`
              : "0h 0m"}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Errors</span>
          <span className="font-mono">{status?.error_count || 0}</span>
        </div>
        {status?.last_error && (
          <div className="mt-2 p-2 bg-red-900/30 rounded text-xs text-red-400">
            {status.last_error}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [tradingOpen, setTradingOpen] = useState(false);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      <PriceCard />
      <StatsRow />
      <LiveMarketCard />
      <RecentPredictions />

      {/* Collapsible Trading Section */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg">
        <button
          onClick={() => setTradingOpen(!tradingOpen)}
          className="w-full flex items-center justify-between p-4 text-left"
        >
          <h2 className="text-lg font-semibold">Trading</h2>
          <span className="text-gray-500 text-sm">
            {tradingOpen ? "▲ Collapse" : "▼ Expand"}
          </span>
        </button>
        {tradingOpen && (
          <div className="px-4 pb-4 border-t border-gray-800 pt-4">
            <PositionSummary />
          </div>
        )}
      </div>
    </div>
  );
}
