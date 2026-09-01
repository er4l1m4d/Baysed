"use client";

import { Fragment, useMemo, useState } from "react";
import { usePredictions } from "@/hooks/useBayseData";
import type { Prediction } from "@/lib/api";
import { Card, CardHeader, PillToggle, EmptyState } from "@/components/ui";
import { IconCheck, IconX } from "@/components/Icons";

const FILTERS = ["All", "Pending", "Resolved"] as const;
type Filter = (typeof FILTERS)[number];

const usd = (v: number | null | undefined) =>
  v != null
    ? `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : "--";

const pct = (v: number | null | undefined, digits = 1) =>
  v != null ? `${(v * 100).toFixed(digits)}%` : "--";

function signed(v: number | null | undefined, digits = 2) {
  if (v == null) return "--";
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)}`;
}

function marketLabel(p: Prediction) {
  if (p.closes_at) {
    const d = new Date(p.closes_at);
    return `BTC ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  return "BTC";
}

const mmss = (s: number | null | undefined) =>
  s == null
    ? "--"
    : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 text-[13px]">
      <span className="text-zinc-500">{label}</span>
      <span className="tabular font-medium text-zinc-200">{children}</span>
    </div>
  );
}

function DetailGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h4 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
        {title}
      </h4>
      {children}
    </div>
  );
}

function ExpandedDetail({ pred }: { pred: Prediction }) {
  return (
    <tr className="border-b border-zinc-800 bg-zinc-950/50">
      <td colSpan={9} className="px-5 py-4">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <DetailGroup title="Decision">
            <Detail label="Pick">
              {pred.predicted_outcome || "—"}
            </Detail>
            <Detail label="Probability">{pct(pred.probability)}</Detail>
            <Detail label="Signal strength">{pred.signal_strength.toFixed(3)}</Detail>
            <Detail label="Approved">{pred.approved ? "Yes" : "No"}</Detail>
            {pred.reasons && pred.reasons.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {pred.reasons.map((r, i) => (
                  <span
                    key={i}
                    className="rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400"
                  >
                    {r}
                  </span>
                ))}
              </div>
            )}
          </DetailGroup>

          <DetailGroup title="Market Window">
            <Detail label="Opened">
              {pred.opened_at ? new Date(pred.opened_at).toLocaleTimeString() : "--"}
            </Detail>
            <Detail label="Closes">
              {pred.closes_at ? new Date(pred.closes_at).toLocaleTimeString() : "--"}
            </Detail>
            <Detail label="Observed">
              {pred.observed_at ? new Date(pred.observed_at).toLocaleTimeString() : "--"}
            </Detail>
            <Detail label="Elapsed">{mmss(pred.seconds_elapsed)}</Detail>
            <Detail label="Remaining">{mmss(pred.seconds_remaining)}</Detail>
          </DetailGroup>

          <DetailGroup title="BTC Context & Resolution">
            <Detail label="Distance from strike">
              {signed(pred.distance_from_strike_pct, 3)}%
            </Detail>
            <Detail label="Above strike">
              {pred.is_above_strike ? "Yes" : "No"}
            </Detail>
            <Detail label="Realized vol">{pred.realized_volatility.toFixed(4)}%</Detail>
            <Detail label="Momentum">{pred.momentum_pct.toFixed(4)}%</Detail>
            <Detail label="Yes / No ask">
              {pred.yes_ask?.toFixed(2) ?? "--"} / {pred.no_ask?.toFixed(2) ?? "--"}
            </Detail>
            <Detail label="Spread">{pred.spread?.toFixed(4) ?? "--"}</Detail>
            <Detail label="Brier">
              {pred.brier_score != null ? pred.brier_score.toFixed(4) : "—"}
            </Detail>
            {pred.model_version && (
              <Detail label="Model">{pred.model_version}</Detail>
            )}
          </DetailGroup>
        </div>
      </td>
    </tr>
  );
}

export default function PredictionsPage() {
  const [filter, setFilter] = useState<Filter>("All");
  const { predictions, loading } = usePredictions(100);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const rows = useMemo(() => {
    if (filter === "Pending")
      return predictions.filter((p) => p.outcome_resolution === "pending");
    if (filter === "Resolved")
      return predictions.filter((p) => p.outcome_resolution !== "pending");
    return predictions;
  }, [predictions, filter]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[28px] font-bold leading-tight text-white">Predictions</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Every snapshot the engine has recorded. Click a row for full context.
        </p>
      </div>

      <Card>
        <CardHeader
          title="Snapshot History"
          subtitle={`${rows.length} snapshots${filter !== "All" ? ` · ${filter.toLowerCase()}` : ""}`}
          actions={<PillToggle options={FILTERS} value={filter} onChange={setFilter} />}
        />

        <div className="mt-4 px-2 pb-3">
          {loading ? (
            <div className="space-y-2 px-3">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="skeleton h-11 w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              title={filter === "Pending" ? "No pending snapshots" : "No predictions yet"}
              hint="The bot records one snapshot per scan cycle while a market is live."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 text-[11px] uppercase tracking-wider text-zinc-500">
                    <th className="pb-2 pl-3 pr-4 font-semibold">Market</th>
                    <th className="pb-2 pr-4 font-semibold">Time</th>
                    <th className="pb-2 pr-4 font-semibold">Pick</th>
                    <th className="pb-2 pr-4 font-semibold">Prob</th>
                    <th className="pb-2 pr-4 font-semibold">Edge</th>
                    <th className="pb-2 pr-4 font-semibold">Strike / BTC</th>
                    <th className="pb-2 pr-4 font-semibold">Left</th>
                    <th className="pb-2 pr-4 font-semibold">Result</th>
                    <th className="pb-2 w-6" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {rows.map((pred) => {
                    const hasModel = pred.probability != null;
                    const isPending = pred.outcome_resolution === "pending";
                    const isCorrect = pred.prediction_correct === true;
                    const expanded = expandedId === pred.id;
                    return (
                      <Fragment key={pred.id}>
                        <tr
                          onClick={() => setExpandedId(expanded ? null : pred.id)}
                          className="cursor-pointer transition-colors hover:bg-zinc-800/30"
                        >
                          <td className="py-2.5 pl-3 pr-4 font-medium text-white">
                            {marketLabel(pred)}
                          </td>
                          <td className="tabular py-2.5 pr-4 text-xs text-zinc-400">
                            {new Date(pred.recorded_at).toLocaleTimeString()}
                          </td>
                          <td className="py-2.5 pr-4">
                            {hasModel ? (
                              <span
                                className={`text-xs font-semibold ${
                                  pred.predicted_outcome === "YES"
                                    ? "text-emerald-400"
                                    : "text-rose-400"
                                }`}
                              >
                                {pred.predicted_outcome === "YES" ? "UP" : "DOWN"}
                              </span>
                            ) : (
                              <span className="text-xs text-zinc-600">warmup</span>
                            )}
                          </td>
                          <td className="tabular py-2.5 pr-4 text-zinc-300">
                            {pct(pred.probability)}
                          </td>
                          <td
                            className={`tabular py-2.5 pr-4 ${
                              pred.edge == null
                                ? "text-zinc-600"
                                : pred.edge > 0
                                  ? "text-emerald-400"
                                  : "text-rose-400"
                            }`}
                          >
                            {signed(pred.edge, 3)}
                          </td>
                          <td className="tabular py-2.5 pr-4 text-xs text-zinc-400">
                            ${pred.strike_price.toLocaleString()} / $
                            {pred.current_btc_price.toLocaleString()}
                          </td>
                          <td className="tabular py-2.5 pr-4 text-zinc-400">
                            {mmss(pred.seconds_remaining)}
                          </td>
                          <td className="py-2.5 pr-4">
                            {isPending ? (
                              <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-400">
                                Pending
                              </span>
                            ) : !hasModel ? (
                              <span className="text-[11px] text-zinc-600">unmodeled</span>
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
                          <td className="py-2.5 pr-3 text-right text-[10px] text-zinc-600">
                            {expanded ? "▲" : "▼"}
                          </td>
                        </tr>
                        {expanded && <ExpandedDetail pred={pred} />}
                      </Fragment>
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
