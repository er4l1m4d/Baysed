import type { ReactNode } from "react";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-zinc-800 bg-zinc-900 transition-[border-color,transform] duration-150 hover:border-zinc-700 ${className}`}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 pt-5">
      <div>
        <h2 className="text-base font-semibold text-white">{title}</h2>
        {subtitle && (
          <p className="mt-0.5 text-[13px] text-zinc-400">{subtitle}</p>
        )}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  subtitle,
  dot,
  loading,
}: {
  label: string;
  value: string;
  subtitle?: string;
  dot?: "green" | "gold" | "red";
  loading?: boolean;
}) {
  const dotColor =
    dot === "green" ? "bg-emerald-500" : dot === "gold" ? "bg-amber-500" : dot === "red" ? "bg-rose-500" : "bg-zinc-600";

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${dotColor}`} />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
          {label}
        </span>
      </div>
      {loading ? (
        <div className="skeleton mt-3 h-8 w-20" />
      ) : (
        <div className="tabular mt-2 text-[28px] font-bold leading-tight text-white">
          {value}
        </div>
      )}
      {subtitle && (
        <div className="mt-1 text-xs text-zinc-400">{subtitle}</div>
      )}
    </Card>
  );
}

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
    <div className="flex gap-1.5" role="tablist">
      {options.map((opt) => {
        const active = opt === value;
        return (
          <button
            key={opt}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt)}
            className={`h-7 rounded-full px-3 text-xs font-medium transition-colors duration-150 ${
              active
                ? "bg-amber-500 text-black"
                : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
            }`}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

export function OutcomePill({ outcome }: { outcome: "YES" | "NO" }) {
  return (
    <span
      className={`inline-flex h-5 items-center rounded-full px-2 text-[11px] font-semibold ${
        outcome === "YES"
          ? "bg-emerald-500/15 text-emerald-400"
          : "bg-rose-500/15 text-rose-400"
      }`}
    >
      {outcome}
    </span>
  );
}

export function EmptyState({
  title,
  hint,
}: {
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-zinc-700" aria-hidden>
        <path d="M3 3v18h18" strokeLinecap="round" />
        <path d="M7 14l4-4 3 3 5-6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <p className="mt-3 text-sm text-zinc-400">{title}</p>
      {hint && <p className="mt-1 text-xs text-zinc-600">{hint}</p>}
    </div>
  );
}
