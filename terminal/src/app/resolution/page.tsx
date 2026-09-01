"use client";

import { useMemo, useState } from "react";
import { usePredictions } from "@/hooks/useBayseData";
import type { Prediction } from "@/lib/api";
import {
  Card,
  CardHeader,
  StatCard,
  PillToggle,
  StatusBadge,
  EmptyState,
} from "@/components/ui";

const RES_TABS = ["All", "Correct", "Wrong"] as const;
type ResTab = (typeof RES_TABS)[number];

const usd = (v: number | null | undefined) =>
  v != null
    ? `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : "--";

const pct = (v: number | null | undefined, digits = 1) =>
  v != null ? `${(v * 100).toFixed(digits)}%` : "--";

function marketLabel(p: Prediction) {
  if (p.closes_at) {
    const d = new Date(p.closes_at);
    return `BTC ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  return "BTC";
}

function timeAgo(iso: string) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function ResolutionPage() {
  const [tab, setTab] = useState<ResTab>("All");
  const { predictions, loading } = usePredictions(200);

  const resolved = useMemo(
    () =>
      predictions
        .filter((p) => p.outcome_resolution !== "pending")
        .sort(
          (a, b) =>
            new Date(b.resolved_at ?? b.recorded_at).getTime() -
            new Date(a.resolved_at ?? a.recorded_at).getTime()
        ),
    [predictions]
  );

  const modeled = resolved.filter((p) => p.probability != null);
  const correct = modeled.filter((p) => p.prediction_correct === true);
  const wrong = modeled.filter((p) => p.prediction_correct !== true);
  const brierValues = modeled
    .map((p) => p.brier_score)
    .filter((b): b is number => b != null);
  const brierMean =
    brierValues.length > 0
      ? brierValues.reduce((s, b) => s + b, 0) / brierValues.length
      : null;

  const rows = useMemo(() => {
    if (tab === "Correct") return correct;
    if (tab === "Wrong") return wrong;
    return resolved;
  }, [tab, resolved, correct, wrong]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-on-surface">
          Resolution
        </h1>
        <p className="mt-1.5 text-sm text-on-surface-variant">
          Every snapshot scored against Bayse&apos;s canonical outcome.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Resolved Snapshots"
          icon="fact_check"
          value={String(resolved.length)}
          subtitle={`${modeled.length} WITH MODEL PROBABILITY`}
          loading={loading}
        />
        <StatCard
          label="Correct"
          icon="check_circle"
          value={String(correct.length)}
          subtitle={modeled.length > 0 ? pct(correct.length / modeled.length) : "--"}
          tone={
            modeled.length > 0 &&
            correct.length / Math.max(1, modeled.length) >= 0.5
              ? "green"
              : "red"
          }
          loading={loading}
        />
        <StatCard
          label="Wrong"
          icon="cancel"
          value={String(wrong.length)}
          subtitle={modeled.length > 0 ? pct(wrong.length / modeled.length) : "--"}
          tone="red"
          loading={loading}
        />
        <StatCard
          label="Brier Mean"
          icon="functions"
          value={brierMean != null ? brierMean.toFixed(4) : "--"}
          subtitle="Across resolved modeled snapshots"
          tone={brierMean != null && brierMean < 0.25 ? "green" : "red"}
          loading={loading}
        />
      </div>

      <Card>
        <CardHeader
          title="Resolution History"
          subtitle="Newest first · one row per snapshot"
          icon="receipt_long"
          actions={<PillToggle options={RES_TABS} value={tab} onChange={setTab} />}
        />

        <div className="py-1">
          {loading ? (
            <div className="space-y-2 px-5 py-3">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="skeleton h-10 w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              title={
                tab === "All" ? "No resolutions yet" : `No ${tab.toLowerCase()} predictions`
              }
              hint="Markets resolve about a minute after their window closes."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="label-caps-sm border-b border-border-subtle bg-surface-container-low text-on-surface-variant">
                    <th className="py-2.5 pl-5 pr-4 font-medium">Market</th>
                    <th className="py-2.5 pr-4 font-medium">Predicted</th>
                    <th className="py-2.5 pr-4 font-medium">Actual</th>
                    <th className="py-2.5 pr-4 font-medium">Result</th>
                    <th className="py-2.5 pr-4 font-medium">Prob</th>
                    <th className="py-2.5 pr-4 font-medium">Brier</th>
                    <th className="py-2.5 pr-4 font-medium">Close BTC</th>
                    <th className="py-2.5 pr-5 font-medium">Resolved</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 40).map((p) => {
                    const hasModel = p.probability != null;
                    const isCorrect = p.prediction_correct === true;
                    const actualYes = p.outcome_resolution === "yes_won";
                    return (
                      <tr
                        key={p.id}
                        className="border-b border-border-subtle/60 transition-colors hover:bg-surface-container-low/70"
                      >
                        <td className="label-caps py-2.5 pl-5 pr-4 text-[12px] text-on-surface">
                          {marketLabel(p)}
                        </td>
                        <td className="py-2.5 pr-4">
                          {hasModel ? (
                            <span
                              className={`label-caps-sm ${
                                p.predicted_outcome === "YES"
                                  ? "text-primary-container"
                                  : "text-error"
                              }`}
                            >
                              {p.predicted_outcome === "YES" ? "UP" : "DOWN"}
                            </span>
                          ) : (
                            <span className="label-caps-sm text-on-surface-variant/40">
                              —
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 pr-4">
                          <span
                            className={`label-caps-sm ${
                              actualYes ? "text-primary-container" : "text-error"
                            }`}
                          >
                            {actualYes ? "UP" : "DOWN"}
                          </span>
                        </td>
                        <td className="py-2.5 pr-4">
                          {!hasModel ? (
                            <span className="label-caps-sm text-on-surface-variant/40">
                              UNMODELED
                            </span>
                          ) : p.prediction_correct == null ? (
                            <span className="label-caps-sm text-on-surface-variant/40">
                              —
                            </span>
                          ) : (
                            <StatusBadge
                              status={isCorrect ? "correct" : "wrong"}
                            />
                          )}
                        </td>
                        <td className="tabular py-2.5 pr-4 text-[13px] text-on-surface-variant">
                          {pct(p.probability)}
                        </td>
                        <td className="tabular py-2.5 pr-4 text-[13px] text-on-surface-variant">
                          {p.brier_score != null ? p.brier_score.toFixed(2) : "—"}
                        </td>
                        <td className="tabular py-2.5 pr-4 text-xs text-on-surface-variant">
                          {usd(p.actual_price)}
                        </td>
                        <td className="label-caps-sm py-2.5 pr-5 text-on-surface-variant/70">
                          {p.resolved_at ? timeAgo(p.resolved_at).toUpperCase() : "--"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
