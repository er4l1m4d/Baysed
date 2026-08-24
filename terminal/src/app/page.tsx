"use client";

import { useBayseTicker } from "@/hooks/useBayseData";

function PriceCard() {
  const { ticker, connected } = useBayseTicker();

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-gray-400">BTC/USD</span>
        <span
          className={`text-xs px-2 py-0.5 rounded ${connected ? "bg-emerald-900 text-emerald-400" : "bg-red-900 text-red-400"}`}
        >
          {connected ? "Connected" : "Disconnected"}
        </span>
      </div>
      <div className="text-4xl font-bold text-white">
        {ticker ? `$${ticker.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "Loading..."}
      </div>
      <div className="text-xs text-gray-500 mt-2">
        {ticker ? new Date(ticker.timestamp).toLocaleTimeString() : ""}
      </div>
    </div>
  );
}

function MarketCard({
  title,
  strike,
  timeLeft,
  yesPrice,
  noPrice,
}: {
  title: string;
  strike: number;
  timeLeft: string;
  yesPrice: number;
  noPrice: number;
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
      <div className="text-sm font-medium text-gray-300 mb-3">{title}</div>
      <div className="grid grid-cols-2 gap-4 mb-3">
        <div>
          <div className="text-xs text-gray-500">Strike</div>
          <div className="text-lg font-mono text-white">
            ${strike.toLocaleString()}
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Time Left</div>
          <div className="text-lg font-mono text-white">{timeLeft}</div>
        </div>
      </div>
      <div className="flex gap-2">
        <div className="flex-1 bg-emerald-900/30 border border-emerald-800 rounded px-3 py-2 text-center">
          <div className="text-xs text-emerald-400">UP</div>
          <div className="text-sm font-mono text-emerald-300">
            {yesPrice.toFixed(2)}
          </div>
        </div>
        <div className="flex-1 bg-red-900/30 border border-red-800 rounded px-3 py-2 text-center">
          <div className="text-xs text-red-400">DOWN</div>
          <div className="text-sm font-mono text-red-300">
            {noPrice.toFixed(2)}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatsRow() {
  return (
    <div className="grid grid-cols-4 gap-4">
      {[
        { label: "Predictions Today", value: "0", color: "text-white" },
        { label: "Accuracy", value: "--", color: "text-emerald-400" },
        { label: "Brier Score", value: "--", color: "text-blue-400" },
        { label: "Active Positions", value: "0", color: "text-yellow-400" },
      ].map((stat) => (
        <div key={stat.label} className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div className="text-xs text-gray-500 mb-1">{stat.label}</div>
          <div className={`text-2xl font-bold ${stat.color}`}>{stat.value}</div>
        </div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      <PriceCard />
      <StatsRow />

      <div>
        <h2 className="text-lg font-semibold mb-3">Active Markets</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <MarketCard
            title="Bitcoin Up or Down - 15 min"
            strike={77050}
            timeLeft="14:23"
            yesPrice={0.58}
            noPrice={0.42}
          />
        </div>
      </div>
    </div>
  );
}
