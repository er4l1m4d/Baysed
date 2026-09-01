"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  useBotStatus,
  useCalibration,
  useLiveMarketState,
  useLivePrice,
  usePredictions,
} from "@/hooks/useBayseData";
import type { Prediction } from "@/lib/api";
import {
  Card,
  CardHeader,
  StatCard,
  PillToggle,
  OutcomePill,
  StatusBadge,
  EmptyState,
} from "@/components/ui";
import { PerformanceCard } from "@/components/BrierChart";

const usd = (v: number | null | undefined) =>
  v != null
    ? `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : "--";

const pct = (v: number | null | undefined, digits = 1) =>
  v != null ? `${(v * 100).toFixed(digits)}%` : "--";

function signed(v: number | null | undefined, digits = 2) {
  if (v == null) return "--";
  return `${v > 0 ? "+" : ""}${(v * 100).toFixed(digits)}%`;
}

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

function PageHeader() {
  return (
    <div>
      <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-on-surface">
        Overview
      </h1>
      <p className="mt-1.5 text-sm text-on-surface-variant">
        Observation Run 001 — engine health, live market and resolution quality.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Summary cards                                                       */
/* ------------------------------------------------------------------ */

function StatsRow() {
  const { calibration, loading } = useCalibration();
  const { predictions } = usePredictions(100);
  const { status } = useBotStatus();

  const lastHour = useMemo(() => {
    const cutoff = Date.now() - 3600 * 1000;
    return predictions.filter((p) => new Date(p.recorded_at).getTime() >= cutoff)
      .length;
  }, [predictions]);

  const accuracy = calibration?.accuracy ?? null;
  const brier = calibration?.brier_mean ?? null;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        label="Total Predictions"
        icon="query_stats"
        value={String(calibration?.total ?? 0)}
        subtitle={
          lastHour > 0
            ? `+${lastHour} in the last hour`
            : `strat ${status?.strategy ?? "distance_to_strike"}`
        }
        tone={status?.is_running ? "green" : "red"}
        loading={loading}
      />
      <StatCard
        label="Accuracy"
        icon="target"
        value={accuracy != null ? pct(accuracy) : "--"}
        subtitle={`${calibration?.correct ?? 0}/${calibration?.resolved ?? 0} correct`}
        tone={accuracy == null ? "neutral" : accuracy >= 0.5 ? "green" : "red"}
        loading={loading}
      />
      <StatCard
        label="Brier Mean"
        icon="functions"
        value={brier != null ? brier.toFixed(4) : "--"}
        subtitle="Lower is better"
        tone={brier == null ? "neutral" : brier < 0.25 ? "green" : "red"}
        loading={loading}
      />
      <StatCard
        label="Pending"
        icon="schedule"
        value={String(calibration?.pending ?? 0)}
        subtitle="Awaiting resolution"
        tone="gold"
        loading={loading}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Live market                                                         */
/* ------------------------------------------------------------------ */

function LiveMarketCard() {
  const { liveMarket, loading } = useLiveMarketState();
  const { price } = useLivePrice();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (loading) {
    return (
      <Card className="p-5">
        <div className="skeleton h-5 w-28" />
        <div className="skeleton mt-4 h-9 w-44" />
        <div className="skeleton mt-6 h-2 w-full" />
        <div className="mt-6 space-y-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="skeleton h-4 w-full" />
          ))}
        </div>
      </Card>
    );
  }

  if (!liveMarket || !liveMarket.is_active) {
    return (
      <Card>
        <CardHeader title="Live Market" icon="show_chart" />
        <div className="px-5 py-4">
          <EmptyState
            title="No active market"
            hint="The next 15-minute contract opens shortly."
            icon="candlestick_chart"
          />
        </div>
      </Card>
    );
  }

  const strike = liveMarket.strike_price;
  const current = price ?? liveMarket.btc_price;
  const distance =
    strike != null && current != null ? (current - strike) / strike : null;

  const opens = liveMarket.opens_at ? new Date(liveMarket.opens_at).getTime() : null;
  const closes = liveMarket.closes_at ? new Date(liveMarket.closes_at).getTime() : null;
  const remaining =
    closes != null ? Math.max(0, Math.floor((closes - now) / 1000)) : null;
  const progress =
    opens != null && closes != null && closes > opens
      ? Math.min(1, Math.max(0, (now - opens) / (closes - opens)))
      : null;

  const mmss = (s: number) =>
    `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  const stats: {
    label: string;
    value: string;
    tone?: "up" | "down" | "gold";
  }[] = [
    { label: "Strike", value: usd(strike) },
    {
      label: "Distance",
      value: signed(distance, 3),
      tone: distance == null ? undefined : distance >= 0 ? "up" : "down",
    },
    { label: "Model P(Up)", value: pct(liveMarket.model_probability), tone: "gold" },
    {
      label: "Ask Y / N",
      value: `${liveMarket.yes_ask?.toFixed(2) ?? "--"} / ${liveMarket.no_ask?.toFixed(2) ?? "--"}`,
    },
  ];

  return (
    <Card className="flex flex-col">
      <CardHeader
        title="Live Market"
        icon="show_chart"
        actions={
          <span className="label-caps-sm flex items-center gap-1.5 rounded-full border border-primary-container/30 bg-primary-container/10 px-2 py-1 text-primary-container">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary-container" />
            LIVE
          </span>
        }
      />

      <div className="px-5 pt-4">
        <p className="label-caps text-on-surface-variant/70">
          BTC {strike != null ? (distance != null && distance >= 0 ? ">" : "≤") : ""}{" "}
          {usd(strike)}
        </p>
        <div
          className={`tabular mt-1.5 text-[32px] font-semibold leading-none tracking-tight ${
            distance == null
              ? "text-on-surface"
              : distance >= 0
                ? "text-primary-container neon-glow"
                : "text-error"
          }`}
        >
          {usd(current)}
        </div>
      </div>

      {/* Time-remaining progress */}
      <div className="mt-5 px-5">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-bright">
          <div
            className="progress-bar-striped h-full bg-primary-container transition-[width] duration-1000 ease-linear"
            style={{ width: progress != null ? `${(1 - progress) * 100}%` : "0%" }}
          />
        </div>
        <div className="label-caps-sm mt-1.5 flex items-center justify-between text-on-surface-variant">
          <span className="flex items-center gap-1 text-primary-container">
            <span className="material-symbols-outlined text-[12px]">schedule</span>
            {remaining != null ? mmss(remaining) : "--"} LEFT
          </span>
          <span>
            CLOSES{" "}
            {liveMarket.closes_at
              ? new Date(liveMarket.closes_at).toLocaleTimeString()
              : "--"}
          </span>
        </div>
      </div>

      {/* Stats */}
      <div className="mt-4 flex-1 space-y-0 px-5">
        {stats.map((s) => (
          <div
            key={s.label}
            className="flex items-center justify-between border-b border-border-subtle/60 py-2 last:border-0"
          >
            <span className="label-caps-sm flex items-center gap-2 text-on-surface-variant">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  s.tone === "up"
                    ? "bg-primary-container"
                    : s.tone === "down"
                      ? "bg-error"
                      : s.tone === "gold"
                        ? "bg-warning-gold"
                        : "bg-surface-bright"
                }`}
              />
              {s.label}
            </span>
            <span
              className={`tabular text-[13px] font-semibold ${
                s.tone === "up"
                  ? "text-primary-container"
                  : s.tone === "down"
                    ? "text-error"
                    : "text-on-surface"
              }`}
            >
              {s.value}
            </span>
          </div>
        ))}
      </div>

      <div className="p-5">
        <Link
          href="/live-market"
          className="label-caps flex h-10 items-center justify-center rounded-lg border border-border-subtle bg-surface-bright/30 text-on-surface transition-all duration-150 hover:border-primary-container/40 hover:bg-surface-bright/50 hover:text-primary-container"
        >
          Explore Live Market →
        </Link>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Observation snapshots                                               */
/* ------------------------------------------------------------------ */

const SNAP_TABS = ["Open", "Closed", "All"] as const;
type SnapTab = (typeof SNAP_TABS)[number];

function ObservationSnapshots() {
  const [tab, setTab] = useState<SnapTab>("Open");
  const { predictions, loading } = usePredictions(30);

  const rows = useMemo(() => {
    if (tab === "Open") return predictions.filter((p) => p.outcome_resolution === "pending");
    if (tab === "Closed") return predictions.filter((p) => p.outcome_resolution !== "pending");
    return predictions;
  }, [predictions, tab]);

  return (
    <Card>
      <CardHeader
        title="Observation Snapshots"
        subtitle="Model predictions and outcomes per market window"
        icon="layers"
        actions={<PillToggle options={SNAP_TABS} value={tab} onChange={setTab} />}
      />

      <div className="py-1">
        {loading ? (
          <div className="space-y-2 px-5 py-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="skeleton h-12 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title={tab === "Open" ? "No open snapshots" : "No snapshots yet"}
            hint="The bot records a snapshot every scan cycle while a market is live."
          />
        ) : (
          <ul>
            {rows.slice(0, 8).map((p) => {
              const isOpen = p.outcome_resolution === "pending";
              const up = p.predicted_outcome === "YES";
              const edge = p.edge;
              return (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-4 border-b border-border-subtle/60 px-5 py-3 transition-colors duration-150 last:border-0 hover:bg-surface-container-low/60"
                >
                  {/* Left: identity */}
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      className={`material-symbols-outlined text-[16px] ${
                        p.probability == null
                          ? "text-on-surface-variant/40"
                          : up
                            ? "text-primary-container"
                            : "text-error"
                      }`}
                    >
                      {p.probability == null
                        ? "schedule"
                        : up
                          ? "trending_up"
                          : "trending_down"}
                    </span>
                    <div className="min-w-0">
                      <div className="label-caps text-[12px] text-on-surface">
                        {marketLabel(p)}
                      </div>
                      <div className="label-caps-sm mt-1 text-on-surface-variant/70">
                        {isOpen
                          ? `SEEN ${p.recorded_at ? timeAgo(p.recorded_at).toUpperCase() : "--"}`
                          : p.prediction_correct == null
                            ? "UNMODELED"
                            : p.prediction_correct
                              ? "CORRECT"
                              : "WRONG"}
                      </div>
                    </div>
                  </div>

                  {/* Right: metrics */}
                  <div className="flex shrink-0 items-center gap-4">
                    <div className="text-right">
                      <div className="tabular text-sm font-semibold text-on-surface">
                        {pct(p.probability)}
                      </div>
                      <div
                        className={`label-caps-sm tabular mt-0.5 ${
                          edge == null
                            ? "text-on-surface-variant/40"
                            : edge > 0
                              ? "text-primary-container"
                              : "text-error"
                        }`}
                      >
                        EDGE {signed(edge, 1)}
                      </div>
                    </div>
                    {p.probability != null && p.predicted_outcome ? (
                      <OutcomePill outcome={p.predicted_outcome as "YES" | "NO"} />
                    ) : (
                      <span className="label-caps-sm inline-flex h-5 items-center rounded-sm border border-border-subtle bg-surface-container px-2 text-on-surface-variant/60">
                        WARMUP
                      </span>
                    )}
                    <div className="tabular hidden w-10 text-right text-[13px] text-on-surface-variant sm:block">
                      {p.brier_score != null ? p.brier_score.toFixed(2) : "--"}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="border-t border-border-subtle px-5 py-3">
        <Link
          href="/predictions"
          className="label-caps text-primary-container transition-colors hover:text-primary-fixed-dim"
        >
          View All Predictions →
        </Link>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Resolution feed                                                     */
/* ------------------------------------------------------------------ */

function ResolutionFeed() {
  const { predictions, loading } = usePredictions(100);

  const resolved = useMemo(
    () =>
      predictions
        .filter(
          (p) =>
            p.outcome_resolution !== "pending" &&
            p.probability != null &&
            p.resolved_at != null
        )
        .sort(
          (a, b) =>
            new Date(b.resolved_at!).getTime() - new Date(a.resolved_at!).getTime()
        )
        .slice(0, 5),
    [predictions]
  );

  return (
    <Card>
      <CardHeader
        title="Resolution Feed"
        icon="fact_check"
        actions={
          <Link
            href="/resolution"
            className="label-caps text-primary-container transition-colors hover:text-primary-fixed-dim"
          >
            View All
          </Link>
        }
      />

      <div className="px-5 py-2">
        {loading ? (
          <div className="space-y-4 py-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="skeleton h-16 w-full" />
            ))}
          </div>
        ) : resolved.length === 0 ? (
          <EmptyState
            title="No resolved predictions yet"
            hint="Markets resolve ~1 minute after their 15-minute window closes."
          />
        ) : (
          <ul>
            {resolved.map((p) => {
              const correct = p.prediction_correct === true;
              const actualYes = p.outcome_resolution === "yes_won";
              return (
                <li
                  key={p.id}
                  className="flex items-start gap-3 border-b border-border-subtle/60 py-3.5 last:border-0"
                >
                  <span
                    className={`material-symbols-outlined ms-fill mt-0.5 text-[16px] ${
                      correct ? "text-primary-container" : "text-error"
                    }`}
                  >
                    {correct ? "check_circle" : "cancel"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="label-caps text-[12px] text-on-surface">
                        {marketLabel(p)}
                      </span>
                      <span className="label-caps-sm shrink-0 text-on-surface-variant/70">
                        {timeAgo(p.resolved_at!).toUpperCase()}
                      </span>
                    </div>
                    <div className="label-caps-sm mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-on-surface-variant">
                      <span>
                        PRED{" "}
                        <span className="font-semibold text-on-surface-variant">
                          {p.predicted_outcome === "YES" ? "UP" : "DOWN"}
                        </span>
                      </span>
                      <span>
                        ACTUAL{" "}
                        <span
                          className={`font-semibold ${
                            actualYes ? "text-primary-container" : "text-error"
                          }`}
                        >
                          {actualYes ? "UP" : "DOWN"}
                        </span>
                      </span>
                    </div>
                  </div>
                  <div className="tabular shrink-0 text-right">
                    <div className="text-[13px] font-semibold text-on-surface">
                      {p.brier_score != null ? p.brier_score.toFixed(2) : "--"}
                    </div>
                    <div className="label-caps-sm text-on-surface-variant/60">
                      BRIER
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function OverviewPage() {
  return (
    <div className="space-y-6">
      <PageHeader />

      <StatsRow />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <PerformanceCard />
        </div>
        <div className="lg:col-span-2">
          <LiveMarketCard />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <ObservationSnapshots />
        </div>
        <div className="lg:col-span-2">
          <ResolutionFeed />
        </div>
      </div>
    </div>
  );
}
