"use client";

const calibrationData = [
  { bucket: "0-10%", count: 5, avgPredicted: 0.065, actualRate: 0.0, gap: 0.065 },
  { bucket: "10-20%", count: 8, avgPredicted: 0.152, actualRate: 0.125, gap: 0.027 },
  { bucket: "20-30%", count: 12, avgPredicted: 0.248, actualRate: 0.25, gap: -0.002 },
  { bucket: "30-40%", count: 15, avgPredicted: 0.351, actualRate: 0.333, gap: 0.018 },
  { bucket: "40-50%", count: 18, avgPredicted: 0.452, actualRate: 0.444, gap: 0.008 },
  { bucket: "50-60%", count: 20, avgPredicted: 0.548, actualRate: 0.55, gap: -0.002 },
  { bucket: "60-70%", count: 16, avgPredicted: 0.649, actualRate: 0.625, gap: 0.024 },
  { bucket: "70-80%", count: 10, avgPredicted: 0.751, actualRate: 0.7, gap: 0.051 },
  { bucket: "80-90%", count: 6, avgPredicted: 0.848, actualRate: 0.833, gap: 0.015 },
  { bucket: "90-100%", count: 3, avgPredicted: 0.935, actualRate: 1.0, gap: -0.065 },
];

function CalibrationChart() {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
      <h3 className="text-lg font-semibold mb-4">Calibration Curve</h3>
      <div className="space-y-2">
        {calibrationData.map((d) => (
          <div key={d.bucket} className="flex items-center gap-3">
            <div className="w-20 text-xs text-gray-400 text-right">{d.bucket}</div>
            <div className="flex-1 h-6 bg-gray-800 rounded relative overflow-hidden">
              {/* Actual rate bar */}
              <div
                className="absolute inset-y-0 left-0 bg-emerald-600 rounded"
                style={{ width: `${d.actualRate * 100}%` }}
              />
              {/* Predicted rate marker */}
              <div
                className="absolute inset-y-0 w-0.5 bg-yellow-400"
                style={{ left: `${d.avgPredicted * 100}%` }}
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
  const metrics = [
    { label: "Brier Score", value: "0.1891", status: "good", desc: "Below 0.25 threshold" },
    { label: "Accuracy", value: "62.2%", status: "good", desc: "Above random chance" },
    { label: "Total Predictions", value: "150", status: "neutral", desc: "All time" },
    { label: "Resolved", value: "45", status: "neutral", desc: "30% resolution rate" },
    { label: "Avg Edge", value: "0.0312", status: "good", desc: "Positive edge detected" },
    { label: "Calibration Bias", value: "Overconfident", status: "warning", desc: "Suggest increasing vol scaling" },
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

function EdgeDecayChart() {
  const data = [
    { time: "0-60s", accuracy: 0.45, count: 3 },
    { time: "60-120s", accuracy: 0.52, count: 5 },
    { time: "120-180s", accuracy: 0.58, count: 8 },
    { time: "180-240s", accuracy: 0.62, count: 10 },
    { time: "240-300s", accuracy: 0.65, count: 12 },
    { time: "300-360s", accuracy: 0.68, count: 15 },
    { time: "360-420s", accuracy: 0.72, count: 18 },
    { time: "420-480s", accuracy: 0.75, count: 20 },
    { time: "480-540s", accuracy: 0.78, count: 22 },
    { time: "540-600s", accuracy: 0.82, count: 25 },
  ];

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
      <h3 className="text-lg font-semibold mb-4">Edge Decay by Time Remaining</h3>
      <div className="h-48 flex items-end gap-1">
        {data.map((d) => (
          <div key={d.time} className="flex-1 flex flex-col items-center">
            <div
              className="w-full bg-emerald-600 rounded-t"
              style={{ height: `${d.accuracy * 100}%` }}
            />
            <div className="text-[10px] text-gray-500 mt-1 rotate-45 origin-left">
              {d.time}
            </div>
          </div>
        ))}
      </div>
      <div className="text-xs text-gray-500 mt-4 text-center">
        Accuracy improves with more time remaining (early entry is better)
      </div>
    </div>
  );
}

export default function Analytics() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Model Analytics</h1>
      <MetricsGrid />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CalibrationChart />
        <EdgeDecayChart />
      </div>
    </div>
  );
}
