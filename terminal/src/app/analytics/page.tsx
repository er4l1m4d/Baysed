"use client";

import { useCalibration, useBotStatus } from "@/hooks/useBayseData";

function CalibrationChart({ curve }: { curve: { bucket: string; count: number; avg_predicted: number; actual_rate: number; gap: number }[] }) {
  if (!curve || curve.length === 0) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-4">Calibration Curve</h3>
        <div className="text-center text-gray-500 py-8">No calibration data yet</div>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
      <h3 className="text-lg font-semibold mb-4">Calibration Curve</h3>
      <div className="space-y-2">
        {curve.map((d) => (
          <div key={d.bucket} className="flex items-center gap-3">
            <div className="w-20 text-xs text-gray-400 text-right">{d.bucket}</div>
            <div className="flex-1 h-6 bg-gray-800 rounded relative overflow-hidden">
              {/* Actual rate bar */}
              <div
                className="absolute inset-y-0 left-0 bg-emerald-600 rounded"
                style={{ width: `${d.actual_rate * 100}%` }}
              />
              {/* Predicted rate marker */}
              <div
                className="absolute inset-y-0 w-0.5 bg-yellow-400"
                style={{ left: `${d.avg_predicted * 100}%` }}
              />
            </div>
            <div className="w-16 text-xs text-gray-400">
              {d.count} pred
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-4 mt-4 text-xs text-gray-500">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-emerald-600 rounded" />
          Actual Rate
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-0.5 bg-yellow-400" />
          Predicted
        </div>
      </div>
    </div>
  );
}

function MetricsGrid() {
  const { calibration } = useCalibration();

  const metrics = [
    { label: "Model Brier", value: calibration?.brier_model ? calibration.brier_model.toFixed(4) : "--", status: "neutral", desc: "Baysed model (lower = better)" },
    { label: "Market Brier", value: calibration?.brier_market ? calibration.brier_market.toFixed(4) : "--", status: "neutral", desc: "Bayse implied probability" },
    { label: "50% Baseline", value: calibration?.brier_baseline ? calibration.brier_baseline.toFixed(4) : "--", status: "neutral", desc: "Always-predict-50% baseline" },
    { label: "Edge vs Market", value: calibration?.edge_vs_market != null ? `${calibration.edge_vs_market > 0 ? "+" : ""}${calibration.edge_vs_market.toFixed(4)}` : "--", status: calibration?.edge_vs_market && calibration.edge_vs_market > 0 ? "good" : "bad", desc: "Positive = model beats market" },
    { label: "Resolved", value: String(calibration?.resolved || 0), status: "neutral", desc: `${calibration?.total || 0} total predictions` },
    { label: "Signal Coverage", value: calibration?.signal_coverage != null ? `${(calibration.signal_coverage * 100).toFixed(1)}%` : "--", status: "neutral", desc: `${calibration?.total_signals || 0} of ${calibration?.total_predictions || 0} predictions` },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
      {metrics.map((m) => (
        <div key={m.label} className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div className="text-xs text-gray-500 mb-1">{m.label}</div>
          <div className={`text-xl font-bold ${m.status === "good" ? "text-emerald-400" : m.status === "bad" ? "text-red-400" : "text-white"}`}>{m.value}</div>
          <div className="text-xs text-gray-500 mt-1">{m.desc}</div>
        </div>
      ))}
    </div>
  );
}
              m.status === "good"
                ? "bg-emerald-900 text-emerald-400"
                : m.status === "warning"
                  ? "bg-yellow-900 text-yellow-400"
                  : "bg-gray-800 text-gray-400"
            }`}
          >
            {m.status === "good" ? "Good" : m.status === "warning" ? "Warning" : "Info"}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Analytics() {
  const { calibration, loading } = useCalibration();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Model Analytics</h1>

      {loading ? (
        <div className="text-gray-500">Loading analytics...</div>
      ) : (
        <>
          <MetricsGrid />
          <CalibrationChart curve={calibration?.calibration_curve || []} />

          {/* Calibration by Time-to-Expiry */}
          {calibration?.calibration_by_expiry && calibration.calibration_by_expiry.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
              <h3 className="text-lg font-semibold mb-4">Calibration by Time-to-Expiry</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-500 border-b border-gray-800">
                      <th className="text-left py-2 px-3">Bucket</th>
                      <th className="text-right py-2 px-3">Count</th>
                      <th className="text-right py-2 px-3">Model P</th>
                      <th className="text-right py-2 px-3">Market P</th>
                      <th className="text-right py-2 px-3">Actual</th>
                      <th className="text-right py-2 px-3">Accuracy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {calibration.calibration_by_expiry.map((row) => (
                      <tr key={row.bucket} className="border-b border-gray-800/50">
                        <td className="py-2 px-3 text-white font-mono">{row.bucket}</td>
                        <td className="py-2 px-3 text-right text-gray-400">{row.count}</td>
                        <td className="py-2 px-3 text-right text-blue-400 font-mono">
                          {row.avg_predicted ? `${(row.avg_predicted * 100).toFixed(1)}%` : "--"}
                        </td>
                        <td className="py-2 px-3 text-right text-yellow-400 font-mono">
                          {row.avg_market ? `${(row.avg_market * 100).toFixed(1)}%` : "--"}
                        </td>
                        <td className="py-2 px-3 text-right text-emerald-400 font-mono">
                          {row.actual_rate != null ? `${(row.actual_rate * 100).toFixed(1)}%` : "--"}
                        </td>
                        <td className="py-2 px-3 text-right font-mono">
                          {row.accuracy != null ? (
                            <span className={row.accuracy > 0.5 ? "text-emerald-400" : "text-red-400"}>
                              {(row.accuracy * 100).toFixed(1)}%
                            </span>
                          ) : "--"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
