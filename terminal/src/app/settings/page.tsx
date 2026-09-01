"use client";

import { useBotStatus, usePipelineHealth, useCalibration } from "@/hooks/useBayseData";
import { Card, CardHeader, EmptyState } from "@/components/ui";

function Row({ label, value, mono = true }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <span className="text-[13px] text-zinc-400">{label}</span>
      <span className={`text-[13px] font-semibold text-white ${mono ? "tabular" : ""}`}>
        {value || "--"}
      </span>
    </div>
  );
}

function HealthDot({ ok, warn }: { ok: boolean; warn?: boolean }) {
  return (
    <span
      className={`h-2 w-2 shrink-0 rounded-full ${
        ok ? "bg-emerald-500" : warn ? "bg-amber-500" : "bg-rose-500"
      }`}
    />
  );
}

function HealthRow({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <span className="flex items-center gap-2 text-[13px] text-zinc-400">
        <HealthDot ok={ok} />
        {label}
      </span>
      <span className="tabular text-[13px] text-zinc-300">{detail}</span>
    </div>
  );
}

export default function SettingsPage() {
  const { status, loading } = useBotStatus();
  const { health } = usePipelineHealth();
  const { calibration } = useCalibration();

  const uptime =
    status?.uptime_seconds != null
      ? `${Math.floor(status.uptime_seconds / 3600)}h ${Math.floor((status.uptime_seconds % 3600) / 60)}m`
      : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[28px] font-bold leading-tight text-white">Settings</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Engine configuration and pipeline health. The terminal is read-only —
          configuration lives in environment variables on the host.
        </p>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="skeleton h-64 w-full" />
          <div className="skeleton h-64 w-full" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Engine config */}
          <Card>
            <CardHeader title="Engine" subtitle="Effective runtime configuration" />
            <div className="divide-y divide-zinc-800 px-5 py-2">
              <Row label="Mode" value={status?.mode ?? "observation"} mono={false} />
              <Row label="Strategy" value={status?.strategy} />
              <Row label="Model version" value="distance_to_strike_v2" />
              <Row
                label="Run ID"
                value={calibration ? "observation (see snapshots)" : null}
                mono={false}
              />
              <Row label="Running" value={status?.is_running ? "Yes" : "No"} mono={false} />
              <Row label="Uptime" value={uptime} />
              <Row label="Cycles" value={health ? String(health.engine.cycles) : null} />
              <Row label="Errors" value={status ? String(status.error_count) : null} />
            </div>
            {status?.last_error && (
              <div className="mx-5 mb-5 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-300">
                {status.last_error}
              </div>
            )}
          </Card>

          {/* Pipeline health */}
          <Card>
            <CardHeader title="Pipeline Health" subtitle="Stage-by-stage diagnostics" />
            <div className="divide-y divide-zinc-800 px-5 py-2">
              <HealthRow
                label="BTC feed"
                ok={!!health?.btc_feed.connected}
                detail={
                  health
                    ? `${health.btc_feed.candle_count} candles · ${health.btc_feed.complete ? "complete" : "warming"}`
                    : "--"
                }
              />
              <HealthRow
                label="Market feed"
                ok={!!health?.market_feed.connected}
                detail={
                  health
                    ? `${health.market_feed.subscribed_markets} subscribed · ${health.market_feed.server_error_count} errors`
                    : "--"
                }
              />
              <HealthRow
                label="Discovery"
                ok={(health?.discovery.events ?? 0) > 0}
                detail={
                  health
                    ? `${health.discovery.events} events · ${health.discovery.slug ?? "--"}`
                    : "--"
                }
              />
              <HealthRow
                label="Live market"
                ok={!!health?.live_market.active}
                detail={
                  health?.live_market.closes_at
                    ? `closes ${new Date(health.live_market.closes_at).toLocaleTimeString()}`
                    : "inactive"
                }
              />
              <HealthRow
                label="Predictions"
                ok={(health?.predictions.total ?? 0) > 0}
                detail={
                  health
                    ? `${health.predictions.total} total · ${health.predictions.pending} pending`
                    : "--"
                }
              />
              <HealthRow
                label="Resolution"
                ok={!!health?.resolution.has_calibration_data}
                detail={
                  health
                    ? `${health.predictions.resolved} resolved`
                    : "--"
                }
              />
              <HealthRow
                label="API WebSocket"
                ok={(health?.api_websocket.clients ?? 0) >= 0}
                detail={
                  health ? `${health.api_websocket.clients} client(s)` : "--"
                }
              />
            </div>
          </Card>
        </div>
      )}

      {/* About */}
      <Card>
        <CardHeader title="About" subtitle="Observation Run 001" />
        <div className="px-5 py-5">
          <p className="max-w-2xl text-[13px] leading-relaxed text-zinc-400">
            Baysed is a quantitative research engine for Bayse Markets&apos;
            15-minute BTC binary contracts. During Observation Run 001 the
            engine records prediction snapshots but does not place orders —
            the model version <span className="font-semibold text-zinc-200">distance_to_strike_v2</span> is
            frozen, and calibration data accumulates for baseline comparison.
            The terminal is a read-only window into that process.
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            {["distance_to_strike_v2", "Bayse Markets", "Binance resolution", "Next.js", "FastAPI"].map(
              (tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-zinc-800 px-2.5 py-1 text-zinc-400"
                >
                  {tag}
                </span>
              )
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
