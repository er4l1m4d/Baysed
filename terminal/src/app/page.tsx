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
import { Card, CardHeader, StatCard, PillToggle, OutcomePill, EmptyState } from "@/components/ui";
import { PerformanceCard } from "@/components/BrierChart";
import { IconArrowUp, IconArrowDown, IconCheck, IconX, IconClock } from "@/components/Icons";

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
        value={String(calibration?.total ?? 0)}
        subtitle={
          lastHour > 0
            ? `+${lastHour} in the last hour`
            : `strategy ${status?.strategy ?? "distance_to_strike"}`
        }
        dot={status?.is_running ? "green" : "red"}
        loading={loading}
      />
      <StatCard
        label="Accuracy"
        value={accuracy != null ? pct(accuracy) : "--"}
        subtitle={`${calibration?.correct ?? 0}/${calibration?.resolved ?? 0} correct`}
        dot={accuracy == null ? undefined : accuracy >= 0.5 ? "green" : "red"}
        loading={loading}
      />
      <StatCard
        label="Brier Mean"
        value={brier != null ? brier.toFixed(4) : "--"}
        subtitle="Lower is better"
        dot={brier == null ? undefined : brier < 0.25 ? "green" : "red"}
        loading={loading}
      />
      <StatCard
        label="Pending"
        value={String(calibration?.pending ?? 0)}
        subtitle="Awaiting resolution"
        dot="gold"
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
      <Card className="p-5">
        <h2 className="text-base font-semibold text-white">Live Market</h2>
        <EmptyState
          title="No active market"
          hint="The next 15-minute contract opens shortly."
        />
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

  const stats: { label: string; value: string; tone?: "up" | "down" | "gold" }[] = [
    { label: "Strike Price", value: usd(strike) },
    {
      label: "Current Price",
      value: usd(current),
      tone: distance == null ? undefined : distance >= 0 ? "up" : "down",
    },
    {
      label: "Distance",
      value: signed(distance, 3),
      tone: distance == null ? undefined : distance >= 0 ? "up" : "down",
    },
    { label: "Model P(Up)", value: pct(liveMarket.model_probability), tone: "gold" },
    { label: "Yes / No Ask", value: `${liveMarket.yes_ask?.toFixed(2) ?? "--"} / ${liveMarket.no_ask?.toFixed(2) ?? "--"}` },
    { label: "Time Remaining", value: remaining != null ? mmss(remaining) : "--" },
  ];

  return (
    <Card className="flex flex-col p-5">
      <h2 className="text-base font-semibold text-white">Live Market</h2>

      <p className="mt-4 text-lg font-medium text-white">
        BTC {strike != null ? (distance != null && distance >= 0 ? ">" : "≤") : ""}{" "}
        {usd(strike)}
      </p>
      <div
        className={`tabular mt-1 text-4xl font-bold leading-none ${
          distance == null ? "text-white" : distance >= 0 ? "text-emerald-400" : "text-rose-400"
        }`}
      >
        {usd(current)}
      </div>

      {/* Time-remaining progress */}
      <div className="mt-5">
        <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-amber-500 transition-[width] duration-1000 ease-linear"
            style={{ width: progress != null ? `${(1 - progress) * 100}%` : "0%" }}
          />
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[11px] text-zinc-500">
          <span className="flex items-center gap-1">
            <IconClock width={11} height={11} />
            {remaining != null ? mmss(remaining) : "--"} left
          </span>
          <span>closes {liveMarket.closes_at ? new Date(liveMarket.closes_at).toLocaleTimeString() : "--"}</span>
        </div>
      </div>

      {/* Stats */}
      <div className="mt-5 space-y-2.5">
        {stats.map((s) => (
          <div key={s.label} className="flex items-center justify-between text-[13px]">
            <span className="flex items-center gap-2 text-zinc-400">
              <span
                className={`h-2 w-2 rounded-full ${
                  s.tone === "up"
                    ? "bg-emerald-500"
                    : s.tone === "down"
                      ? "bg-rose-500"
                      : s.tone === "gold"
                        ? "bg-amber-500"
                        : "bg-zinc-600"
                }`}
              />
              {s.label}
            </span>
            <span className="tabular font-semibold text-white">{s.value}</span>
          </div>
        ))}
      </div>

      <Link
        href="/live-market"
        className="mt-6 flex h-10 items-center justify-center rounded-full bg-zinc-800 text-[13px] font-medium text-zinc-300 transition-colors duration-150 hover:bg-zinc-700 hover:text-white"
      >
        Explore Live Market →
      </Link>
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
        actions={<PillToggle options={SNAP_TABS} value={tab} onChange={setTab} />}
      />

      <div className="mt-4 px-2 pb-3">
        {loading ? (
          <div className="space-y-2 px-3">
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
                  className="flex items-center justify-between gap-4 border-b border-zinc-800 px-3 py-3 transition-colors duration-150 last:border-0 hover:bg-zinc-800/30"
                >
                  {/* Left: identity */}
                  <div className="flex min-w-0 items-center gap-2.5">
                    {p.probability != null ? (
                      up ? (
                        <IconArrowUp width={15} height={15} className="shrink-0 text-emerald-400" />
                      ) : (
                        <IconArrowDown width={15} height={15} className="shrink-0 text-rose-400" />
                      )
                    ) : (
                      <IconClock width={15} height={15} className="shrink-0 text-zinc-600" />
                    )}
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-white">
                        {marketLabel(p)}
                      </div>
                      <div className="text-[11px] text-zinc-500">
                        {isOpen
                          ? `seen ${p.recorded_at ? timeAgo(p.recorded_at) : "--"}`
                          : p.prediction_correct == null
                            ? "unmodeled snapshot"
                            : p.prediction_correct
                              ? "correct"
                              : "wrong"}
                      </div>
                    </div>
                  </div>

                  {/* Right: metrics */}
                  <div className="flex shrink-0 items-center gap-4">
                    <div className="text-right">
                      <div className="tabular text-sm font-semibold text-white">
                        {pct(p.probability)}
                      </div>
                      <div
                        className={`tabular text-[11px] ${
                          edge == null
                            ? "text-zinc-600"
                            : edge > 0
                              ? "text-emerald-400"
                              : "text-rose-400"
                        }`}
                      >
                        edge {signed(edge, 1)}
                      </div>
                    </div>
                    {p.probability != null && p.predicted_outcome ? (
                      <OutcomePill outcome={p.predicted_outcome as "YES" | "NO"} />
                    ) : (
                      <span className="inline-flex h-5 items-center rounded-full bg-zinc-800 px-2 text-[11px] text-zinc-500">
                        warmup
                      </span>
                    )}
                    <div className="tabular hidden w-10 text-right text-[13px] text-zinc-400 sm:block">
                      {p.brier_score != null ? p.brier_score.toFixed(2) : "--"}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="border-t border-zinc-800 px-5 py-3">
        <Link
          href="/predictions"
          className="text-[13px] font-medium text-amber-500 hover:text-amber-400 hover:underline"
        >
          View all predictions →
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
        actions={
          <Link
            href="/resolution"
            className="text-[13px] font-medium text-amber-500 hover:text-amber-400 hover:underline"
          >
            View All
          </Link>
        }
      />

      <div className="mt-3 px-5 pb-5">
        {loading ? (
          <div className="space-y-4">
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
          <ul className="divide-y divide-zinc-800">
            {resolved.map((p) => {
              const correct = p.prediction_correct === true;
              const actualYes = p.outcome_resolution === "yes_won";
              return (
                <li key={p.id} className="flex items-start gap-3 py-3.5">
                  <span
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                      correct
                        ? "bg-emerald-500/15 text-emerald-400"
                        : "bg-rose-500/15 text-rose-400"
                    }`}
                  >
                    {correct ? (
                      <IconCheck width={12} height={12} />
                    ) : (
                      <IconX width={12} height={12} />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-white">
                        {marketLabel(p)}
                      </span>
                      <span className="shrink-0 text-[11px] text-zinc-500">
                        {timeAgo(p.resolved_at!)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-3 text-xs text-zinc-400">
                      <span>
                        Predicted{" "}
                        <span className="font-medium text-zinc-200">
                          {p.predicted_outcome || "--"}
                        </span>
                      </span>
                      <span>
                        Actual{" "}
                        <span
                          className={`font-medium ${
                            actualYes ? "text-emerald-400" : "text-rose-400"
                          }`}
                        >
                          {actualYes ? "UP" : "DOWN"}
                        </span>
                      </span>
                    </div>
                  </div>
                  <div className="tabular shrink-0 text-right">
                    <div className="text-[13px] font-semibold text-zinc-200">
                      {p.brier_score != null ? p.brier_score.toFixed(2) : "--"}
                    </div>
                    <div className="text-[10px] text-zinc-500">brier</div>
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
      <div>
        <h1 className="text-[28px] font-bold leading-tight text-white">
          Overview
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Observation Run 001 — model health, live market and resolution quality.
        </p>
      </div>

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
