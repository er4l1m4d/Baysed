"use client";

import { useMemo, useState } from "react";
import { usePredictions } from "@/hooks/useBayseData";
import type { Prediction } from "@/lib/api";
import { Card, CardHeader, StatCard, PillToggle, EmptyState } from "@/components/ui";
import { IconCheck, IconX } from "@/components/Icons";

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
        <h1 className="text-[28px] font-bold leading-tight text-white">Resolution</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Every snapshot scored against Bayse&apos;s canonical outcome.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Resolved Snapshots"
          value={String(resolved.length)}
          subtitle={`${modeled.length} with model probability`}
          loading={loading}
        />
        <StatCard
          label="Correct"
          value={String(correct.length)}
          subtitle={modeled.length > 0 ? pct(correct.length / modeled.length) : "--"}
          dot={modeled.length > 0 && correct.length / Math.max(1, modeled.length) >= 0.5 ? "green" : "red"}
          loading={loading}
        />
        <StatCard
          label="Wrong"
          value={String(wrong.length)}
          subtitle={modeled.length > 0 ? pct(wrong.length / modeled.length) : "--"}
          loading={loading}
        />
        <StatCard
          label="Brier Mean"
          value={brierMean != null ? brierMean.toFixed(4) : "--"}
          subtitle="Across resolved modeled snapshots"
          dot={brierMean != null && brierMean < 0.25 ? "green" : "red"}
          loading={loading}
        />
      </div>

      <Card>
        <CardHeader
          title="Resolution History"
          subtitle="Newest first · one row per snapshot"
          actions={<PillToggle options={RES_TABS} value={tab} onChange={setTab} />}
        />

        <div className="mt-4 px-5 pb-5">
          {loading ? (
            <div className="space-y-2">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="skeleton h-10 w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              title={tab === "All" ? "No resolutions yet" : `No ${tab.toLowerCase()} predictions`}
              hint="Markets resolve about a minute after their window closes."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 text-[11px] uppercase tracking-wider text-zinc-500">
                    <th className="pb-2 pr-4 font-semibold">Market</th>
                    <th className="pb-2 pr-4 font-semibold">Predicted</th>
                    <th className="pb-2 pr-4 font-semibold">Actual</th>
                    <th className="pb-2 pr-4 font-semibold">Result</th>
                    <th className="pb-2 pr-4 font-semibold">Prob</th>
                    <th className="pb-2 pr-4 font-semibold">Brier</th>
                    <th className="pb-2 pr-4 font-semibold">Close BTC</th>
                    <th className="pb-2 font-semibold">Resolved</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {rows.slice(0, 40).map((p) => {
                    const hasModel = p.probability != null;
                    const isCorrect = p.prediction_correct === true;
                    const actualYes = p.outcome_resolution === "yes_won";
                    return (
                      <tr key={p.id} className="transition-colors hover:bg-zinc-800/30">
                        <td className="py-2.5 pr-4 font-medium text-white">
                          {marketLabel(p)}
                        </td>
                        <td className="tabular py-2.5 pr-4 text-zinc-300">
                          {hasModel ? p.predicted_outcome || "--" : "—"}
                        </td>
                        <td className="py-2.5 pr-4">
                          <span
                            className={`text-xs font-semibold ${
                              actualYes ? "text-emerald-400" : "text-rose-400"
                            }`}
                          >
                            {actualYes ? "UP" : "DOWN"}
                          </span>
                        </td>
                        <td className="py-2.5 pr-4">
                          {!hasModel ? (
                            <span className="text-xs text-zinc-600">unmodeled</span>
                          ) : p.prediction_correct == null ? (
                            <span className="text-xs text-zinc-600">—</span>
                          ) : (
                            <span
                              className={`flex h-5 w-5 items-center justify-center rounded-full ${
                                isCorrect
                                  ? "bg-emerald-500/15 text-emerald-400"
                                  : "bg-rose-500/15 text-rose-400"
                              }`}
                            >
                              {isCorrect ? (
                                <IconCheck width={11} height={11} />
                              ) : (
                                <IconX width={11} height={11} />
                              )}
                            </span>
                          )}
                        </td>
                        <td className="tabular py-2.5 pr-4 text-zinc-300">
                          {pct(p.probability)}
                        </td>
                        <td className="tabular py-2.5 pr-4 text-zinc-400">
                          {p.brier_score != null ? p.brier_score.toFixed(2) : "—"}
                        </td>
                        <td className="tabular py-2.5 pr-4 text-zinc-400">
                          {usd(p.actual_price)}
                        </td>
                        <td className="py-2.5 text-xs text-zinc-500">
                          {p.resolved_at ? timeAgo(p.resolved_at) : "--"}
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
