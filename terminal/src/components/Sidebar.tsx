"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LogoMark,
  IconGrid,
  IconActivity,
  IconRadio,
  IconTarget,
  IconFlag,
  IconGear,
  IconChevronLeft,
  IconChevronRight,
  IconX,
} from "./Icons";

const NAV_ITEMS = [
  { href: "/", label: "Overview", Icon: IconGrid },
  { href: "/predictions", label: "Predictions", Icon: IconActivity },
  { href: "/live-market", label: "Live Market", Icon: IconRadio },
  { href: "/calibration", label: "Calibration", Icon: IconTarget },
  { href: "/resolution", label: "Resolution", Icon: IconFlag },
  { href: "/settings", label: "Settings", Icon: IconGear },
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
      {NAV_ITEMS.map(({ href, label, Icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            title={collapsed ? label : undefined}
            className={`group relative flex h-11 items-center rounded-lg transition-colors duration-150 ${
              collapsed ? "justify-center" : "gap-3 px-4"
            } ${
              active
                ? "bg-amber-500/10 text-white"
                : "text-zinc-500 hover:bg-amber-500/5 hover:text-zinc-200"
            }`}
          >
            <Icon
              width={20}
              height={20}
              className={active ? "text-amber-500" : ""}
            />
            {!collapsed && (
              <span className="text-sm font-medium">{label}</span>
            )}
            {/* Tooltip when collapsed */}
            {collapsed && (
              <span className="pointer-events-none absolute left-full z-50 ml-3 hidden whitespace-nowrap rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-200 shadow-lg group-hover:block">
                {label}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
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
      className={`fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-zinc-800/60 bg-[#0c0c0f] transition-[width] duration-200 ease-out md:flex ${
        collapsed ? "w-16" : "w-60"
      }`}
    >
      {/* Logo */}
      <div
        className={`flex h-14 shrink-0 items-center border-b border-zinc-800/60 ${
          collapsed ? "justify-center px-0" : "px-5"
        }`}
      >
        <Link href="/" className="flex items-center gap-2.5" aria-label="Baysed home">
          <LogoMark size={24} />
          {!collapsed && (
            <span className="text-sm font-bold uppercase tracking-[0.2em] text-white">
              Baysed
            </span>
          )}
        </Link>
      </div>

      <div className="mt-6 flex-1">
        <NavList collapsed={collapsed} />
      </div>

      {/* Collapse toggle */}
      <div className="border-t border-zinc-800/60 p-3">
        <button
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={`flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition-colors duration-150 hover:bg-zinc-800 hover:text-white ${
            collapsed ? "mx-auto" : "ml-auto"
          }`}
        >
          {collapsed ? <IconChevronRight width={16} height={16} /> : <IconChevronLeft width={16} height={16} />}
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
        className={`fixed inset-0 z-50 bg-black/60 transition-opacity duration-200 md:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      {/* Drawer */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-zinc-800/60 bg-[#0c0c0f] transition-transform duration-200 ease-out md:hidden ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-label="Sidebar"
        aria-hidden={!open}
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-800/60 px-5">
          <Link href="/" onClick={onClose} className="flex items-center gap-2.5">
            <LogoMark size={24} />
            <span className="text-sm font-bold uppercase tracking-[0.2em] text-white">
              Baysed
            </span>
          </Link>
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-white"
          >
            <IconX width={18} height={18} />
          </button>
        </div>
        <div className="mt-6 flex-1">
          <NavList collapsed={false} onNavigate={onClose} />
        </div>
      </aside>
    </>
  );
}
