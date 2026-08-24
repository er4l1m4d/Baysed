"use client";

import { useState } from "react";

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

function OpenOrders() {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
      <h3 className="text-lg font-semibold mb-4">Open Orders</h3>
      <div className="text-center text-gray-500 py-8">No open orders</div>
    </div>
  );
}

function PositionSummary() {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
      <h3 className="text-lg font-semibold mb-4">Positions</h3>
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div>
          <div className="text-xs text-gray-500">Open Positions</div>
          <div className="text-xl font-bold text-white">0</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Total Value</div>
          <div className="text-xl font-bold text-white">$0.00</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Unrealized PnL</div>
          <div className="text-xl font-bold text-emerald-400">$0.00</div>
        </div>
      </div>
      <div className="text-center text-gray-500 py-4">No active positions</div>
    </div>
  );
}

function MarketInfo() {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
      <h3 className="text-lg font-semibold mb-4">Current Market</h3>
      <div className="space-y-3">
        <div className="flex justify-between">
          <span className="text-gray-400">Market</span>
          <span>Bitcoin Up or Down - 15 min</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Strike Price</span>
          <span className="font-mono">$77,050.02</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Time Remaining</span>
          <span className="font-mono">14:23</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">UP Price</span>
          <span className="font-mono text-emerald-400">$0.58</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">DOWN Price</span>
          <span className="font-mono text-red-400">$0.42</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Spread</span>
          <span className="font-mono">$0.04</span>
        </div>
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
          <OpenOrders />
        </div>
        <div className="space-y-6">
          <MarketInfo />
          <PositionSummary />
        </div>
      </div>
    </div>
  );
}
