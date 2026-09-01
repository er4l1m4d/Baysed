"use client";

import { useCallback, useEffect, useState } from "react";
import { Sidebar, MobileSidebar } from "./Sidebar";
import { Header } from "./Header";

const STORAGE_KEY = "baysed.sidebar.collapsed";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Restore preference + auto-collapse below 1024px
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) setCollapsed(stored === "1");

    const mq = window.matchMedia("(max-width: 1024px)");
    const apply = () => {
      if (mq.matches) {
        setCollapsed(true);
      } else if (stored !== null) {
        setCollapsed(stored === "1");
      }
    };
    apply();
    setHydrated(true);
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  }, []);

  return (
    <div className="min-h-screen">
      <Sidebar collapsed={collapsed} onToggle={toggle} />
      <MobileSidebar open={mobileOpen} onClose={() => setMobileOpen(false)} />

      <div
        className={`flex min-h-screen flex-col transition-[padding] duration-200 ease-out ${
          collapsed ? "md:pl-16" : "md:pl-60"
        } ${hydrated ? "" : "md:pl-60"}`}
      >
        <Header onOpenMobileNav={() => setMobileOpen(true)} />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-6">
          {children}
        </main>
      </div>
    </div>
  );
}
