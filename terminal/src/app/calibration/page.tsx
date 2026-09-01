"use client";

import { useCalibration } from "@/hooks/useBayseData";
import { Card, CardHeader, StatCard, EmptyState } from "@/components/ui";

const pct = (v: number | null | undefined, digits = 1) =>
  v != null ? `${(v * 100).toFixed(digits)}%` : "--";

function CalibrationCurve({
  curve,
}: {
  curve: { bucket: string; count: number; avg_predicted: number; actual_rate: number }[];
}) {
  return (
    <div className="space-y-2">
      {curve.map((d) => (
        <div key={d.bucket} className="flex items-center gap-3">
          <div className="tabular w-20 text-right text-xs text-zinc-400">{d.bucket}</div>
          <div className="relative h-6 flex-1 overflow-hidden rounded-md bg-zinc-800">
            <div
              className="absolute inset-y-0 left-0 rounded-md bg-emerald-600/80"
              style={{ width: `${Math.min(100, d.actual_rate * 100)}%` }}
            />
            <div
              className="absolute inset-y-0 w-0.5 bg-amber-400"
              style={{ left: `${Math.min(100, d.avg_predicted * 100)}%` }}
            />
          </div>
          <div className="tabular w-14 text-xs text-zinc-500">{d.count}x</div>
        </div>
      ))}
      <div className="flex gap-4 pt-2 text-xs text-zinc-500">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-emerald-600" /> Actual rate
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-2.5 bg-amber-400" /> Predicted
        </span>
      </div>
    </div>
  );
}

export default function CalibrationPage() {
  const { calibration, loading } = useCalibration();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[28px] font-bold leading-tight text-white">Calibration</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Does the model&apos;s stated probability match reality?
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Brier — Model"
          value={calibration?.brier_model != null ? calibration.brier_model.toFixed(4) : "--"}
          subtitle="Lower is better"
          dot={
            calibration?.brier_model != null && calibration.brier_model < 0.25 ? "green" : "red"
          }
          loading={loading}
        />
        <StatCard
          label="Brier — Market"
          value={calibration?.brier_market != null ? calibration.brier_market.toFixed(4) : "--"}
          subtitle="Bayse implied odds as forecast"
          loading={loading}
        />
        <StatCard
          label="Brier — Baseline"
          value={calibration?.brier_baseline != null ? calibration.brier_baseline.toFixed(4) : "--"}
          subtitle="Always predict 50/50"
          loading={loading}
        />
        <StatCard
          label="Edge vs Market"
          value={
            calibration?.edge_vs_market != null
              ? `${calibration.edge_vs_market > 0 ? "+" : ""}${calibration.edge_vs_market.toFixed(4)}`
              : "--"
          }
          subtitle="Model minus market Brier"
          dot={
            calibration?.edge_vs_market != null && calibration.edge_vs_market > 0
              ? "green"
              : "red"
          }
          loading={loading}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader
            title="Calibration Curve"
            subtitle="Predicted probability vs actual outcome rate"
          />
          <div className="px-5 py-5">
            {loading ? (
              <div className="space-y-2">
                {[...Array(8)].map((_, i) => (
                  <div key={i} className="skeleton h-6 w-full" />
                ))}
              </div>
            ) : !calibration?.calibration_curve ||
              calibration.calibration_curve.length === 0 ? (
              <EmptyState
                title="No resolved predictions yet"
                hint="The curve appears once snapshots resolve against Bayse's outcome."
              />
            ) : (
              <CalibrationCurve curve={calibration.calibration_curve} />
            )}
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Coverage" subtitle="How much of the pipeline is modeled" />
          <div className="space-y-4 px-5 py-5">
            {loading ? (
              [...Array(3)].map((_, i) => <div key={i} className="skeleton h-10 w-full" />)
            ) : (
              <>
                <CoverageRow
                  label="Modeled snapshots"
                  value={calibration?.prediction_coverage ?? null}
                  detail={`${calibration?.total_predictions ?? 0} of ${calibration?.total_snapshots ?? 0}`}
                />
                <CoverageRow
                  label="Signals with model output"
                  value={calibration?.signal_coverage ?? null}
                  detail={`${calibration?.total_signals ?? 0} with probability`}
                />
                <CoverageRow
                  label="Resolved"
                  value={
                    calibration?.total
                      ? (calibration.resolved / calibration.total)
                      : null
                  }
                  detail={`${calibration?.resolved ?? 0} of ${calibration?.total ?? 0}`}
                />
              </>
            )}
          </div>
        </Card>
      </div>

      {/* Calibration by expiry bucket */}
      {calibration?.calibration_by_expiry &&
        calibration.calibration_by_expiry.length > 0 && (
          <Card>
            <CardHeader
              title="Calibration by Time-to-Expiry"
              subtitle="Accuracy across the 15-minute window"
            />
            <div className="overflow-x-auto px-5 py-5">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 text-[11px] uppercase tracking-wider text-zinc-500">
                    <th className="pb-2 pr-4 font-semibold">Window</th>
                    <th className="pb-2 pr-4 font-semibold">Snapshots</th>
                    <th className="pb-2 pr-4 font-semibold">Avg Predicted</th>
                    <th className="pb-2 pr-4 font-semibold">Avg Market</th>
                    <th className="pb-2 pr-4 font-semibold">Actual Up Rate</th>
                    <th className="pb-2 font-semibold">Accuracy</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {calibration.calibration_by_expiry.map((row) => (
                    <tr key={row.bucket} className="text-zinc-300">
                      <td className="tabular py-2.5 pr-4">{row.bucket}</td>
                      <td className="tabular py-2.5 pr-4 text-zinc-400">{row.count}</td>
                      <td className="tabular py-2.5 pr-4">{pct(row.avg_predicted)}</td>
                      <td className="tabular py-2.5 pr-4 text-zinc-400">{pct(row.avg_market)}</td>
                      <td className="tabular py-2.5 pr-4">{pct(row.actual_rate)}</td>
                      <td
                        className={`tabular py-2.5 font-semibold ${
                          row.accuracy != null && row.accuracy >= 0.5
                            ? "text-emerald-400"
                            : "text-rose-400"
                        }`}
                      >
                        {pct(row.accuracy)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
    </div>
  );
}

function CoverageRow({
  label,
  value,
  detail,
}: {
  label: string;
  value: number | null;
  detail: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] text-zinc-400">{label}</span>
        <span className="tabular text-[13px] font-semibold text-white">{pct(value, 0)}</span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
        <div
          className="h-full rounded-full bg-amber-500"
          style={{ width: `${Math.min(100, (value ?? 0) * 100)}%` }}
        />
      </div>
      <div className="tabular mt-1 text-[11px] text-zinc-500">{detail}</div>
    </div>
  );
}
