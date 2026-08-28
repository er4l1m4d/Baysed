import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bayse Terminal",
  description: "Real-time trading terminal for Bayse prediction markets",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-950 text-gray-100 min-h-screen">
        <nav className="border-b border-gray-800 px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xl font-bold text-emerald-400">
              Bayse Terminal
            </span>
            <span className="text-xs text-gray-500">v1.0</span>
          </div>
          <div className="flex gap-6 text-sm">
            <a href="/" className="hover:text-emerald-400 transition-colors">
              Dashboard
            </a>
            <a
              href="/analytics"
              className="hover:text-emerald-400 transition-colors"
            >
              Analytics
            </a>
            <a
              href="/predictions"
              className="hover:text-emerald-400 transition-colors"
            >
              Predictions
            </a>
          </div>
        </nav>
        <main className="p-6">{children}</main>
      </body>
    </html>
  );
}
