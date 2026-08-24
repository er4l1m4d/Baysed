"use client";

const mockPredictions = [
  {
    id: 1,
    title: "Bitcoin Up or Down - 15 min",
    predicted: "UP",
    probability: 0.62,
    edge: 0.04,
    strike: 77050,
    btcPrice: 77082,
    distance: 0.041,
    timeRemaining: "14:35",
    status: "pending",
    recordedAt: "2026-08-23 10:32:15",
  },
  {
    id: 2,
    title: "Bitcoin Up or Down - 15 min",
    predicted: "DOWN",
    probability: 0.38,
    edge: -0.02,
    strike: 77120,
    btcPrice: 77095,
    distance: -0.032,
    timeRemaining: "12:18",
    status: "resolved",
    outcome: "DOWN",
    correct: true,
    brierScore: 0.1444,
    recordedAt: "2026-08-23 10:28:42",
  },
  {
    id: 3,
    title: "Bitcoin Up or Down - 15 min",
    predicted: "UP",
    probability: 0.55,
    edge: 0.03,
    strike: 77200,
    btcPrice: 77215,
    distance: 0.019,
    timeRemaining: "08:45",
    status: "resolved",
    outcome: "DOWN",
    correct: false,
    brierScore: 0.3025,
    recordedAt: "2026-08-23 10:25:11",
  },
];

function PredictionRow({ pred }: { pred: (typeof mockPredictions)[0] }) {
  const isUp = pred.predicted === "UP";
  return (
    <tr className="border-b border-gray-800 hover:bg-gray-900/50">
      <td className="py-3 px-4 text-sm">{pred.recordedAt}</td>
      <td className="py-3 px-4 text-sm">{pred.title}</td>
      <td className="py-3 px-4">
        <span
          className={`px-2 py-0.5 rounded text-xs font-medium ${
            isUp ? "bg-emerald-900 text-emerald-400" : "bg-red-900 text-red-400"
          }`}
        >
          {pred.predicted}
        </span>
      </td>
      <td className="py-3 px-4 text-sm font-mono">{(pred.probability * 100).toFixed(1)}%</td>
      <td className="py-3 px-4 text-sm font-mono">{pred.edge > 0 ? "+" : ""}{pred.edge.toFixed(4)}</td>
      <td className="py-3 px-4 text-sm font-mono">${pred.strike.toLocaleString()}</td>
      <td className="py-3 px-4 text-sm font-mono">${pred.btcPrice.toLocaleString()}</td>
      <td className="py-3 px-4 text-sm font-mono">{pred.distance.toFixed(3)}%</td>
      <td className="py-3 px-4 text-sm">{pred.timeRemaining}</td>
      <td className="py-3 px-4">
        {pred.status === "pending" ? (
          <span className="px-2 py-0.5 rounded text-xs bg-yellow-900 text-yellow-400">
            Pending
          </span>
        ) : pred.correct ? (
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
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Prediction History</h1>

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
            {mockPredictions.map((pred) => (
              <PredictionRow key={pred.id} pred={pred} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
