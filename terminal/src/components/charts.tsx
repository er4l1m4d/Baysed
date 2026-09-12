"use client";

import { Card, CardHeader } from "./ui";

/* Design tokens (mirrors globals.css + BrierChart) */
const MINT = "#00ffa3";
const ROSE = "#ffb4ab";
const GRID = "#262626";
const NULL = "#3a3939";

/* ------------------------------------------------------------------ */
/* Histogram (vertical bins)                                           */
/* ------------------------------------------------------------------ */
export interface HistBin {
  x0: number;
  x1: number;
  count: number;
  /** when set, bar tinted mint (good) / rose (bad) instead of neutral */
  tone?: "pos" | "neg" | "neutral";
}

export function Histogram({
  bins,
  height = 200,
  formatTick = (v) => v.toFixed(2),
  zeroLabel = "0",
  highlightThreshold,
}: {
  bins: HistBin[];
  height?: number;
  formatTick?: (v: number) => string;
  zeroLabel?: string;
  highlightThreshold?: number;
}) {
  const W = 100;
  const H = height / 4;
  const padB = 9;
  const maxCount = Math.max(1, ...bins.map((b) => b.count));
  const minX = bins.length ? bins[0].x0 : 0;
  const maxX = bins.length ? bins[bins.length - 1].x1 : 1;

  const x = (v: number) => ((v - minX) / (maxX - minX || 1)) * W;
  const y = (c: number) => H - padB - (c / maxCount) * (H - padB - 2);

  const zeroX = x(0);
  const hasZero = minX <= 0 && maxX >= 0;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-[200px] w-full overflow-visible"
        role="img"
        aria-label="Distribution histogram"
      >
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line
            key={f}
            x1="0"
            x2={W}
            y1={y(maxCount * f)}
            y2={y(maxCount * f)}
            stroke={GRID}
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {hasZero && (
          <line
            x1={zeroX}
            x2={zeroX}
            y1="0"
            y2={H - padB}
            stroke="#849588"
            strokeWidth="1"
            strokeDasharray="4 3"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {bins.map((b, i) => {
          const bx = x(b.x0);
          const bw = Math.max(0.4, x(b.x1) - x(b.x0) - 0.4);
          const by = y(b.count);
          const bh = Math.max(0, H - padB - by);
          const color =
            b.tone === "pos" ? MINT : b.tone === "neg" ? ROSE : NULL;
          const isHi =
            highlightThreshold != null &&
            ((b.tone === "pos" && b.x0 >= highlightThreshold) ||
              (b.tone === "neg" && b.x1 <= -highlightThreshold));
          return (
            <rect
              key={i}
              x={bx}
              y={by}
              width={bw}
              height={bh}
              fill={color}
              opacity={isHi ? 0.85 : 0.35}
            />
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between px-0.5">
        <span className="label-caps-sm tabular text-on-surface-variant/60">
          {formatTick(minX)}
        </span>
        {hasZero && (
          <span className="label-caps-sm tabular text-on-surface-variant/50">
            {zeroLabel}
          </span>
        )}
        <span className="label-caps-sm tabular text-on-surface-variant/60">
          {formatTick(maxX)}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Line / area timeseries                                              */
/* ------------------------------------------------------------------ */
export interface SeriesPoint {
  ts: number;
  value: number;
}

export function Timeseries({
  series,
  height = 200,
  color = MINT,
  baseline,
  yMin,
  yMax,
  formatY = (v) => v.toFixed(2),
  formatX,
}: {
  series: SeriesPoint[];
  height?: number;
  color?: string;
  baseline?: number;
  yMin?: number;
  yMax?: number;
  formatY?: (v: number) => string;
  formatX?: (ts: number) => string;
}) {
  const W = 100;
  const H = height / 4;
  const padB = 9;
  if (series.length < 2) {
    return (
      <div className="dot-matrix flex h-[200px] items-center justify-center rounded-lg">
        <span className="label-caps-sm text-on-surface-variant/50">
          Not enough samples
        </span>
      </div>
    );
  }
  const tsMin = series[0].ts;
  const tsMax = series[series.length - 1].ts;
  const lo = yMin ?? Math.min(...series.map((s) => s.value), baseline ?? Infinity);
  const hi = yMax ?? Math.max(...series.map((s) => s.value), baseline ?? -Infinity);
  const span = hi - lo || 1;

  const x = (ts: number) =>
    tsMax === tsMin ? W / 2 : ((ts - tsMin) / (tsMax - tsMin)) * W;
  const y = (v: number) => H - padB - ((v - lo) / span) * (H - padB - 2);

  const pts = series.map((s) => [x(s.ts), y(s.value)] as const);
  const line = pts
    .map(([px, py], i) => `${i === 0 ? "M" : "L"}${px.toFixed(2)},${py.toFixed(2)}`)
    .join(" ");
  const area =
    `M${pts[0][0].toFixed(2)},${(H - padB).toFixed(2)} ` +
    pts.map(([px, py]) => `L${px.toFixed(2)},${py.toFixed(2)}`).join(" ") +
    ` L${pts[pts.length - 1][0].toFixed(2)},${(H - padB).toFixed(2)} Z`;

  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => lo + f * span);
  const xTicks = [0, 1, 2, 3].map((i) => tsMin + ((tsMax - tsMin) * i) / 3);

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-[200px] w-full overflow-visible"
        role="img"
        aria-label="Timeseries"
      >
        {grid.map((v) => (
          <line
            key={v}
            x1="0"
            x2={W}
            y1={y(v)}
            y2={y(v)}
            stroke={GRID}
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {baseline != null && (
          <line
            x1="0"
            x2={W}
            y1={y(baseline)}
            y2={y(baseline)}
            stroke="#849588"
            strokeWidth="1"
            strokeDasharray="4 3"
            vectorEffect="non-scaling-stroke"
          />
        )}
        <path d={area} fill={color} opacity={0.08} />
        <path
          d={line}
          fill="none"
          stroke={color}
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 6px ${color}80)` }}
        />
        {pts.length > 0 && (
          <circle
            cx={pts[pts.length - 1][0]}
            cy={pts[pts.length - 1][1]}
            r="1.4"
            fill={color}
            style={{ filter: `drop-shadow(0 0 4px ${color})` }}
          />
        )}
      </svg>
      <div className="pointer-events-none absolute inset-0">
        {grid.map((v) => (
          <span
            key={v}
            className="label-caps-sm tabular absolute -translate-x-full -translate-y-1/2 text-on-surface-variant/60"
            style={{ top: `${((y(v) / H) * 100).toFixed(1)}%`, left: "6px" }}
          >
            {formatY(v)}
          </span>
        ))}
      </div>
      {formatX && (
        <div className="mt-1 flex justify-between px-0.5">
          {xTicks.map((ts) => (
            <span
              key={ts}
              className="label-caps-sm tabular text-on-surface-variant/60"
            >
              {formatX(ts)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Horizontal bar chart (for per-bucket / per-hour cuts)                */
/* ------------------------------------------------------------------ */
export interface HBar {
  label: string;
  value: number;
  /** value mapped to bar width via maxAbs */
  maxAbs?: number;
  tone?: "pos" | "neg" | "neutral";
  sub?: string;
}

export function HBarChart({
  items,
  formatValue = (v) => v.toFixed(3),
  centerZero = false,
}: {
  items: HBar[];
  formatValue?: (v: number) => string;
  centerZero?: boolean;
}) {
  const maxAbs = Math.max(1e-9, ...items.map((i) => Math.abs(i.value)));
  return (
    <div className="space-y-2">
      {items.map((it, i) => {
        const pct = (Math.abs(it.value) / (it.maxAbs ?? maxAbs)) * 100;
        const color =
          it.tone === "pos" ? MINT : it.tone === "neg" ? ROSE : NULL;
        return (
          <div key={i} className="flex items-center gap-3">
            <div className="label-caps-sm tabular w-14 shrink-0 text-right text-on-surface-variant">
              {it.label}
            </div>
            <div className="relative h-6 flex-1 overflow-hidden rounded-sm bg-surface-container-lowest">
              {centerZero ? (
                <div
                  className="absolute inset-y-0 bg-primary-container/20"
                  style={{ left: "50%", width: "1px" }}
                />
              ) : null}
              <div
                className="absolute inset-y-0 left-0 rounded-sm"
                style={{
                  width: `${pct}%`,
                  background: color,
                  opacity: 0.5,
                }}
              />
            </div>
            <div className="label-caps-sm tabular w-16 shrink-0 text-on-surface-variant/80">
              {formatValue(it.value)}
            </div>
            {it.sub && (
              <div className="label-caps-sm tabular w-16 shrink-0 text-on-surface-variant/50">
                {it.sub}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function ChartCard({
  title,
  subtitle,
  icon,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} icon={icon} actions={actions} />
      <div className="px-5 py-5">{children}</div>
    </Card>
  );
}
