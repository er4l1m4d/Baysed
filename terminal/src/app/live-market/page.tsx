"use client";

import { useEffect, useState } from "react";
import {
  useLiveMarketState,
  useLivePrice,
  usePipelineHealth,
  usePredictions,
} from "@/hooks/useBayseData";
import {
  Card,
  CardHeader,
  StatCard,
  EmptyState,
} from "@/components/ui";

const usd = (v: number | null | undefined) =>
  v != null
    ? `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : "--";

const pct = (v: number | null | undefined, digits = 1) =>
  v != null ? `${(v * 100).toFixed(digits)}%` : "--";

function signed(v: number | null | undefined, digits = 3) {
  if (v == null) return "--";
  return `${v > 0 ? "+" : ""}${(v * 100).toFixed(digits)}%`;
}

export default function LiveMarketPage() {
  const { liveMarket, loading } = useLiveMarketState();
  const { price, source } = useLivePrice();
  const { health } = usePipelineHealth();
  const { predictions } = usePredictions(30);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const currentSnapshots = predictions.filter(
    (p) => liveMarket && p.market_id === liveMarket.market_id
  );

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-9 w-56" />
        <div className="skeleton h-64 w-full" />
      </div>
    );
  }

  if (!liveMarket || !liveMarket.is_active) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-on-surface">
            Live Market
          </h1>
          <p className="mt-1.5 text-sm text-on-surface-variant">
            The currently open 15-minute BTC contract.
          </p>
        </div>
        <Card className="p-8">
          <EmptyState
            title="No active market right now"
            hint={`Discovery last checked ${
              health?.discovery.last_at
                ? new Date(health.discovery.last_at).toLocaleTimeString()
                : "--"
            } · next contract opens at the quarter-hour mark.`}
            icon="candlestick_chart"
          />
        </Card>
      </div>
    );
  }

  const strike = liveMarket.strike_price;
  const current = price ?? liveMarket.btc_price;
  const distance =
    strike != null && current != null ? (current - strike) / strike : null;
  const opens = liveMarket.opens_at ? new Date(liveMarket.opens_at).getTime() : null;
  const closes = liveMarket.closes_at ? new Date(liveMarket.closes_at).getTime() : null;
  const remaining = closes != null ? Math.max(0, Math.floor((closes - now) / 1000)) : null;
  const elapsedPct =
    opens != null && closes != null && closes > opens
      ? Math.min(1, Math.max(0, (now - opens) / (closes - opens)))
      : null;

  const mmss = (s: number) =>
    `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  const contractStrikes =
    currentSnapshots.length > 0 ? currentSnapshots[0].strike_price : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-on-surface">
          Live Market
        </h1>
        <p className="mt-1.5 text-sm text-on-surface-variant">
          {liveMarket.title} — resolves from Binance 1-minute close.
        </p>
      </div>

      {/* Headline */}
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <div className="label-caps-sm flex items-center gap-2 text-on-surface-variant">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary-container" />
              {source === "live" ? "LIVE VIA WEBSOCKET" : "POLLING FALLBACK"}
            </div>
            <div
              className={`tabular mt-2.5 text-[42px] font-semibold leading-none tracking-tight ${
                distance == null
                  ? "text-on-surface"
                  : distance >= 0
                    ? "text-primary-container neon-glow"
                    : "text-error"
              }`}
            >
              {usd(current)}
            </div>
            <div className="label-caps-sm mt-3 text-on-surface-variant">
              STRIKE {usd(strike)} ·{" "}
              <span
                className={
                  distance != null && distance >= 0
                    ? "text-primary-container"
                    : "text-error"
                }
              >
                {signed(distance)} {distance != null && distance >= 0 ? "ABOVE" : "BELOW"}
              </span>
            </div>
          </div>

          <div className="text-right">
            <div className="label-caps-sm flex items-center justify-end gap-1.5 text-on-surface-variant">
              <span className="material-symbols-outlined text-[13px]">schedule</span>
              TIME REMAINING
            </div>
            <div className="tabular mt-2.5 text-[42px] font-semibold leading-none tracking-tight text-on-surface">
              {remaining != null ? mmss(remaining) : "--"}
            </div>
            <div className="label-caps-sm mt-3 text-on-surface-variant/70">
              CLOSES{" "}
              {liveMarket.closes_at
                ? new Date(liveMarket.closes_at).toLocaleTimeString()
                : "--"}
            </div>
          </div>
        </div>

        {/* Elapsed progress */}
        <div className="mt-6">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-bright">
            <div
              className="progress-bar-striped h-full bg-primary-container transition-[width] duration-1000 ease-linear"
              style={{ width: elapsedPct != null ? `${elapsedPct * 100}%` : "0%" }}
            />
          </div>
          <div className="label-caps-sm mt-1.5 flex justify-between text-on-surface-variant/70">
            <span>
              OPENED{" "}
              {liveMarket.opens_at
                ? new Date(liveMarket.opens_at).toLocaleTimeString()
                : "--"}
            </span>
            <span>
              {elapsedPct != null ? `${Math.round(elapsedPct * 100)}% ELAPSED` : ""}
            </span>
          </div>
        </div>
      </Card>

      {/* Book + model */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Yes Ask"
          icon="north"
          value={liveMarket.yes_ask?.toFixed(3) ?? "--"}
          subtitle="MARKET P(UP)"
          tone="green"
        />
        <StatCard
          label="No Ask"
          icon="south"
          value={liveMarket.no_ask?.toFixed(3) ?? "--"}
          subtitle="MARKET P(DOWN)"
          tone="red"
        />
        <StatCard
          label="Model P(Up)"
          icon="psychology"
          value={pct(liveMarket.model_probability)}
          subtitle="distance_to_strike_v2"
          tone="gold"
        />
        <StatCard
          label="Edge"
          icon="bolt"
          value={signed(liveMarket.edge, 2)}
          subtitle={`AFTER FEES ${signed(liveMarket.edge_fee, 2)}`}
          tone={liveMarket.edge != null && liveMarket.edge > 0 ? "green" : "red"}
        />
      </div>

      {/* Model direction + snapshots for this market */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        {/* Regime-style blue panel for the model call */}
        <div className="flex flex-col rounded-lg border border-tertiary-fixed-dim/40 bg-tertiary p-5 text-on-tertiary lg:col-span-2">
          <div className="mb-4 flex items-center justify-between border-b border-on-tertiary/20 pb-2.5">
            <h3 className="label-caps font-semibold tracking-widest">
              Model Call
            </h3>
            <span className="material-symbols-outlined text-[16px]">radar</span>
          </div>

          {liveMarket.model_probability == null ? (
            <EmptyState
              title="Model warming up"
              hint="Features need BTC candle history before producing a probability."
              icon="psychology"
            />
          ) : (
            <>
              <div className="flex items-baseline justify-between">
                <div className="flex items-baseline gap-3">
                  <span className="text-[34px] font-bold leading-none tracking-tight">
                    {liveMarket.model_predicted_outcome === "YES" ? "UP" : "DOWN"}
                  </span>
                  {liveMarket.model_predicted_outcome && (
                    <span className="label-caps-sm rounded-sm border border-on-tertiary/30 bg-on-tertiary/10 px-1.5 py-0.5">
                      CALL
                    </span>
                  )}
                </div>
                <span className="tabular text-2xl font-bold">
                  {pct(liveMarket.model_probability, 0)}
                </span>
              </div>

              {/* Probability meter */}
              <div className="mt-5 flex h-2 gap-1">
                {Array.from({ length: 12 }).map((_, i) => {
                  const filled =
                    i < Math.round((liveMarket.model_probability ?? 0) * 12);
                  return (
                    <div
                      key={i}
                      className={`h-full flex-1 rounded-sm ${
                        filled ? "bg-on-tertiary" : "bg-on-tertiary/15"
                      }`}
                    />
                  );
                })}
              </div>
              <div className="label-caps-sm mt-1.5 flex justify-between text-on-tertiary/60">
                <span>P(DOWN)</span>
                <span>P(UP)</span>
              </div>

              <div className="label-caps-sm mt-auto space-y-2 pt-5">
                <div className="flex items-center justify-between border-b border-on-tertiary/10 pb-2">
                  <span className="opacity-80">STRATEGY</span>
                  <span className="font-semibold">DIST_TO_STRIKE</span>
                </div>
                <div className="flex items-center justify-between border-b border-on-tertiary/10 pb-2">
                  <span className="opacity-80">APPROVED</span>
                  <span className="font-semibold">
                    {liveMarket.approved ? "YES" : "OBSERVATION"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="opacity-80">STRIKE</span>
                  <span className="tabular font-semibold">{usd(strike)}</span>
                </div>
              </div>
            </>
          )}
        </div>

        <Card className="lg:col-span-3">
          <CardHeader
            title="Snapshots This Window"
            subtitle={`${currentSnapshots.length} recorded · strike ${usd(contractStrikes ?? strike)}`}
            icon="layers"
          />
          <div className="px-5 py-3">
            {currentSnapshots.length === 0 ? (
              <EmptyState title="No snapshots for this market yet" icon="layers" />
            ) : (
              <ul>
                {currentSnapshots.slice(0, 6).map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-3 border-b border-border-subtle/60 py-2.5 text-sm last:border-0"
                  >
                    <span className="label-caps-sm tabular w-20 text-on-surface-variant">
                      {p.observed_at
                        ? new Date(p.observed_at).toLocaleTimeString()
                        : "--"}
                    </span>
                    <span className="tabular flex-1 text-right text-on-surface-variant">
                      {usd(p.current_btc_price)}
                    </span>
                    <span className="tabular w-16 text-right text-on-surface">
                      {pct(p.probability, 0)}
                    </span>
                    <span className="label-caps-sm tabular w-20 text-right text-on-surface-variant/70">
                      {p.seconds_remaining != null
                        ? `${mmss(p.seconds_remaining)} LEFT`
                        : "--"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
