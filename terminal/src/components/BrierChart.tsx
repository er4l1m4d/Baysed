"use client";

import { useMemo, useState } from "react";
import { Card, CardHeader, PillToggle, EmptyState } from "./ui";
import { usePredictions } from "@/hooks/useBayseData";
import type { Prediction } from "@/lib/api";

const PERIODS = ["Daily", "Weekly", "Monthly"] as const;
type Period = (typeof PERIODS)[number];

const PERIOD_HOURS: Record<Period, number> = {
  Daily: 24,
  Weekly: 24 * 7,
  Monthly: 24 * 30,
};

const ROLLING_WINDOW = 10;
const BASELINE = 0.25; // random-guess Brier for a binary market

function fmtDate(ts: number, period: Period) {
  const d = new Date(ts);
  return period === "Daily"
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function PerformanceCard() {
  const [period, setPeriod] = useState<Period>("Weekly");
  const { predictions, loading } = usePredictions(200);

  const resolved = useMemo(
    () =>
      predictions
        .filter(
          (p) =>
            p.brier_score != null && p.resolved_at != null && p.probability != null
        )
        .sort(
          (a, b) =>
            new Date(a.resolved_at!).getTime() - new Date(b.resolved_at!).getTime()
        ),
    [predictions]
  );

  const series = useMemo(() => {
    if (resolved.length === 0) return [];
    const cutoff =
      new Date(resolved[resolved.length - 1].resolved_at!).getTime() -
      PERIOD_HOURS[period] * 3600 * 1000;
    const inWindow = resolved.filter(
      (p) => new Date(p.resolved_at!).getTime() >= cutoff
    );
    // Rolling mean of Brier over the window
    return inWindow.map((p, i) => {
      const slice = inWindow.slice(Math.max(0, i - ROLLING_WINDOW + 1), i + 1);
      const mean = slice.reduce((s, x) => s + (x.brier_score ?? 0), 0) / slice.length;
      return { ts: new Date(p.resolved_at!).getTime(), value: mean };
    });
  }, [resolved, period]);

  const current = series.length > 0 ? series[series.length - 1].value : null;
  const first = series.length > 1 ? series[0].value : null;
  const delta = current != null && first != null ? current - first : null;

  return (
    <Card className="flex flex-col">
      <CardHeader
        title="Performance"
        actions={<PillToggle options={PERIODS} value={period} onChange={setPeriod} />}
      />

      <div className="px-5 pt-3">
        {loading ? (
          <div className="skeleton h-8 w-32" />
        ) : current != null ? (
          <div className="flex items-baseline gap-2.5">
            <span className="tabular text-[28px] font-bold leading-none text-white">
              {current.toFixed(4)}
            </span>
            {delta != null && (
              <span
                className={`tabular text-sm font-medium ${
                  delta <= 0 ? "text-emerald-400" : "text-rose-400"
                }`}
              >
                {delta <= 0 ? "▼" : "▲"} {Math.abs(delta).toFixed(4)} rolling Brier
              </span>
            )}
          </div>
        ) : (
          <span className="text-[28px] font-bold leading-none text-zinc-600">--</span>
        )}
        <p className="mt-1 text-xs text-zinc-500">
          Rolling {ROLLING_WINDOW}-snapshot mean · lower is better
        </p>
      </div>

      <div className="mt-4 flex-1 px-2 pb-3">
        {loading ? (
          <div className="skeleton mx-3 h-[200px]" />
        ) : series.length < 2 ? (
          <EmptyState
            title="Not enough resolved snapshots"
            hint="The Brier trend appears once predictions start resolving."
          />
        ) : (
          <Chart series={series} period={period} />
        )}
      </div>
    </Card>
  );
}

function Chart({
  series,
  period,
}: {
  series: { ts: number; value: number }[];
  period: Period;
}) {
  const W = 100;
  const H = 40;
  const PAD_Y = 2;

  const yMax = Math.max(
    BASELINE,
    ...series.map((d) => d.value),
    0.3
  );
  const yMin = 0;
  const tsMin = series[0].ts;
  const tsMax = series[series.length - 1].ts;

  const x = (ts: number) =>
    tsMax === tsMin ? W / 2 : ((ts - tsMin) / (tsMax - tsMin)) * W;
  const y = (v: number) =>
    H - PAD_Y - ((v - yMin) / (yMax - yMin)) * (H - PAD_Y * 2);

  // Smooth path via simple monotone-ish segments (polyline with slight rounding)
  const points = series.map((d) => [x(d.ts), y(d.value)] as const);
  const linePath = points
    .map(([px, py], i) => `${i === 0 ? "M" : "L"}${px.toFixed(2)},${py.toFixed(2)}`)
    .join(" ");
  const areaPath = `${linePath} L${W},${H} L0,${H} Z`;

  // Grid: 4 horizontal lines with value labels
  const gridValues = [0, 0.25, 0.5, 0.75, 1]
    .map((f) => yMin + f * (yMax - yMin))
    .filter((v) => v <= yMax);

  // X labels: 4 evenly spaced timestamps
  const xTicks = [0, 1, 2, 3].map((i) => tsMin + ((tsMax - tsMin) * i) / 3);

  return (
    <div>
      <div className="relative mx-3 h-[200px]">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="h-full w-full overflow-visible"
          aria-label="Rolling Brier score over time"
          role="img"
        >
          <defs>
            <linearGradient id="brierFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#F59E0B" stopOpacity="0.14" />
              <stop offset="100%" stopColor="#F59E0B" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Grid */}
          {gridValues.map((v) => (
            <line
              key={v}
              x1="0"
              x2={W}
              y1={y(v)}
              y2={y(v)}
              stroke="#27272a"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {/* Random-guess baseline */}
          {BASELINE <= yMax && BASELINE >= yMin && (
            <line
              x1="0"
              x2={W}
              y1={y(BASELINE)}
              y2={y(BASELINE)}
              stroke="#52525B"
              strokeWidth="1"
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
            />
          )}

          {/* Area + line */}
          <path d={areaPath} fill="url(#brierFill)" />
          <path
            d={linePath}
            fill="none"
            stroke="#F59E0B"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* Last point marker */}
          {points.length > 0 && (
            <circle
              cx={points[points.length - 1][0]}
              cy={points[points.length - 1][1]}
              r="1.2"
              fill="#F59E0B"
            />
          )}
        </svg>

        {/* Y-axis labels (HTML overlay so text never stretches) */}
        <div className="pointer-events-none absolute inset-0">
          {gridValues.map((v) => (
            <span
              key={v}
              className="tabular absolute -left-0.5 -translate-x-full -translate-y-1/2 text-[10px] text-zinc-500"
              style={{
                top: `${((y(v) / H) * 100).toFixed(1)}%`,
              }}
            >
              {v.toFixed(2)}
            </span>
          ))}
        </div>
      </div>

      {/* X-axis labels */}
      <div className="mx-3 mt-2 flex justify-between">
        {xTicks.map((ts) => (
          <span key={ts} className="text-[10px] text-zinc-500">
            {fmtDate(ts, period)}
          </span>
        ))}
      </div>
    </div>
  );
}
