"use client";

import { useMemo, useState } from "react";
import { Card, CardHeader, PillToggle, EmptyState } from "./ui";
import { usePredictions } from "@/hooks/useBayseData";

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
        icon="monitoring"
        actions={<PillToggle options={PERIODS} value={period} onChange={setPeriod} />}
      />

      <div className="px-5 pt-4">
        {loading ? (
          <div className="skeleton h-8 w-32" />
        ) : current != null ? (
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="tabular text-[28px] font-semibold leading-none tracking-tight text-on-surface">
              {current.toFixed(4)}
            </span>
            {delta != null && (
              <span
                className={`label-caps-sm tabular inline-flex items-center gap-1 rounded-full border px-2 py-1 ${
                  delta <= 0
                    ? "border-primary-container/25 bg-primary-container/10 text-primary-container"
                    : "border-error/25 bg-error/10 text-error"
                }`}
              >
                <span className="material-symbols-outlined text-[13px]">
                  {delta <= 0 ? "trending_down" : "trending_up"}
                </span>
                {Math.abs(delta).toFixed(4)} ROLLING BRIER
              </span>
            )}
          </div>
        ) : (
          <span className="tabular text-[28px] font-semibold leading-none text-on-surface-variant/40">
            --
          </span>
        )}
        <p className="label-caps-sm mt-2 text-on-surface-variant/70">
          Rolling {ROLLING_WINDOW}-snapshot mean · columns are bucket means ·
          lower is better
        </p>
      </div>

      <div className="mt-4 flex-1 px-2 pb-4">
        {loading ? (
          <div className="skeleton mx-3 h-[200px]" />
        ) : series.length < 2 ? (
          <EmptyState
            title="Not enough resolved snapshots"
            hint="The Brier trend appears once predictions start resolving."
            icon="query_stats"
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

  const points = series.map((d) => [x(d.ts), y(d.value)] as const);
  const linePath = points
    .map(([px, py], i) => `${i === 0 ? "M" : "L"}${px.toFixed(2)},${py.toFixed(2)}`)
    .join(" ");

  // Bucket-mean columns: the reference's columnar silhouette with honest
  // aggregation — one column = mean rolling Brier over that time bucket.
  const N = Math.min(24, Math.max(8, Math.round(series.length / 5)));
  const slot = W / N;
  const buckets = Array.from({ length: N }, (_, i) => {
    const lo = tsMin + ((tsMax - tsMin) * i) / N;
    const hi = tsMin + ((tsMax - tsMin) * (i + 1)) / N;
    const inBucket = series.filter(
      (d) => d.ts >= lo && (i === N - 1 ? d.ts <= hi : d.ts < hi)
    );
    if (inBucket.length === 0) return null;
    const mean = inBucket.reduce((s, d) => s + d.value, 0) / inBucket.length;
    return {
      x: x(lo) + slot * 0.22,
      width: slot * 0.56,
      y: y(mean),
      height: Math.max(0, H - PAD_Y - y(mean)),
      aboveBaseline: mean > BASELINE,
      last: i === N - 1,
    };
  });

  // Grid: horizontal lines with value labels
  const gridValues = [0, 0.25, 0.5, 0.75, 1]
    .map((f) => yMin + f * (yMax - yMin))
    .filter((v) => v <= yMax);

  // X labels: 4 evenly spaced timestamps
  const xTicks = [0, 1, 2, 3].map((i) => tsMin + ((tsMax - tsMin) * i) / 3);

  return (
    <div>
      <div className="relative mx-3 h-[200px] rounded-md">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="h-full w-full overflow-visible"
          aria-label="Rolling Brier score over time"
          role="img"
        >
          {/* Grid */}
          {gridValues.map((v) => (
            <line
              key={v}
              x1="0"
              x2={W}
              y1={y(v)}
              y2={y(v)}
              stroke="#262626"
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
              stroke="#849588"
              strokeWidth="1"
              strokeDasharray="4 3"
              vectorEffect="non-scaling-stroke"
            />
          )}

          {/* Bucket-mean columns. Below the dashed baseline = better than
              random (mint); above it = worse (rose tint). Muted so the exact
              line stays the hero. */}
          {buckets.map(
            (b, i) =>
              b && (
                <rect
                  key={`col-${i}`}
                  x={b.x}
                  y={b.y}
                  width={b.width}
                  height={b.height}
                  fill={b.aboveBaseline ? "#ffb4ab" : "#00ffa3"}
                  opacity={b.last ? 0.3 : 0.15}
                />
              )
          )}

          {/* Precise rolling-Brier trend — the actual values, on top */}
          <path
            d={linePath}
            fill="none"
            stroke="#00ffa3"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
            style={{ filter: "drop-shadow(0 0 6px rgba(0, 255, 163, 0.5))" }}
          />

          {/* Last point marker */}
          {points.length > 0 && (
            <circle
              cx={points[points.length - 1][0]}
              cy={points[points.length - 1][1]}
              r="1.4"
              fill="#00ffa3"
              style={{ filter: "drop-shadow(0 0 4px #00ffa3)" }}
            />
          )}
        </svg>

        {/* Y-axis labels (HTML overlay so text never stretches) */}
        <div className="pointer-events-none absolute inset-0">
          {gridValues.map((v) => (
            <span
              key={v}
              className="label-caps-sm tabular absolute -translate-x-full -translate-y-1/2 text-on-surface-variant/60"
              style={{
                top: `${((y(v) / H) * 100).toFixed(1)}%`,
                left: "6px",
              }}
            >
              {v.toFixed(2)}
            </span>
          ))}
          {/* Baseline tag */}
          {BASELINE <= yMax && (
            <span
              className="label-caps-sm absolute -translate-y-1/2 text-on-surface-variant/50"
              style={{
                top: `${((y(BASELINE) / H) * 100).toFixed(1)}%`,
                right: "6px",
              }}
            >
              RANDOM
            </span>
          )}
        </div>
      </div>

      {/* X-axis labels */}
      <div className="mx-3 mt-2 flex justify-between">
        {xTicks.map((ts) => (
          <span
            key={ts}
            className="label-caps-sm tabular text-on-surface-variant/60"
          >
            {fmtDate(ts, period)}
          </span>
        ))}
      </div>
    </div>
  );
}
