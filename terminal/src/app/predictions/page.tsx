"use client";

import { usePredictions } from "@/hooks/useBayseData";
import type { Prediction } from "@/lib/api";

function PredictionRow({ pred }: { pred: Prediction }) {
  const isUp = pred.predicted_outcome === "YES";
  const timeRemaining = pred.seconds_remaining;
  const minutes = Math.floor(timeRemaining / 60);
  const seconds = timeRemaining % 60;

  return (
    <tr className="border-b border-gray-800 hover:bg-gray-900/50">
      <td className="py-3 px-4 text-sm">
        {new Date(pred.recorded_at).toLocaleString()}
      </td>
      <td className="py-3 px-4 text-sm">{pred.title}</td>
      <td className="py-3 px-4">
        <span
          className={`px-2 py-0.5 rounded text-xs font-medium ${
            isUp ? "bg-emerald-900 text-emerald-400" : "bg-red-900 text-red-400"
          }`}
        >
          {pred.predicted_outcome || "--"}
        </span>
      </td>
      <td className="py-3 px-4 text-sm font-mono">
        {pred.probability ? `${(pred.probability * 100).toFixed(1)}%` : "--"}
      </td>
      <td className="py-3 px-4 text-sm font-mono">
        {pred.edge ? `${pred.edge > 0 ? "+" : ""}${pred.edge.toFixed(4)}` : "--"}
      </td>
      <td className="py-3 px-4 text-sm font-mono">
        ${pred.strike_price.toLocaleString()}
      </td>
      <td className="py-3 px-4 text-sm font-mono">
        ${pred.current_btc_price.toLocaleString()}
      </td>
      <td className="py-3 px-4 text-sm font-mono">
        {pred.distance_from_strike_pct.toFixed(3)}%
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
    </tr>
  );
}

export default function Predictions() {
  const { predictions, loading } = usePredictions(100);

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
                <th className="py-3 px-4">Predicted</th>
                <th className="py-3 px-4">Probability</th>
                <th className="py-3 px-4">Edge</th>
                <th className="py-3 px-4">Strike</th>
                <th className="py-3 px-4">BTC Price</th>
                <th className="py-3 px-4">Distance</th>
                <th className="py-3 px-4">Time Left</th>
                <th className="py-3 px-4">Status</th>
              </tr>
            </thead>
            <tbody>
              {predictions.map((pred) => (
                <PredictionRow key={pred.market_id} pred={pred} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
