"use client";

import { useMemo, useState } from "react";
import { usePredictionsBatch } from "@/hooks/useBayseData";
import {
  Card,
  CardHeader,
  StatCard,
  PillToggle,
  EmptyState,
} from "@/components/ui";
import {
  Histogram,
  Timeseries,
  HBarChart,
  ChartCard,
  type HistBin,
  type SeriesPoint,
} from "@/components/charts";
import type { Prediction } from "@/lib/api";

const pct = (v: number | null | undefined, d = 1) =>
  v != null ? `${(v * 100).toFixed(d)}%` : "--";

function mean(a: number[]) {
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
}
function std(a: number[]) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)) * (a.length / (a.length - 1)));
}
function binExecEdge(edges: number[]): HistBin[] {
  const lo = -0.15,
    hi = 0.2,
    n = 35;
  const step = (hi - lo) / n;
  const bins: HistBin[] = Array.from({ length: n }, (_, i) => ({
    x0: lo + i * step,
    x1: lo + (i + 1) * step,
    count: 0,
    tone: "neutral",
  }));
  for (const e of edges) {
    if (e == null) continue;
    let idx = Math.floor((e - lo) / step);
    if (idx < 0) idx = 0;
    if (idx >= n) idx = n - 1;
    bins[idx].count++;
    bins[idx].tone = e > 0 ? "pos" : "neg";
  }
  return bins;
}
function timeBuckets(
  rows: { ts: number; value: number }[],
  nBuckets = 120
): SeriesPoint[] {
  if (rows.length === 0) return [];
  const tsMin = rows[0].ts;
  const tsMax = rows[rows.length - 1].ts;
  const span = tsMax - tsMin || 1;
  const buckets: { sum: number; n: number; ts: number }[] = Array.from(
    { length: nBuckets },
    (_, i) => ({ sum: 0, n: 0, ts: tsMin + (span * (i + 0.5)) / nBuckets })
  );
  for (const r of rows) {
    let idx = Math.floor(((r.ts - tsMin) / span) * nBuckets);
    if (idx < 0) idx = 0;
    if (idx >= nBuckets) idx = nBuckets - 1;
    buckets[idx].sum += r.value;
    buckets[idx].n++;
  }
  return buckets
    .filter((b) => b.n > 0)
    .map((b) => ({ ts: b.ts, value: b.sum / b.n }));
}

export default function AnalyticsPage() {
  const { predictions, loading, lastUpdated } = usePredictionsBatch(3000);
  const [scope, setScope] = useState<"all" | "resolved">("all");

  const all = useMemo(
    () =>
      predictions
        .filter((p) => p.exec_edge != null || p.p_calibrated != null)
        .sort(
          (a, b) =>
            new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
        ),
    [predictions]
  );
  const resolved = useMemo(
    () =>
      all.filter(
        (p) =>
          p.outcome_resolution !== "pending" &&
          p.probability != null &&
          p.prediction_correct != null
      ),
    [all]
  );

  const baseData = scope === "resolved" && resolved.length > 0 ? resolved : all;

  const stats = useMemo(() => {
    const edges = baseData.map((p) => p.exec_edge).filter((e): e is number => e != null);
    const positive = edges.filter((e) => e > 0).length;
    const inBand = edges.filter((e) => e > 0.02 && e < 0.15).length;
    const median = edges.length
      ? [...edges].sort((a, b) => a - b)[Math.floor(edges.length / 2)]
      : NaN;
    const approved = resolved.filter((p) => p.approved).length;
    const gateVersions = new Set(all.map((p) => p.gate_version).filter(Boolean));
    return {
      n: all.length,
      median,
      positiveShare: edges.length ? positive / edges.length : 0,
      inBandShare: edges.length ? inBand / edges.length : 0,
      approved,
      resolvedN: resolved.length,
      gateVersions: [...gateVersions],
    };
  }, [baseData, resolved]);

  // Exec-edge histogram
  const hist = useMemo(
    () =>
      binExecEdge(
        baseData.map((p) => p.exec_edge).filter((e): e is number => e != null)
      ),
    [baseData]
  );

  // Timeseries: exec_edge + calibrated probability
  const tsExec = useMemo(
    () =>
      timeBuckets(
        baseData.filter((p) => p.exec_edge != null).map((p) => ({
          ts: new Date(p.recorded_at).getTime(),
          value: p.exec_edge!,
        }))
      ),
    [baseData]
  );
  const tsCal = useMemo(
    () =>
      timeBuckets(
        baseData.filter((p) => p.p_calibrated != null).map((p) => ({
          ts: new Date(p.recorded_at).getTime(),
          value: p.p_calibrated!,
        }))
      ),
    [baseData]
  );

  // Selectivity: approved vs rejected accuracy (resolved only)
  const selectivity = useMemo(() => {
    const acc = (rows: Prediction[]) =>
      rows.length ? mean(rows.map((p) => (p.prediction_correct ? 1 : 0))) : NaN;
    const appr = resolved.filter((p) => p.approved);
    const rej = resolved.filter((p) => !p.approved);
    // market-level paired t-stat: per-market approved - rejected accuracy
    const byMkt = new Map<string, { a: number[]; j: number[] }>();
    for (const p of resolved) {
      if (!byMkt.has(p.market_id)) byMkt.set(p.market_id, { a: [], j: [] });
      const m = byMkt.get(p.market_id)!;
      (p.approved ? m.a : m.j).push(p.prediction_correct ? 1 : 0);
    }
    const diffs: number[] = [];
    for (const { a, j } of byMkt.values()) {
      if (a.length >= 1 && j.length >= 5) {
        diffs.push(mean(a) - mean(j));
      }
    }
    const t =
      diffs.length >= 10
        ? mean(diffs) / (std(diffs) / Math.sqrt(diffs.length))
        : NaN;
    return {
      apprAcc: acc(appr),
      rejAcc: acc(rej),
      apprN: appr.length,
      rejN: rej.length,
      t,
      pairedMarkets: diffs.length,
    };
  }, [resolved]);

  // Time-of-day cuts (UTC hour) on resolved
  const hourCuts = useMemo(() => {
    const buckets = new Map<number, { n: number; c: number[]; e: number[] }>();
    for (const p of resolved) {
      const h = new Date(p.recorded_at).getUTCHours();
      if (!buckets.has(h)) buckets.set(h, { n: 0, c: [], e: [] });
      const b = buckets.get(h)!;
      b.n++;
      b.c.push(p.prediction_correct ? 1 : 0);
      if (p.exec_edge != null) b.e.push(p.exec_edge);
    }
    return [...buckets.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([h, b]) => ({
        label: `${String(h).padStart(2, "0")}:00`,
        value: mean(b.c),
        sub: `n=${b.n}`,
        tone: (mean(b.c) >= 0.5 ? "pos" : "neg") as "pos" | "neg",
      }));
  }, [resolved]);

  // Calibration gap by probability bucket (resolved)
  const calGap = useMemo(() => {
    const buckets: { sumP: number; sumA: number; n: number }[] = Array.from(
      { length: 10 },
      () => ({ sumP: 0, sumA: 0, n: 0 })
    );
    for (const p of resolved) {
      const b = Math.min(9, Math.max(0, Math.floor((p.probability ?? 0) * 10)));
      buckets[b].sumP += p.probability ?? 0;
      buckets[b].sumA += p.prediction_correct ? 1 : 0;
      buckets[b].n++;
    }
    return buckets
      .map((b, i) => {
        const gap = b.n >= 20 ? b.sumP / b.n - b.sumA / b.n : NaN;
        return {
          label: `${(i * 10).toString().padStart(2, "0")}-${((i + 1) * 10)
            .toString()
            .padStart(2, "0")}%`,
          value: gap,
          sub: `n=${b.n}`,
          tone: (gap > 0 ? "neg" : gap < 0 ? "pos" : "neutral") as "pos" | "neg" | "neutral",
        };
      })
      .filter((x) => !Number.isNaN(x.value));
  }, [resolved]);

  // Baseline ladder: accuracy by probability bucket
  const ladder = useMemo(() => {
    const buckets: { c: number[] }[] = Array.from({ length: 10 }, () => ({
      c: [],
    }));
    for (const p of resolved) {
      const b = Math.min(9, Math.max(0, Math.floor((p.probability ?? 0) * 10)));
      buckets[b].c.push(p.prediction_correct ? 1 : 0);
    }
    return buckets
      .map((b, i) => ({
        label: `${(i * 10).toString().padStart(2, "0")}-${((i + 1) * 10)
          .toString()
          .padStart(2, "0")}%`,
        value: b.c.length ? mean(b.c) : NaN,
        sub: `n=${b.c.length}`,
        tone: (b.c.length && mean(b.c) >= 0.5 ? "pos" : "neg") as "pos" | "neg",
      }))
      .filter((x) => !Number.isNaN(x.value));
  }, [resolved]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-on-surface">
            Research Analytics
          </h1>
          <p className="mt-1.5 text-sm text-on-surface-variant">
            Executable-edge distribution, selectivity, and calibration — the
            Run 002 measurement surface.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <PillToggle
            options={["all", "resolved"] as const}
            value={scope}
            onChange={setScope}
          />
          {lastUpdated && (
            <span className="label-caps-sm text-on-surface-variant/60">
              upd {lastUpdated.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Snapshots measured"
          icon="query_stats"
          value={stats.n.toLocaleString()}
          subtitle={`gate ${stats.gateVersions.join(",") || "—"} · n=${stats.resolvedN} resolved`}
          loading={loading}
        />
        <StatCard
          label="Median exec-edge"
          icon="bolt"
          value={Number.isNaN(stats.median) ? "--" : stats.median.toFixed(4)}
          subtitle="P(cal) − breakeven − slippage · all snapshots"
          tone={stats.median > 0.02 ? "green" : "neutral"}
          loading={loading}
        />
        <StatCard
          label="Exec-edge > 0"
          icon="trending_up"
          value={pct(stats.positiveShare, 0)}
          subtitle="share of snapshots with any positive edge"
          tone={stats.positiveShare > 0.1 ? "gold" : "red"}
          loading={loading}
        />
        <StatCard
          label="In approvable band"
          icon="filter_alt"
          value={pct(stats.inBandShare, 1)}
          subtitle="exec-edge ∈ (0.02, 0.15) — what the gate allows"
          tone={stats.inBandShare > 0.02 ? "green" : "red"}
          loading={loading}
        />
      </div>

      <ChartCard
        title="Executable-Edge Distribution"
        subtitle="Every snapshot's edge after fees + slippage. The green band is what the gate is allowed to approve."
        icon="bar_chart"
      >
        {loading ? (
          <div className="skeleton h-[200px] w-full" />
        ) : (
          <>
            <Histogram
              bins={hist}
              highlightThreshold={0.02}
              formatTick={(v) => v.toFixed(2)}
            />
            <div className="label-caps-sm mt-3 flex flex-wrap gap-4 text-on-surface-variant/70">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-primary-container/35" />{" "}
                edge &gt; 0
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-error/35" /> edge &lt; 0
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-2.5 bg-[#849588]" /> approvable band
                (0.02–0.15)
              </span>
            </div>
            <p className="label-caps-sm mt-3 leading-relaxed text-on-surface-variant/60">
              {stats.inBandShare < 0.02
                ? "Almost nothing falls in the approvable band — the gate correctly approves ~nothing. That is the Phase C verdict: no executable edge exists on Run 001 data."
                : "A meaningful share sits in the approvable band — worth watching for genuine signal."}
            </p>
          </>
        )}
      </ChartCard>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard
          title="Exec-Edge Over Time"
          subtitle="Mean executable edge per time bucket (live, from gate v2 recording)"
          icon="timeline"
        >
          {loading ? (
            <div className="skeleton h-[200px] w-full" />
          ) : (
            <Timeseries
              series={tsExec}
              baseline={0.02}
              color="#00ffa3"
              formatX={(ts) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            />
          )}
        </ChartCard>
        <ChartCard
          title="Calibrated P(yes) Over Time"
          subtitle="Model probability after calibration-discount, live"
          icon="timeline"
        >
          {loading ? (
            <div className="skeleton h-[200px] w-full" />
          ) : (
            <Timeseries
              series={tsCal}
              color="#facc15"
              yMin={0}
              yMax={1}
              formatX={(ts) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            />
          )}
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard
          title="Selectivity — Approved vs Rejected"
          subtitle="Does the gate pick the right ones? (resolved only)"
          icon="balance"
        >
          {resolved.length === 0 ? (
            <EmptyState title="No resolved snapshots yet" icon="balance" />
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <SelectivityStat
                  label="Approved acc"
                  value={selectivity.apprAcc}
                  n={selectivity.apprN}
                  tone="green"
                />
                <SelectivityStat
                  label="Rejected acc"
                  value={selectivity.rejAcc}
                  n={selectivity.rejN}
                  tone="neutral"
                />
              </div>
              <div className="rounded-lg border border-border-subtle bg-surface-container-low p-4">
                <div className="flex items-baseline justify-between">
                  <span className="label-caps-sm text-on-surface-variant">
                    Market-level paired t-stat
                  </span>
                  <span
                    className={`tabular text-[22px] font-semibold ${
                      Number.isNaN(selectivity.t)
                        ? "text-on-surface-variant/40"
                        : selectivity.t < -1.5
                        ? "text-error"
                        : selectivity.t > 1.5
                        ? "text-primary-container"
                        : "text-on-surface"
                    }`}
                  >
                    {Number.isNaN(selectivity.t) ? "--" : selectivity.t.toFixed(2)}
                  </span>
                </div>
                <p className="label-caps-sm mt-1.5 text-on-surface-variant/60">
                  n={selectivity.pairedMarkets} markets · t &lt; −1.5 = anti-selective
                  (rejected beat approved) · t &gt; 1.5 = gate adds value
                </p>
              </div>
              {selectivity.apprN < 5 && (
                <p className="label-caps-sm text-on-surface-variant/60">
                  Gate approving &lt; 5 snapshots — expected on current evidence.
                  Selectivity sharpens as Run 002 accrues approved trades.
                </p>
              )}
            </div>
          )}
        </ChartCard>

        <ChartCard
          title="Calibration Gap by Bucket"
          subtitle="Avg predicted − actual outcome rate. Negative = underconfident, positive = overconfident"
          icon="monitoring"
        >
          {resolved.length === 0 ? (
            <EmptyState title="No resolved snapshots yet" icon="monitoring" />
          ) : (
            <HBarChart
              items={calGap}
              formatValue={(v) => (Number.isNaN(v) ? "--" : v.toFixed(3))}
              centerZero
            />
          )}
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard
          title="Accuracy by UTC Hour"
          subtitle="Model accuracy across the day (resolved)"
          icon="schedule"
        >
          {resolved.length === 0 ? (
            <EmptyState title="No resolved snapshots yet" icon="schedule" />
          ) : (
            <HBarChart
              items={hourCuts}
              formatValue={(v) => (Number.isNaN(v) ? "--" : pct(v))}
              centerZero
            />
          )}
        </ChartCard>

        <ChartCard
          title="Baseline Ladder"
          subtitle="Accuracy by predicted-probability bucket — does the model discriminate?"
          icon="stairs"
        >
          {resolved.length === 0 ? (
            <EmptyState title="No resolved snapshots yet" icon="stairs" />
          ) : (
            <HBarChart
              items={ladder}
              formatValue={(v) => (Number.isNaN(v) ? "--" : pct(v))}
              centerZero
            />
          )}
        </ChartCard>
      </div>

      <Card>
        <CardHeader
          title="Run 002 Measurement Notes"
          subtitle="What this surface is for"
          icon="info"
        />
        <div className="space-y-2 px-5 py-4 text-[13px] leading-relaxed text-on-surface-variant">
          <p>
            Gate v2 records <span className="text-on-surface">exec_edge</span>,{" "}
            <span className="text-on-surface">p_calibrated</span>, and{" "}
            <span className="text-on-surface">gate_version</span> on{" "}
            <span className="text-on-surface">every</span> snapshot — approvals
            and rejections alike. The distribution above is the raw material for
            the Run 002 verdict.
          </p>
          <p>
            The frozen model earns its keep on calibration (Brier), not on
            execution. These charts let you watch, in real time, whether any
            executable edge emerges once costs are subtracted — and whether the
            gate stays selectivity-neutral (|t| &lt; 1.5) rather than
            anti-selective.
          </p>
        </div>
      </Card>
    </div>
  );
}

function SelectivityStat({
  label,
  value,
  n,
  tone,
}: {
  label: string;
  value: number;
  n: number;
  tone: "green" | "neutral";
}) {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-container-low p-4">
      <span className="label-caps-sm text-on-surface-variant">{label}</span>
      <div
        className={`tabular mt-1.5 text-[24px] font-semibold ${
          tone === "green" ? "text-primary-container" : "text-on-surface"
        }`}
      >
        {Number.isNaN(value) ? "--" : pct(value)}
      </div>
      <div className="label-caps-sm mt-1 text-on-surface-variant/60">n={n}</div>
    </div>
  );
}
