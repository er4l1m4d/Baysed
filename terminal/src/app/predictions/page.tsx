"use client";

import { Fragment, useMemo, useState } from "react";
import { usePredictions } from "@/hooks/useBayseData";
import type { Prediction } from "@/lib/api";
import {
  Card,
  CardHeader,
  PillToggle,
  StatusBadge,
  EmptyState,
} from "@/components/ui";

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

function Detail({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex justify-between gap-3 py-1">
      <span className="label-caps-sm text-on-surface-variant/70">{label}</span>
      <span className="tabular text-[13px] font-medium text-on-surface-variant">
        {children}
      </span>
    </div>
  );
}

function DetailGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <h4 className="label-caps-sm mb-2 text-primary-container">{title}</h4>
      {children}
    </div>
  );
}

function ExpandedDetail({ pred }: { pred: Prediction }) {
  return (
    <tr className="border-b border-border-subtle bg-surface-container-lowest/60">
      <td colSpan={9} className="px-5 py-4">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <DetailGroup title="Decision">
            <Detail label="Pick">
              {pred.predicted_outcome === "YES"
                ? "UP"
                : pred.predicted_outcome === "NO"
                  ? "DOWN"
                  : "—"}
            </Detail>
            <Detail label="Probability">{pct(pred.probability)}</Detail>
            <Detail label="Signal strength">
              {pred.signal_strength.toFixed(3)}
            </Detail>
            <Detail label="Approved">{pred.approved ? "Yes" : "No"}</Detail>
            {pred.reasons && pred.reasons.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-2">
                {pred.reasons.map((r, i) => (
                  <span
                    key={i}
                    className="label-caps-sm rounded-sm border border-border-subtle bg-surface-container px-2 py-1 text-on-surface-variant"
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
            <Detail label="Realized vol">
              {pred.realized_volatility.toFixed(4)}%
            </Detail>
            <Detail label="Momentum">{pred.momentum_pct.toFixed(4)}%</Detail>
            <Detail label="Ask Y / N">
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
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-on-surface">
          Predictions
        </h1>
        <p className="mt-1.5 text-sm text-on-surface-variant">
          Every snapshot the engine has recorded. Click a row for full context.
        </p>
      </div>

      <Card>
        <CardHeader
          title="Snapshot History"
          subtitle={`${rows.length} snapshots${filter !== "All" ? ` · ${filter.toLowerCase()}` : ""}`}
          icon="query_stats"
          actions={<PillToggle options={FILTERS} value={filter} onChange={setFilter} />}
        />

        <div className="py-1">
          {loading ? (
            <div className="space-y-2 px-5 py-3">
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
              <table className="w-full text-left">
                <thead>
                  <tr className="label-caps-sm border-b border-border-subtle bg-surface-container-low text-on-surface-variant">
                    <th className="py-2.5 pl-5 pr-4 font-medium">Market</th>
                    <th className="py-2.5 pr-4 font-medium">Time</th>
                    <th className="py-2.5 pr-4 font-medium">Pick</th>
                    <th className="py-2.5 pr-4 font-medium">Prob</th>
                    <th className="py-2.5 pr-4 font-medium">Edge</th>
                    <th className="py-2.5 pr-4 font-medium">Strike / BTC</th>
                    <th className="py-2.5 pr-4 font-medium">Left</th>
                    <th className="py-2.5 pr-4 font-medium">Result</th>
                    <th className="w-6 py-2.5 pr-5" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((pred) => {
                    const hasModel = pred.probability != null;
                    const isPending = pred.outcome_resolution === "pending";
                    const isCorrect = pred.prediction_correct === true;
                    const expanded = expandedId === pred.id;
                    return (
                      <Fragment key={pred.id}>
                        <tr
                          onClick={() => setExpandedId(expanded ? null : pred.id)}
                          className="cursor-pointer border-b border-border-subtle/60 transition-colors hover:bg-surface-container-low/70"
                        >
                          <td className="label-caps py-2.5 pl-5 pr-4 text-[12px] text-on-surface">
                            {marketLabel(pred)}
                          </td>
                          <td className="tabular py-2.5 pr-4 text-xs text-on-surface-variant">
                            {new Date(pred.recorded_at).toLocaleTimeString()}
                          </td>
                          <td className="py-2.5 pr-4">
                            {hasModel ? (
                              <span
                                className={`label-caps-sm ${
                                  pred.predicted_outcome === "YES"
                                    ? "text-primary-container"
                                    : "text-error"
                                }`}
                              >
                                {pred.predicted_outcome === "YES" ? "UP" : "DOWN"}
                              </span>
                            ) : (
                              <span className="label-caps-sm text-on-surface-variant/40">
                                WARMUP
                              </span>
                            )}
                          </td>
                          <td className="tabular py-2.5 pr-4 text-[13px] text-on-surface-variant">
                            {pct(pred.probability)}
                          </td>
                          <td
                            className={`tabular py-2.5 pr-4 text-[13px] ${
                              pred.edge == null
                                ? "text-on-surface-variant/40"
                                : pred.edge > 0
                                  ? "text-primary-container"
                                  : "text-error"
                            }`}
                          >
                            {signed(pred.edge, 3)}
                          </td>
                          <td className="tabular py-2.5 pr-4 text-xs text-on-surface-variant">
                            ${pred.strike_price.toLocaleString()} / $
                            {pred.current_btc_price.toLocaleString()}
                          </td>
                          <td className="tabular py-2.5 pr-4 text-xs text-on-surface-variant">
                            {mmss(pred.seconds_remaining)}
                          </td>
                          <td className="py-2.5 pr-4">
                            {isPending ? (
                              <StatusBadge status="pending" />
                            ) : !hasModel ? (
                              <span className="label-caps-sm text-on-surface-variant/40">
                                UNMODELED
                              </span>
                            ) : (
                              <StatusBadge
                                status={isCorrect ? "correct" : "wrong"}
                              />
                            )}
                          </td>
                          <td className="py-2.5 pr-5 text-right text-[10px] text-on-surface-variant/50">
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
