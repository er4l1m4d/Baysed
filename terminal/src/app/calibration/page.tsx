"use client";

import { useCalibration } from "@/hooks/useBayseData";
import { Card, CardHeader, StatCard, EmptyState } from "@/components/ui";

const pct = (v: number | null | undefined, digits = 1) =>
  v != null ? `${(v * 100).toFixed(digits)}%` : "--";

function CalibrationCurve({
  curve,
}: {
  curve: {
    bucket: string;
    count: number;
    avg_predicted: number;
    actual_rate: number;
  }[];
}) {
  return (
    <div className="space-y-2">
      {curve.map((d) => (
        <div key={d.bucket} className="flex items-center gap-3">
          <div className="label-caps-sm tabular w-20 text-right text-on-surface-variant">
            {d.bucket}
          </div>
          <div className="relative h-6 flex-1 overflow-hidden rounded-sm bg-surface-container-lowest">
            <div
              className="absolute inset-y-0 left-0 bg-primary-container/70"
              style={{ width: `${Math.min(100, d.actual_rate * 100)}%` }}
            />
            <div
              className="absolute inset-y-0 w-0.5 bg-warning-gold"
              style={{ left: `${Math.min(100, d.avg_predicted * 100)}%` }}
            />
          </div>
          <div className="label-caps-sm tabular w-14 text-on-surface-variant/70">
            {d.count}x
          </div>
        </div>
      ))}
      <div className="label-caps-sm flex gap-4 pt-2 text-on-surface-variant/70">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-primary-container/70" /> Actual
          rate
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-2.5 bg-warning-gold" /> Predicted
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
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-on-surface">
          Calibration
        </h1>
        <p className="mt-1.5 text-sm text-on-surface-variant">
          Does the model&apos;s stated probability match reality?
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Brier — Model"
          icon="functions"
          value={
            calibration?.brier_model != null
              ? calibration.brier_model.toFixed(4)
              : "--"
          }
          subtitle="Lower is better"
          tone={
            calibration?.brier_model != null && calibration.brier_model < 0.25
              ? "green"
              : "red"
          }
          loading={loading}
        />
        <StatCard
          label="Brier — Market"
          icon="storefront"
          value={
            calibration?.brier_market != null
              ? calibration.brier_market.toFixed(4)
              : "--"
          }
          subtitle="Bayse implied odds as forecast"
          loading={loading}
        />
        <StatCard
          label="Brier — Baseline"
          icon="balance"
          value={
            calibration?.brier_baseline != null
              ? calibration.brier_baseline.toFixed(4)
              : "--"
          }
          subtitle="Always predict 50/50"
          loading={loading}
        />
        <StatCard
          label="Edge vs Market"
          icon="bolt"
          value={
            calibration?.edge_vs_market != null
              ? `${calibration.edge_vs_market > 0 ? "+" : ""}${calibration.edge_vs_market.toFixed(4)}`
              : "--"
          }
          subtitle="Model minus market Brier"
          tone={
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
            icon="monitoring"
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
                icon="monitoring"
              />
            ) : (
              <CalibrationCurve curve={calibration.calibration_curve} />
            )}
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Coverage" subtitle="How much of the pipeline is modeled" icon="donut_large" />
          <div className="space-y-5 px-5 py-5">
            {loading ? (
              [...Array(3)].map((_, i) => (
                <div key={i} className="skeleton h-10 w-full" />
              ))
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
                    calibration?.total ? calibration.resolved / calibration.total : null
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
              icon="schedule"
            />
            <div className="overflow-x-auto px-5 py-4">
              <table className="w-full text-left">
                <thead>
                  <tr className="label-caps-sm border-b border-border-subtle bg-surface-container-low text-on-surface-variant">
                    <th className="py-2.5 pr-4 font-medium">Window</th>
                    <th className="py-2.5 pr-4 font-medium">Snapshots</th>
                    <th className="py-2.5 pr-4 font-medium">Avg Predicted</th>
                    <th className="py-2.5 pr-4 font-medium">Avg Market</th>
                    <th className="py-2.5 pr-4 font-medium">Actual Up Rate</th>
                    <th className="py-2.5 font-medium">Accuracy</th>
                  </tr>
                </thead>
                <tbody>
                  {calibration.calibration_by_expiry.map((row) => (
                    <tr
                      key={row.bucket}
                      className="border-b border-border-subtle/60 text-[13px] text-on-surface-variant transition-colors hover:bg-surface-container-low/70"
                    >
                      <td className="tabular py-2.5 pr-4 font-medium text-on-surface">
                        {row.bucket}
                      </td>
                      <td className="tabular py-2.5 pr-4">{row.count}</td>
                      <td className="tabular py-2.5 pr-4">{pct(row.avg_predicted)}</td>
                      <td className="tabular py-2.5 pr-4">{pct(row.avg_market)}</td>
                      <td className="tabular py-2.5 pr-4">{pct(row.actual_rate)}</td>
                      <td
                        className={`tabular py-2.5 font-semibold ${
                          row.accuracy != null && row.accuracy >= 0.5
                            ? "text-primary-container"
                            : "text-error"
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
        <span className="label-caps-sm text-on-surface-variant">{label}</span>
        <span className="tabular text-[13px] font-semibold text-on-surface">
          {pct(value, 0)}
        </span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-bright">
        <div
          className="progress-bar-striped h-full bg-primary-container"
          style={{ width: `${Math.min(100, (value ?? 0) * 100)}%` }}
        />
      </div>
      <div className="label-caps-sm tabular mt-1.5 text-on-surface-variant/60">
        {detail}
      </div>
    </div>
  );
}
