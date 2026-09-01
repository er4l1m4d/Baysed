import type { ReactNode } from "react";

/* ------------------------------------------------------------------ */
/* Surfaces                                                            */
/* ------------------------------------------------------------------ */

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`glass-card rounded-xl ${className}`}>{children}</div>;
}

export function CardHeader({
  title,
  subtitle,
  actions,
  icon,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  icon?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border-subtle px-5 py-3.5">
      <div className="flex min-w-0 items-center gap-2.5">
        {icon && (
          <span className="material-symbols-outlined text-[16px] text-primary-container">
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <h2 className="label-caps truncate text-on-surface">{title}</h2>
          {subtitle && (
            <p className="mt-1 text-xs leading-snug text-on-surface-variant/80">
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Stat card — tactical HUD panel                                      */
/* ------------------------------------------------------------------ */

export type StatTone = "green" | "gold" | "red" | "neutral";

export function StatCard({
  label,
  value,
  subtitle,
  icon,
  tone = "neutral",
  loading,
  className = "",
}: {
  label: string;
  value: string;
  subtitle?: string;
  icon?: string;
  tone?: StatTone;
  loading?: boolean;
  className?: string;
}) {
  const valueColor =
    tone === "green"
      ? "text-primary-container neon-glow"
      : tone === "gold"
        ? "text-warning-gold"
        : tone === "red"
          ? "text-error"
          : "text-on-surface";

  return (
    <div
      className={`tactical-panel flex h-24 flex-col justify-between rounded-lg p-4 ${className}`}
    >
      <div className="flex items-start justify-between">
        <span className="label-caps-sm text-on-surface-variant">{label}</span>
        {icon && (
          <span className="material-symbols-outlined text-[16px] text-on-surface-variant/70">
            {icon}
          </span>
        )}
      </div>
      {loading ? (
        <div className="skeleton h-7 w-20" />
      ) : (
        <div
          className={`tabular text-[26px] font-semibold leading-none tracking-tight ${valueColor}`}
        >
          {value}
        </div>
      )}
      {subtitle && (
        <div className="label-caps-sm truncate text-on-surface-variant/80">
          {subtitle}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Segmented pill toggle                                               */
/* ------------------------------------------------------------------ */

export function PillToggle<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div
      className="flex rounded-full border border-border-subtle bg-surface-container-lowest p-1"
      role="tablist"
    >
      {options.map((opt) => {
        const active = opt === value;
        return (
          <button
            key={opt}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt)}
            className={`label-caps-sm rounded-full px-3 py-1 transition-colors duration-150 ${
              active
                ? "bg-primary-container/15 text-primary-container neon-glow"
                : "text-on-surface-variant/70 hover:text-on-surface"
            }`}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Badges & pills                                                      */
/* ------------------------------------------------------------------ */

export function OutcomePill({ outcome }: { outcome: "YES" | "NO" }) {
  const up = outcome === "YES";
  return (
    <span
      className={`label-caps-sm inline-flex items-center rounded-sm border px-1.5 py-0.5 ${
        up
          ? "border-primary-container/30 bg-primary-container/15 text-primary-container"
          : "border-error/30 bg-error/15 text-error"
      }`}
    >
      {up ? "UP" : "DOWN"}
    </span>
  );
}

export function StatusBadge({ status }: { status: "pending" | "correct" | "wrong" }) {
  const styles =
    status === "pending"
      ? "border-warning-gold/30 bg-warning-gold/10 text-warning-gold"
      : status === "correct"
        ? "border-primary-container/30 bg-primary-container/15 text-primary-container"
        : "border-error/30 bg-error/15 text-error";
  return (
    <span
      className={`label-caps-sm inline-flex items-center rounded-sm border px-1.5 py-0.5 ${styles}`}
    >
      {status}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Empty state                                                         */
/* ------------------------------------------------------------------ */

export function EmptyState({
  title,
  hint,
  icon = "satellite_alt",
}: {
  title: string;
  hint?: string;
  icon?: string;
}) {
  return (
    <div className="dot-matrix flex flex-col items-center justify-center rounded-lg py-10 text-center">
      <span className="material-symbols-outlined text-[28px] text-on-surface-variant/40">
        {icon}
      </span>
      <p className="mt-3 text-sm text-on-surface-variant">{title}</p>
      {hint && (
        <p className="mt-1 max-w-xs text-xs leading-relaxed text-on-surface-variant/60">
          {hint}
        </p>
      )}
    </div>
  );
}
