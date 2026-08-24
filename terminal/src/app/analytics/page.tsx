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
  const { status } = useBotStatus();
  const { calibration } = useCalibration();

  const accuracy = status?.accuracy ? `${(status.accuracy * 100).toFixed(1)}%` : "--";
  const brier = status?.brier_mean ? status.brier_mean.toFixed(4) : "--";
  const total = status?.total_predictions || 0;
  const resolved = status?.total_resolved || 0;

  const metrics = [
    { label: "Brier Score", value: brier, status: status?.brier_mean && status.brier_mean < 0.25 ? "good" : "neutral", desc: "Lower is better (0 = perfect)" },
    { label: "Accuracy", value: accuracy, status: status?.accuracy && status.accuracy > 0.5 ? "good" : "neutral", desc: "Fraction of correct predictions" },
    { label: "Total Predictions", value: String(total), status: "neutral", desc: "All time" },
    { label: "Resolved", value: String(resolved), status: "neutral", desc: `${total > 0 ? ((resolved / total) * 100).toFixed(0) : 0}% resolution rate` },
    { label: "Avg Edge", value: "--", status: "neutral", desc: "Model edge vs market" },
    { label: "Calibration Bias", value: calibration?.calibration_curve?.length ? "Measuring..." : "No data", status: "neutral", desc: "Will improve with more data" },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
      {metrics.map((m) => (
        <div key={m.label} className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div className="text-xs text-gray-500 mb-1">{m.label}</div>
          <div className="text-xl font-bold text-white">{m.value}</div>
          <div className="text-xs text-gray-500 mt-1">{m.desc}</div>
          <div
            className={`text-xs mt-2 px-2 py-0.5 rounded inline-block ${
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
        </>
      )}
    </div>
  );
}
