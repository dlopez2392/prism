import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { BottomNav, PrismMark, Sidebar } from "@/components/shell";
import { ThemeToggle, THEME_SCRIPT } from "@/components/theme-toggle";
import { ConnectBank } from "@/components/connect-bank";
import { getFinance } from "@/lib/server/finance";
import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-jakarta",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Prism — your money in full colour", template: "%s · Prism" },
  description: "See where your money goes, what's coming next, and how far you've come — in one vivid picture.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f3fb" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0b1a" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const data = await getFinance();
  const sourceLabel = data.source === "demo" ? "Demo household" : `${data.institutions.length} linked ${data.institutions.length === 1 ? "bank" : "banks"}`;
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className={`${jakarta.variable} font-sans`}>
        <div className="mx-auto flex max-w-[1480px]">
          <Sidebar householdName={data.household.name} sourceLabel={sourceLabel} />
          <div className="min-w-0 flex-1">
            <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-line bg-surface-0/75 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
              <Link href="/" className="flex items-center gap-2 lg:hidden">
                <PrismMark className="size-7" />
                <span className="text-lg font-extrabold tracking-tight">Prism</span>
              </Link>
              <div className="hidden text-sm text-ink-3 lg:block">
                {data.source === "demo" ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="size-2 rounded-full bg-accent" aria-hidden />
                    You&apos;re viewing a demo household — nothing here is real money.
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-2">
                    <span className="size-2 rounded-full bg-good" aria-hidden />
                    Live from {data.institutions.map((i) => i.name).join(", ")}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <ConnectBank label="Connect" className="sm:hidden" />
                <ConnectBank className="hidden sm:block" />
                <ThemeToggle />
              </div>
            </header>
            {data.notice ? (
              <div role="alert" className="mx-4 mt-4 flex items-center gap-2 rounded-ctl border border-line bg-surface-1 px-4 py-3 text-sm text-ink-1 sm:mx-6 lg:mx-8">
                <TriangleAlert aria-hidden className="size-4 shrink-0 text-warn" />
                {data.notice}{" "}
                <Link href="/connections" className="font-semibold text-accent-ink underline-offset-2 hover:underline">
                  Fix it
                </Link>
              </div>
            ) : null}
            <main className="px-4 pb-28 pt-5 sm:px-6 lg:px-8 lg:pb-14 lg:pt-7">{children}</main>
          </div>
        </div>
        <BottomNav />
      </body>
    </html>
  );
}
