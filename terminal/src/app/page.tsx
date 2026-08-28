"use client";

import { useState } from "react";
import { useBotStatus, useCalibration, useLivePrice, usePredictions, useTrades } from "@/hooks/useBayseData";
import type { Prediction } from "@/lib/api";

function PriceCard() {
  const { price, momentum, volatility, connected } = useLivePrice();
  const { status } = useBotStatus();

  const displayPrice = price || status?.last_btc_price;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-gray-400">BTC/USD</span>
        <div className="flex items-center gap-2">
          <span
            className={`text-xs px-2 py-0.5 rounded ${connected ? "bg-emerald-900 text-emerald-400" : "bg-red-900 text-red-400"}`}
          >
            {connected ? "Connected" : "Disconnected"}
          </span>
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
  const { status, loading } = useBotStatus();
  const { calibration } = useCalibration();

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
      label: "Total Predictions",
      value: String(status?.total_predictions || 0),
      color: "text-white",
    },
    {
      label: "Accuracy",
      value: status?.accuracy ? `${(status.accuracy * 100).toFixed(1)}%` : "--",
      color: "text-emerald-400",
    },
    {
      label: "Brier Score",
      value: status?.brier_mean ? status.brier_mean.toFixed(4) : "--",
      color: "text-blue-400",
    },
    {
      label: "Resolved",
      value: String(status?.total_resolved || 0),
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

function MarketCard({
  prediction,
}: {
  prediction: {
    title: string;
    strike_price: number;
    current_btc_price: number;
    seconds_remaining: number;
    yes_ask: number | null;
    no_ask: number | null;
    predicted_outcome: string;
    probability: number | null;
    edge: number | null;
  };
}) {
  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
      <div className="text-sm font-medium text-gray-300 mb-3">{prediction.title}</div>
      <div className="grid grid-cols-2 gap-4 mb-3">
        <div>
          <div className="text-xs text-gray-500">Strike</div>
          <div className="text-lg font-mono text-white">
            ${prediction.strike_price.toLocaleString()}
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Time Left</div>
          <div className="text-lg font-mono text-white">
            {formatTime(prediction.seconds_remaining)}
          </div>
        </div>
      </div>
      <div className="flex gap-2 mb-3">
        <div className="flex-1 bg-emerald-900/30 border border-emerald-800 rounded px-3 py-2 text-center">
          <div className="text-xs text-emerald-400">UP</div>
          <div className="text-sm font-mono text-emerald-300">
            {prediction.yes_ask?.toFixed(2) || "--"}
          </div>
        </div>
        <div className="flex-1 bg-red-900/30 border border-red-800 rounded px-3 py-2 text-center">
          <div className="text-xs text-red-400">DOWN</div>
          <div className="text-sm font-mono text-red-300">
            {prediction.no_ask?.toFixed(2) || "--"}
          </div>
        </div>
      </div>
      <div className="flex justify-between text-xs text-gray-500">
        <span>Model: {prediction.probability ? `${(prediction.probability * 100).toFixed(1)}%` : "--"}</span>
        <span className={prediction.edge && prediction.edge > 0 ? "text-emerald-400" : "text-red-400"}>
          Edge: {prediction.edge ? `${prediction.edge > 0 ? "+" : ""}${prediction.edge.toFixed(4)}` : "--"}
        </span>
      </div>
    </div>
  );
}

function OrderForm() {
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [outcome, setOutcome] = useState<"UP" | "DOWN">("UP");
  const [amount, setAmount] = useState("100");
  const [price, setPrice] = useState("0.58");
  const [orderType, setOrderType] = useState<"LIMIT" | "MARKET">("LIMIT");

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
      <h3 className="text-lg font-semibold mb-4">Place Order</h3>

      <div className="space-y-4">
        <div className="flex gap-2">
          <button
            onClick={() => setSide("BUY")}
            className={`flex-1 py-2 rounded font-medium ${
              side === "BUY"
                ? "bg-emerald-600 text-white"
                : "bg-gray-800 text-gray-400 hover:bg-gray-700"
            }`}
          >
            BUY
          </button>
          <button
            onClick={() => setSide("SELL")}
            className={`flex-1 py-2 rounded font-medium ${
              side === "SELL"
                ? "bg-red-600 text-white"
                : "bg-gray-800 text-gray-400 hover:bg-gray-700"
            }`}
          >
            SELL
          </button>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setOutcome("UP")}
            className={`flex-1 py-2 rounded font-medium ${
              outcome === "UP"
                ? "bg-emerald-600 text-white"
                : "bg-gray-800 text-gray-400 hover:bg-gray-700"
            }`}
          >
            UP (Yes)
          </button>
          <button
            onClick={() => setOutcome("DOWN")}
            className={`flex-1 py-2 rounded font-medium ${
              outcome === "DOWN"
                ? "bg-red-600 text-white"
                : "bg-gray-800 text-gray-400 hover:bg-gray-700"
            }`}
          >
            DOWN (No)
          </button>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setOrderType("LIMIT")}
            className={`flex-1 py-2 rounded font-medium ${
              orderType === "LIMIT"
                ? "bg-blue-600 text-white"
                : "bg-gray-800 text-gray-400 hover:bg-gray-700"
            }`}
          >
            LIMIT
          </button>
          <button
            onClick={() => setOrderType("MARKET")}
            className={`flex-1 py-2 rounded font-medium ${
              orderType === "MARKET"
                ? "bg-blue-600 text-white"
                : "bg-gray-800 text-gray-400 hover:bg-gray-700"
            }`}
          >
            MARKET
          </button>
        </div>

        <div>
          <label className="text-xs text-gray-500 block mb-1">Amount (USD)</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white font-mono focus:outline-none focus:border-emerald-500"
          />
        </div>

        {orderType === "LIMIT" && (
          <div>
            <label className="text-xs text-gray-500 block mb-1">Price</label>
            <input
              type="number"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white font-mono focus:outline-none focus:border-emerald-500"
            />
          </div>
        )}

        <div className="bg-gray-800 rounded p-3 space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-400">Side</span>
            <span className={side === "BUY" ? "text-emerald-400" : "text-red-400"}>
              {side}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Outcome</span>
            <span>{outcome}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Amount</span>
            <span>${amount}</span>
          </div>
          {orderType === "LIMIT" && (
            <div className="flex justify-between">
              <span className="text-gray-400">Est. Shares</span>
              <span>{(parseFloat(amount) / parseFloat(price)).toFixed(2)}</span>
            </div>
          )}
        </div>

        <button
          className={`w-full py-3 rounded font-bold text-white ${
            side === "BUY"
              ? "bg-emerald-600 hover:bg-emerald-500"
              : "bg-red-600 hover:bg-red-500"
          }`}
        >
          {side} {outcome}
        </button>
      </div>
    </div>
  );
}

function TradeHistory() {
  const { trades, loading } = useTrades(20);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
      <h3 className="text-lg font-semibold mb-4">Trade History</h3>
      {loading ? (
        <div className="text-gray-500">Loading trades...</div>
      ) : trades.length === 0 ? (
        <div className="text-center text-gray-500 py-8">No trades yet</div>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {trades.map((trade) => (
            <div
              key={trade.id}
              className="flex justify-between items-center py-2 border-b border-gray-800"
            >
              <div>
                <div className="text-sm font-medium">
                  {trade.side} {trade.outcome}
                </div>
                <div className="text-xs text-gray-500">
                  {new Date(trade.recorded_at).toLocaleString()}
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-mono">${trade.amount}</div>
                <div className="text-xs text-gray-500">@ {trade.price}</div>
              </div>
              <div>
                <span
                  className={`text-xs px-2 py-0.5 rounded ${
                    trade.status === "filled"
                      ? "bg-emerald-900 text-emerald-400"
                      : trade.status === "pending"
                        ? "bg-yellow-900 text-yellow-400"
                        : "bg-gray-800 text-gray-400"
                  }`}
                >
                  {trade.status}
                </span>
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
  const { predictions, loading: predictionsLoading } = usePredictions(5);
  const [tradingOpen, setTradingOpen] = useState(false);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      <PriceCard />
      <StatsRow />

      <div>
        <h2 className="text-lg font-semibold mb-3">Recent Predictions</h2>
        {predictionsLoading ? (
          <div className="text-gray-500">Loading predictions...</div>
        ) : predictions.length === 0 ? (
          <div className="text-gray-500">No predictions yet. Start the bot to collect data.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {predictions.map((pred) => (
              <MarketCard key={pred.market_id} prediction={pred} />
            ))}
          </div>
        )}
      </div>

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
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-6">
                <OrderForm />
                <TradeHistory />
              </div>
              <div className="space-y-6">
                <PositionSummary />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
