"use client";

import { useBotStatus, usePipelineHealth, useCalibration } from "@/hooks/useBayseData";
import { Card, CardHeader } from "@/components/ui";

function Row({
  label,
  value,
  mono = true,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <span className="label-caps-sm text-on-surface-variant">{label}</span>
      <span
        className={`text-[13px] font-semibold text-on-surface ${mono ? "tabular" : ""}`}
      >
        {value || "--"}
      </span>
    </div>
  );
}

function HealthDot({ ok, warn }: { ok: boolean; warn?: boolean }) {
  return (
    <span
      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
        ok ? "bg-primary-container" : warn ? "bg-warning-gold" : "bg-error"
      }`}
    />
  );
}

function HealthRow({
  label,
  ok,
  warn,
  detail,
}: {
  label: string;
  ok: boolean;
  warn?: boolean;
  detail: string;
}) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <span className="label-caps-sm flex items-center gap-2.5 text-on-surface-variant">
        <HealthDot ok={ok} warn={warn} />
        {label}
      </span>
      <span className="label-caps-sm tabular text-on-surface">{detail}</span>
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
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-on-surface">
          Settings
        </h1>
        <p className="mt-1.5 text-sm text-on-surface-variant">
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
            <CardHeader title="Engine" subtitle="Effective runtime configuration" icon="settings" />
            <div className="divide-y divide-border-subtle/60 px-5 py-2">
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
              <div className="mx-5 mb-5 flex items-start gap-2 rounded-lg border border-error/20 bg-error/10 px-3.5 py-2.5">
                <span className="material-symbols-outlined mt-0.5 text-[15px] text-error">
                  error
                </span>
                <p className="text-xs leading-relaxed text-error">{status.last_error}</p>
              </div>
            )}
          </Card>

          {/* Pipeline health */}
          <Card>
            <CardHeader title="Pipeline Health" subtitle="Stage-by-stage diagnostics" icon="network_check" />
            <div className="divide-y divide-border-subtle/60 px-5 py-2">
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
                  health ? `${health.predictions.resolved} resolved` : "--"
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
        <CardHeader title="About" subtitle="Observation Run 001" icon="info" />
        <div className="px-5 py-5">
          <p className="max-w-2xl text-[13px] leading-relaxed text-on-surface-variant">
            Baysed is a quantitative research engine for Bayse Markets&apos;
            15-minute BTC binary contracts. During Observation Run 001 the
            engine records prediction snapshots but does not place orders —
            the model version{" "}
            <span className="font-semibold text-on-surface">
              distance_to_strike_v2
            </span>{" "}
            is frozen, and calibration data accumulates for baseline comparison.
            The terminal is a read-only window into that process.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {[
              "distance_to_strike_v2",
              "Bayse Markets",
              "Binance resolution",
              "Next.js",
              "FastAPI",
            ].map((tag) => (
              <span
                key={tag}
                className="label-caps-sm rounded-full border border-border-subtle bg-surface-container-lowest px-2.5 py-1 text-on-surface-variant"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}
