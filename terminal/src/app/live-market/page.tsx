"use client";

import { useEffect, useState } from "react";
import { useLiveMarketState, useLivePrice, usePipelineHealth, usePredictions } from "@/hooks/useBayseData";
import { Card, CardHeader, StatCard, OutcomePill, EmptyState } from "@/components/ui";
import { IconArrowUp, IconArrowDown, IconClock } from "@/components/Icons";

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
          <h1 className="text-[28px] font-bold leading-tight text-white">Live Market</h1>
          <p className="mt-1 text-sm text-zinc-400">
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
    currentSnapshots.length > 0
      ? currentSnapshots[0].strike_price
      : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[28px] font-bold leading-tight text-white">Live Market</h1>
        <p className="mt-1 text-sm text-zinc-400">
          {liveMarket.title} — resolves from Binance 1-minute close.
        </p>
      </div>

      {/* Headline */}
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 text-[13px] text-zinc-400">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
              {source === "live" ? "Live via WebSocket" : "Polling fallback"}
            </div>
            <div
              className={`tabular mt-2 text-5xl font-bold leading-none ${
                distance == null ? "text-white" : distance >= 0 ? "text-emerald-400" : "text-rose-400"
              }`}
            >
              {usd(current)}
            </div>
            <div className="mt-2 text-sm text-zinc-400">
              Strike {usd(strike)} ·{" "}
              <span className={distance != null && distance >= 0 ? "text-emerald-400" : "text-rose-400"}>
                {signed(distance)} {distance != null && distance >= 0 ? "above" : "below"}
              </span>
            </div>
          </div>

          <div className="text-right">
            <div className="flex items-center justify-end gap-1.5 text-[13px] text-zinc-400">
              <IconClock width={13} height={13} />
              Time remaining
            </div>
            <div className="tabular mt-2 text-5xl font-bold leading-none text-white">
              {remaining != null ? mmss(remaining) : "--"}
            </div>
            <div className="mt-2 text-sm text-zinc-500">
              closes {liveMarket.closes_at ? new Date(liveMarket.closes_at).toLocaleTimeString() : "--"}
            </div>
          </div>
        </div>

        {/* Elapsed progress */}
        <div className="mt-6">
          <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-amber-500 transition-[width] duration-1000 ease-linear"
              style={{ width: elapsedPct != null ? `${elapsedPct * 100}%` : "0%" }}
            />
          </div>
          <div className="mt-1.5 flex justify-between text-[11px] text-zinc-500">
            <span>opened {liveMarket.opens_at ? new Date(liveMarket.opens_at).toLocaleTimeString() : "--"}</span>
            <span>{elapsedPct != null ? `${Math.round(elapsedPct * 100)}% elapsed` : ""}</span>
          </div>
        </div>
      </Card>

      {/* Book + model */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Yes Ask"
          value={liveMarket.yes_ask?.toFixed(3) ?? "--"}
          subtitle="Market implied P(Up)"
          dot="green"
        />
        <StatCard
          label="No Ask"
          value={liveMarket.no_ask?.toFixed(3) ?? "--"}
          subtitle="Market implied P(Down)"
          dot="red"
        />
        <StatCard
          label="Model P(Up)"
          value={pct(liveMarket.model_probability)}
          subtitle="distance_to_strike_v2"
          dot="gold"
        />
        <StatCard
          label="Edge"
          value={signed(liveMarket.edge, 2)}
          subtitle={`after fees ${signed(liveMarket.edge_fee, 2)}`}
          dot={liveMarket.edge != null && liveMarket.edge > 0 ? "green" : "red"}
        />
      </div>

      {/* Model direction + snapshots for this market */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader title="Model Call" subtitle="Latest strategy evaluation" />
          <div className="px-5 py-5">
            {liveMarket.model_probability == null ? (
              <EmptyState
                title="Model warming up"
                hint="Features need BTC candle history before producing a probability."
              />
            ) : (
              <>
                <div className="flex items-center gap-3">
                  {liveMarket.model_predicted_outcome === "YES" ? (
                    <IconArrowUp width={22} height={22} className="text-emerald-400" />
                  ) : (
                    <IconArrowDown width={22} height={22} className="text-rose-400" />
                  )}
                  <span className="text-3xl font-bold text-white">
                    {liveMarket.model_predicted_outcome === "YES" ? "UP" : "DOWN"}
                  </span>
                  {liveMarket.model_predicted_outcome && (
                    <OutcomePill outcome={liveMarket.model_predicted_outcome as "YES" | "NO"} />
                  )}
                </div>
                <div className="mt-4 space-y-2.5 text-[13px]">
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Probability</span>
                    <span className="tabular font-semibold text-white">
                      {pct(liveMarket.model_probability)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Approved</span>
                    <span className={`font-semibold ${liveMarket.approved ? "text-emerald-400" : "text-zinc-400"}`}>
                      {liveMarket.approved ? "Yes" : "No (observation run)"}
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader
            title="Snapshots This Window"
            subtitle={`${currentSnapshots.length} recorded · strike ${usd(contractStrikes ?? strike)}`}
          />
          <div className="mt-3 px-5 pb-5">
            {currentSnapshots.length === 0 ? (
              <EmptyState title="No snapshots for this market yet" />
            ) : (
              <ul className="divide-y divide-zinc-800">
                {currentSnapshots.slice(0, 6).map((p) => (
                  <li key={p.id} className="flex items-center justify-between py-2.5 text-sm">
                    <span className="tabular text-zinc-400">
                      {p.observed_at
                        ? new Date(p.observed_at).toLocaleTimeString()
                        : "--"}
                    </span>
                    <span className="tabular text-zinc-300">
                      {usd(p.current_btc_price)}
                    </span>
                    <span className="tabular text-zinc-300">
                      {pct(p.probability)}
                    </span>
                    <span className="tabular text-zinc-500">
                      {p.seconds_remaining != null ? mmss(p.seconds_remaining) : "--"} left
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
