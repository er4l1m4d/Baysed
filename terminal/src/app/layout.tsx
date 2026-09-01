import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = {
  title: "Baysed — Research Terminal",
  description:
    "Quantitative research terminal for Baysed, a BTC 15-minute binary prediction engine on Bayse Markets.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#09090b] text-zinc-50 antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
