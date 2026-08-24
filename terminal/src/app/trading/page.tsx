"use client";

import { useState } from "react";
import { useTrades, useBotStatus } from "@/hooks/useBayseData";

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
        {/* Side selector */}
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

        {/* Outcome selector */}
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

        {/* Order type */}
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

        {/* Amount */}
        <div>
          <label className="text-xs text-gray-500 block mb-1">Amount (USD)</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white font-mono focus:outline-none focus:border-emerald-500"
          />
        </div>

        {/* Price (for limit orders) */}
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

        {/* Order summary */}
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

        {/* Submit button */}
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

export default function Trading() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Trading</h1>

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
  );
}
