"use client";

import { useState } from "react";
import { usePredictions } from "@/hooks/useBayseData";
import type { Prediction } from "@/lib/api";

function ExpandedDetail({ pred }: { pred: Prediction }) {
  return (
    <tr className="bg-gray-950 border-b border-gray-800">
      <td colSpan={10} className="px-4 py-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-sm">
          {/* Column 1: Decision reasoning */}
          <div className="space-y-3">
            <h4 className="text-xs uppercase text-gray-500 font-semibold">Decision</h4>
            <div>
              <span className="text-gray-500">Pick: </span>
              <span className={pred.predicted_outcome === "YES" ? "text-emerald-400" : "text-red-400"}>
                {pred.approved
                  ? pred.predicted_outcome === "YES" ? "Up" : "Down"
                  : "Skip"}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Confidence: </span>
              <span className="font-mono">
                {pred.probability ? `${(pred.probability * 100).toFixed(1)}%` : "--"}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Edge: </span>
              <span className={`font-mono ${pred.edge && pred.edge > 0 ? "text-emerald-400" : "text-red-400"}`}>
                {pred.edge ? `${pred.edge > 0 ? "+" : ""}${pred.edge.toFixed(4)}` : "--"}
              </span>
              <span className="text-gray-600 ml-2">(after fees: </span>
              <span className={`font-mono ${pred.edge_fee && pred.edge_fee > 0 ? "text-emerald-300" : "text-red-300"}`}>
                {pred.edge_fee ? `${pred.edge_fee > 0 ? "+" : ""}${pred.edge_fee.toFixed(4)}` : "--"}
              </span>
              <span className="text-gray-600">)</span>
            </div>
            <div>
              <span className="text-gray-500">Signal Strength: </span>
              <span className="font-mono">{pred.signal_strength.toFixed(4)}</span>
            </div>
            {pred.reasons && pred.reasons.length > 0 && (
              <div>
                <span className="text-gray-500">Reasons: </span>
                <div className="mt-1 flex flex-wrap gap-1">
                  {pred.reasons.map((r, i) => (
                    <span key={i} className="px-2 py-0.5 rounded text-xs bg-gray-800 text-gray-400">
                      {r}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Column 2: Timestamps + contract timing */}
          <div className="space-y-3">
            <h4 className="text-xs uppercase text-gray-500 font-semibold">Market Window</h4>
            <div>
              <span className="text-gray-500">Opened: </span>
              <span className="font-mono text-xs">
                {pred.opened_at ? new Date(pred.opened_at).toLocaleString() : "--"}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Closes: </span>
              <span className="font-mono text-xs">
                {pred.closes_at ? new Date(pred.closes_at).toLocaleString() : "--"}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Timeframe: </span>
              <span className="font-mono text-xs">
                {pred.opened_at && pred.closes_at
                  ? `${new Date(pred.opened_at).toLocaleTimeString()} – ${new Date(pred.closes_at).toLocaleTimeString()}`
                  : "--"}
              </span>
            </div>

            <h4 className="text-xs uppercase text-gray-500 font-semibold pt-2">Recorded At</h4>
            <div>
              <span className="text-gray-500">Observed: </span>
              <span className="font-mono text-xs">
                {pred.observed_at ? new Date(pred.observed_at).toLocaleString() : "--"}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Decided: </span>
              <span className="font-mono text-xs">
                {pred.decided_at ? new Date(pred.decided_at).toLocaleString() : "--"}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Recorded: </span>
              <span className="font-mono text-xs">
                {pred.recorded_at ? new Date(pred.recorded_at).toLocaleString() : "--"}
              </span>
            </div>
          </div>

          {/* Column 3: Contract context + resolution */}
          <div className="space-y-3">
            <h4 className="text-xs uppercase text-gray-500 font-semibold">BTC Context</h4>
            <div>
              <span className="text-gray-500">Distance from Strike: </span>
              <span className="font-mono">{pred.distance_from_strike_pct.toFixed(3)}%</span>
            </div>
            <div>
              <span className="text-gray-500">Above Strike: </span>
              <span className={pred.is_above_strike ? "text-emerald-400" : "text-red-400"}>
                {pred.is_above_strike ? "Yes" : "No"}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Realized Vol: </span>
              <span className="font-mono">{pred.realized_volatility.toFixed(4)}%</span>
            </div>
            <div>
              <span className="text-gray-500">Momentum: </span>
              <span className="font-mono">{pred.momentum_pct.toFixed(4)}%</span>
            </div>

            <h4 className="text-xs uppercase text-gray-500 font-semibold pt-2">Market Prices</h4>
            <div>
              <span className="text-gray-500">YES Ask (Up): </span>
              <span className="font-mono">{pred.yes_ask?.toFixed(2) ?? "--"}</span>
            </div>
            <div>
              <span className="text-gray-500">NO Ask (Down): </span>
              <span className="font-mono">{pred.no_ask?.toFixed(2) ?? "--"}</span>
            </div>
            <div>
              <span className="text-gray-500">Spread: </span>
              <span className="font-mono">{pred.spread?.toFixed(4) ?? "--"}</span>
            </div>

            <h4 className="text-xs uppercase text-gray-500 font-semibold pt-2">Resolution</h4>
            <div>
              <span className="text-gray-500">Status: </span>
              <span className="font-mono">{pred.outcome_resolution}</span>
            </div>
            <div>
              <span className="text-gray-500">Correct: </span>
              <span className={
                pred.prediction_correct === true ? "text-emerald-400" :
                pred.prediction_correct === false ? "text-red-400" : "text-gray-500"
              }>
                {pred.prediction_correct === true ? "Yes" :
                 pred.prediction_correct === false ? "No" : "--"}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Brier Score: </span>
              <span className="font-mono">{pred.brier_score?.toFixed(4) ?? "--"}</span>
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}

function PredictionRow({
  pred,
  isExpanded,
  onToggle,
}: {
  pred: Prediction;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const minutes = Math.floor(pred.seconds_remaining / 60);
  const seconds = pred.seconds_remaining % 60;

  let pickLabel = "—";
  let pickColorClass = "text-gray-500";
  if (pred.approved) {
    if (pred.predicted_outcome === "YES") {
      pickLabel = "Up";
      pickColorClass = "bg-emerald-900 text-emerald-400";
    } else {
      pickLabel = "Down";
      pickColorClass = "bg-red-900 text-red-400";
    }
  } else if (pred.predicted_outcome) {
    pickLabel = "Skip";
    pickColorClass = "bg-gray-800 text-gray-500";
  }

  const cost = pred.approved
    ? pred.predicted_outcome === "YES" ? pred.yes_ask : pred.no_ask
    : null;

  return (
    <>
      <tr
        className="border-b border-gray-800 hover:bg-gray-900/50 cursor-pointer"
        onClick={onToggle}
      >
        <td className="py-3 px-4 text-sm">
          {new Date(pred.recorded_at).toLocaleString()}
        </td>
        <td className="py-3 px-4 text-sm max-w-[200px] truncate">{pred.title}</td>
        <td className="py-3 px-4">
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${pickColorClass}`}>
            {pickLabel}
          </span>
        </td>
        <td className="py-3 px-4 text-sm font-mono">
          {pred.probability ? `${(pred.probability * 100).toFixed(1)}%` : "--"}
        </td>
        <td className="py-3 px-4 text-sm font-mono">
          <span className={pred.edge && pred.edge > 0 ? "text-emerald-400" : "text-red-400"}>
            {pred.edge ? `${pred.edge > 0 ? "+" : ""}${pred.edge.toFixed(4)}` : "--"}
          </span>
          <span className="text-gray-600 text-xs block">
            fees: {pred.edge_fee ? `${pred.edge_fee > 0 ? "+" : ""}${pred.edge_fee.toFixed(4)}` : "--"}
          </span>
        </td>
        <td className="py-3 px-4 text-sm font-mono">
          {cost ? `$${cost.toFixed(2)}` : "--"}
        </td>
        <td className="py-3 px-4 text-sm font-mono">
          ${pred.strike_price.toLocaleString()} / ${pred.current_btc_price.toLocaleString()}
        </td>
        <td className="py-3 px-4 text-sm font-mono">
          {minutes}:{String(seconds).padStart(2, "0")}
        </td>
        <td className="py-3 px-4">
          {pred.outcome_resolution === "pending" ? (
            <span className="px-2 py-0.5 rounded text-xs bg-yellow-900 text-yellow-400">
              Pending
            </span>
          ) : pred.prediction_correct ? (
            <span className="px-2 py-0.5 rounded text-xs bg-emerald-900 text-emerald-400">
              Correct
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded text-xs bg-red-900 text-red-400">
              Wrong
            </span>
          )}
        </td>
        <td className="py-3 px-4 text-gray-500 text-xs">
          {isExpanded ? "▲" : "▼"}
        </td>
      </tr>
      {isExpanded && <ExpandedDetail pred={pred} />}
    </>
  );
}

export default function Predictions() {
  const { predictions, loading } = usePredictions(100);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleExpand = (marketId: string) => {
    setExpandedId(expandedId === marketId ? null : marketId);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Prediction History</h1>

      {loading ? (
        <div className="text-gray-500">Loading predictions...</div>
      ) : predictions.length === 0 ? (
        <div className="text-gray-500">No predictions yet. Start the bot to collect data.</div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-800 text-left text-xs text-gray-500 uppercase">
                <th className="py-3 px-4">Time</th>
                <th className="py-3 px-4">Market</th>
                <th className="py-3 px-4">Pick</th>
                <th className="py-3 px-4">Probability</th>
                <th className="py-3 px-4">Edge</th>
                <th className="py-3 px-4">Cost</th>
                <th className="py-3 px-4">Strike / BTC</th>
                <th className="py-3 px-4">Time Left</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {predictions.map((pred) => (
                <PredictionRow
                  key={pred.market_id}
                  pred={pred}
                  isExpanded={expandedId === pred.market_id}
                  onToggle={() => toggleExpand(pred.market_id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
