"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCalibration } from "@/hooks/useBayseData";

const ROUTE_NAMES: Record<string, string> = {
  "/": "Overview",
  "/predictions": "Predictions",
  "/live-market": "Live Market",
  "/calibration": "Calibration",
  "/resolution": "Resolution",
  "/settings": "Settings",
};

export function Header({ onOpenMobileNav }: { onOpenMobileNav: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { calibration } = useCalibration();

  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const pageName = ROUTE_NAMES[pathname] ?? "Overview";
  const pending = calibration?.pending ?? 0;

  const matches =
    query.trim().length > 0
      ? Object.entries(ROUTE_NAMES).filter(([, name]) =>
          name.toLowerCase().includes(query.trim().toLowerCase())
        )
      : Object.entries(ROUTE_NAMES);

  // Close search on outside click
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  // ⌘K / Ctrl+K focuses the search
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setSearchOpen(true);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  function navigateTo(href: string) {
    setSearchOpen(false);
    setQuery("");
    router.push(href);
  }

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-4 border-b border-border-subtle bg-background/80 px-4 backdrop-blur-md md:px-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-3">
        <button
          onClick={onOpenMobileNav}
          aria-label="Open menu"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface md:hidden"
        >
          <span className="material-symbols-outlined text-[18px]">menu</span>
        </button>
        <nav
          aria-label="Breadcrumb"
          className="hidden items-center gap-1.5 sm:flex"
        >
          <Link
            href="/"
            className="label-caps text-on-surface-variant transition-colors hover:text-primary-container"
          >
            Baysed
          </Link>
          <span className="material-symbols-outlined text-[14px] text-on-surface-variant/50">
            chevron_right
          </span>
          <span className="label-caps font-bold tracking-widest text-primary-container">
            {pageName}
          </span>
        </nav>
      </div>

      {/* Search + bell + avatar */}
      <div className="flex items-center gap-3">
        <div ref={searchRef} className="relative">
          <div className="flex h-9 w-44 items-center rounded-full border border-border-subtle bg-surface-container-lowest pl-3 pr-2 transition-colors duration-150 focus-within:border-primary-container/60 sm:w-60">
            <span className="material-symbols-outlined text-[15px] text-primary-container/50">
              search
            </span>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && matches.length > 0)
                  navigateTo(matches[0][0]);
                if (e.key === "Escape") setSearchOpen(false);
              }}
              placeholder="SEARCH..."
              aria-label="Search pages"
              className="label-caps w-full bg-transparent pl-2 text-primary-container/90 placeholder:text-primary-container/30 outline-none"
            />
            <span className="label-caps-sm hidden gap-1 md:flex">
              <kbd className="rounded border border-border-subtle bg-surface-container px-1.5 py-0.5 text-[9px] text-on-surface-variant">
                ⌘
              </kbd>
              <kbd className="rounded border border-border-subtle bg-surface-container px-1.5 py-0.5 text-[9px] text-on-surface-variant">
                K
              </kbd>
            </span>
          </div>

          {searchOpen && (
            <div className="glass-card absolute right-0 top-11 w-52 overflow-hidden rounded-lg py-1 shadow-xl">
              {matches.length === 0 ? (
                <p className="label-caps-sm px-3.5 py-2.5 text-on-surface-variant/60">
                  No matches
                </p>
              ) : (
                matches.map(([href, name]) => (
                  <button
                    key={href}
                    onClick={() => navigateTo(href)}
                    className={`label-caps block w-full px-3.5 py-2 text-left transition-colors hover:bg-surface-container-high ${
                      pathname === href
                        ? "text-primary-container"
                        : "text-on-surface-variant hover:text-on-surface"
                    }`}
                  >
                    {name}
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        <Link
          href="/resolution"
          aria-label={`Resolution feed, ${pending} pending`}
          className="relative flex h-8 w-8 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
        >
          <span className="material-symbols-outlined text-[18px]">
            notifications
          </span>
          {pending > 0 && (
            <span className="absolute right-1 top-1 h-2 w-2 animate-pulse rounded-full bg-primary-container" />
          )}
        </Link>

        <Link
          href="/settings"
          aria-label="Settings"
          className="flex h-8 w-8 items-center justify-center rounded-full border border-primary-container/30 bg-primary-container/10 text-xs font-bold text-primary-container transition-colors hover:bg-primary-container/20"
        >
          B
        </Link>
      </div>
    </header>
  );
}
