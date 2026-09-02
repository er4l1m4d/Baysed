"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePipelineHealth } from "@/hooks/useBayseData";

const NAV_ITEMS = [
  { href: "/", label: "Overview", icon: "dashboard" },
  { href: "/predictions", label: "Predictions", icon: "query_stats" },
  { href: "/live-market", label: "Live Market", icon: "show_chart" },
  { href: "/calibration", label: "Calibration", icon: "monitoring" },
  { href: "/resolution", label: "Resolution", icon: "fact_check" },
  { href: "/settings", label: "Settings", icon: "settings" },
] as const;

function NavList({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1 px-3" aria-label="Main">
      {NAV_ITEMS.map(({ href, label, icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            title={collapsed ? label : undefined}
            className={`group relative flex h-10 items-center rounded-lg border-l-2 transition-colors duration-150 ${
              collapsed ? "justify-center" : "gap-3 px-4"
            } ${
                active
                ? "border-transparent bg-on-surface text-background shadow-[0_4px_12px_rgba(0,0,0,0.24)]"
                : "border-transparent text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
            }`}
          >
            <span
              className={`material-symbols-outlined text-[18px] ${
                active ? "ms-fill" : ""
              }`}
            >
              {icon}
            </span>
            {!collapsed && (
              <span className="label-caps text-[12px]">{label}</span>
            )}
            {/* Tooltip when collapsed */}
            {collapsed && (
              <span className="pointer-events-none absolute left-full z-50 ml-3 hidden whitespace-nowrap rounded-md border border-border-subtle bg-surface-container px-2.5 py-1.5 text-xs font-medium text-on-surface shadow-lg group-hover:block">
                {label}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* Engine Core — pipeline health widget (sidebar footer)               */
/* ------------------------------------------------------------------ */

function EngineCore() {
  const { health, loading } = usePipelineHealth();

  const engineUp = !!health?.engine.started;
  const feedsUp =
    !!health?.btc_feed.connected && !!health?.market_feed.connected;
  const status: "NOMINAL" | "DEGRADED" | "DOWN" | "…" = loading
    ? "…"
    : !engineUp
      ? "DOWN"
      : feedsUp
        ? "NOMINAL"
        : "DEGRADED";

  const badgeStyle =
    status === "NOMINAL"
      ? "bg-primary-container/10 text-primary-container"
      : status === "DEGRADED"
        ? "bg-warning-gold/10 text-warning-gold"
        : status === "DOWN"
          ? "bg-error/10 text-error"
          : "bg-surface-bright/50 text-on-surface-variant";

  const total = health?.predictions.total ?? 0;
  const resolved = health?.predictions.resolved ?? 0;
  const ratio = total > 0 ? resolved / total : 0;

  return (
    <div className="mb-4 rounded-lg border border-border-subtle bg-surface-container-low p-4">
      <div className="mb-2.5 flex items-center justify-between">
        <span className="label-caps-sm flex items-center gap-1.5 text-on-surface-variant">
          <span className="material-symbols-outlined text-[15px] text-primary-container">
            shield
          </span>
          Engine Core
        </span>
        <span
          className={`label-caps-sm rounded px-2 py-0.5 tracking-widest ${badgeStyle}`}
        >
          {status}
        </span>
      </div>

      <div className="label-caps-sm mb-1.5 flex justify-between text-on-surface-variant">
        <span>RESOLVED</span>
        <span className="tabular text-on-surface">
          {resolved}/{total}
        </span>
      </div>
      <div className="mb-2.5 h-1 w-full overflow-hidden rounded-full bg-surface-bright">
        <div
          className="progress-bar-striped h-full bg-primary-container transition-[width] duration-500"
          style={{ width: `${Math.round(ratio * 100)}%` }}
        />
      </div>

      <div className="label-caps-sm flex items-center gap-1.5 leading-tight text-on-surface-variant">
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            status === "NOMINAL"
              ? "animate-pulse bg-primary-container"
              : status === "DEGRADED"
                ? "bg-warning-gold"
                : status === "DOWN"
                  ? "bg-error"
                  : "bg-surface-bright"
          }`}
        />
        FEED {feedsUp ? "LIVE" : engineUp ? "RECONNECTING" : "OFFLINE"}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sidebar shells                                                      */
/* ------------------------------------------------------------------ */

function Logo({ collapsed }: { collapsed: boolean }) {
  return (
    <Link
      href="/"
      className="flex items-center gap-3"
      aria-label="Baysed home"
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-primary-container text-[15px] font-bold text-on-primary">
        B
      </div>
      {!collapsed && (
        <div>
          <h1 className="text-[17px] font-semibold leading-tight tracking-tight text-on-surface">
            Bayse
          </h1>
          <p className="label-caps-sm text-on-surface-variant/70">
            Tactical Terminal
          </p>
        </div>
      )}
    </Link>
  );
}

export function Sidebar({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-border-subtle bg-surface transition-[width] duration-200 ease-out md:flex ${
        collapsed ? "w-16" : "w-52"
      }`}
    >
      <div
        className={`flex h-14 shrink-0 items-center border-b border-border-subtle ${
          collapsed ? "justify-center" : "px-5"
        }`}
      >
        <Logo collapsed={collapsed} />
      </div>

      <div className="mt-5 flex-1 overflow-y-auto">
        <NavList collapsed={collapsed} />
      </div>

      {/* Engine core status */}
      {!collapsed && (
        <div className="mt-auto px-3">
          <EngineCore />
        </div>
      )}

      {/* Collapse toggle */}
      <div className="border-t border-border-subtle p-3">
        <button
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={`flex h-8 w-8 items-center justify-center rounded-lg text-on-surface-variant transition-colors duration-150 hover:bg-surface-container-high hover:text-primary-container ${
            collapsed ? "mx-auto" : "ml-auto"
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">
            {collapsed ? "keyboard_double_arrow_right" : "keyboard_double_arrow_left"}
          </span>
        </button>
      </div>
    </aside>
  );
}

export function MobileSidebar({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        aria-hidden
        className={`fixed inset-0 z-50 bg-black/70 transition-opacity duration-200 md:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      {/* Drawer */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-border-subtle bg-surface transition-transform duration-200 ease-out md:hidden ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-label="Sidebar"
        aria-hidden={!open}
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border-subtle px-5">
          <Logo collapsed={false} />
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
        <div className="mt-5 flex-1 overflow-y-auto">
          <NavList collapsed={false} onNavigate={onClose} />
        </div>
        <div className="mt-auto px-3 pb-4">
          <EngineCore />
        </div>
      </aside>
    </>
  );
}
