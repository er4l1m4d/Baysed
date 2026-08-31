"use client";

import { useCalibration } from "@/hooks/useBayseData";

function CalibrationChart({ curve }: { curve: { bucket: string; count: number; avg_predicted: number; actual_rate: number; gap: number }[] }) {
  if (!curve || curve.length === 0) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-4">Calibration Curve</h3>
        <div className="text-center text-gray-500 py-8">
          <div className="text-sm">No resolved predictions yet</div>
          <div className="text-xs mt-1 text-gray-600">Calibration data appears once predictions resolve against BTC price</div>
        </div>
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

  const resolved = calibration?.resolved || 0;
  const hasResolved = resolved > 0;

  const metrics = [
    { label: "Model Brier", value: hasResolved ? calibration!.brier_model!.toFixed(4) : "--", status: "neutral" as const, desc: hasResolved ? "Baysed model (lower = better)" : `Awaiting ${resolved}/${calibration?.total || 0} resolved` },
    { label: "Market Brier", value: hasResolved ? calibration!.brier_market!.toFixed(4) : "--", status: "neutral" as const, desc: hasResolved ? "Bayse implied probability" : "Bayse market baseline" },
    { label: "50% Baseline", value: "0.2500", status: "neutral" as const, desc: "Always-predict-50% (constant)" },
    { label: "Edge vs Market", value: hasResolved ? `${calibration!.edge_vs_market! > 0 ? "+" : ""}${calibration!.edge_vs_market!.toFixed(4)}` : "--", status: (hasResolved && calibration!.edge_vs_market! > 0) ? "good" as const : "bad" as const, desc: hasResolved ? "Positive = model beats market" : "Requires resolved predictions" },
    { label: "Resolved", value: String(resolved), status: "neutral" as const, desc: `${calibration?.total || 0} total predictions` },
    { label: "Signal Coverage", value: calibration?.signal_coverage != null ? `${(calibration.signal_coverage * 100).toFixed(1)}%` : "--", status: "neutral" as const, desc: `${calibration?.total_signals || 0} of ${calibration?.total_predictions || 0} approved` },
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
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
            <h3 className="text-lg font-semibold mb-4">Calibration by Time-to-Expiry</h3>
            {calibration?.calibration_by_expiry && calibration.calibration_by_expiry.length > 0 ? (
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
            ) : (
              <div className="text-center text-gray-500 py-6">
                <div className="text-sm">No expiry data yet</div>
                <div className="text-xs mt-1 text-gray-600">Shows how model accuracy varies by time remaining in the 15-min window</div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
