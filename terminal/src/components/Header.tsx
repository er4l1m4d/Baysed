"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { IconSearch, IconBell, IconMenu } from "./Icons";
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

  function navigateTo(href: string) {
    setSearchOpen(false);
    setQuery("");
    router.push(href);
  }

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-4 border-b border-zinc-800/60 bg-[#09090b]/90 px-4 backdrop-blur-sm md:px-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-3">
        <button
          onClick={onOpenMobileNav}
          aria-label="Open menu"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-white md:hidden"
        >
          <IconMenu width={18} height={18} />
        </button>
        <nav aria-label="Breadcrumb" className="hidden items-center gap-1.5 text-[13px] sm:flex">
          <Link href="/" className="text-zinc-400 transition-colors hover:text-zinc-200">
            Dashboard
          </Link>
          <span className="text-zinc-600" aria-hidden>/</span>
          <span className="font-medium text-white">{pageName}</span>
        </nav>
      </div>

      {/* Search + bell + avatar */}
      <div className="flex items-center gap-3">
        <div ref={searchRef} className="relative">
          <div className="flex h-9 w-44 items-center gap-2 rounded-full border border-zinc-700 bg-zinc-800 px-3.5 transition-colors duration-150 focus-within:border-amber-500 sm:w-60">
            <IconSearch width={15} height={15} className="shrink-0 text-zinc-500" />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && matches.length > 0) navigateTo(matches[0][0]);
                if (e.key === "Escape") setSearchOpen(false);
              }}
              placeholder="Search..."
              aria-label="Search pages"
              className="w-full bg-transparent text-[13px] text-white placeholder-zinc-500 outline-none"
            />
          </div>

          {searchOpen && (
            <div className="absolute right-0 top-11 w-52 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl">
              {matches.length === 0 ? (
                <p className="px-3.5 py-2 text-xs text-zinc-500">No matches</p>
              ) : (
                matches.map(([href, name]) => (
                  <button
                    key={href}
                    onClick={() => navigateTo(href)}
                    className={`block w-full px-3.5 py-2 text-left text-[13px] transition-colors hover:bg-zinc-800 ${
                      pathname === href ? "text-amber-400" : "text-zinc-300"
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
          className="relative flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
        >
          <IconBell width={18} height={18} />
          {pending > 0 && (
            <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-amber-500 ring-2 ring-[#09090b]" />
          )}
        </Link>

        <Link
          href="/settings"
          aria-label="Settings"
          className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-700 bg-zinc-800 text-xs font-semibold text-zinc-300 transition-colors hover:border-amber-500/50 hover:text-amber-400"
        >
          B
        </Link>
      </div>
    </header>
  );
}
