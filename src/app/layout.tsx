import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { BottomNav, PrismMark, Sidebar, type AccountNav } from "@/components/shell";
import { CarryoverBanner } from "@/components/carryover-banner";
import { HalfwayBanner } from "@/components/halfway-banner";
import { ThemeToggle, THEME_SCRIPT } from "@/components/theme-toggle";
import { ConnectBank } from "@/components/connect-bank";
import { ViewSwitch } from "@/components/household";
import { BisMark } from "@/components/bis-mark";
import { BRAND, PAGE_COLORS } from "@/lib/brand";
import { getFinance } from "@/lib/server/finance";
import { awaitingSecondStep } from "@/lib/supabase/server";
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
  title: { default: `${BRAND.product} — your money in full colour`, template: `%s · ${BRAND.product}` },
  description: `See where your money goes, what's coming next, and how far you've come — in one vivid picture. A ${BRAND.company} product.`,
  applicationName: BRAND.product,
  authors: [{ name: BRAND.company }],
  creator: BRAND.company,
  publisher: BRAND.company,
  // Opened from a phone's Home Screen, Prism runs as its own app (manifest.ts).
  appleWebApp: { capable: true, title: BRAND.product, statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: PAGE_COLORS.light },
    { media: "(prefers-color-scheme: dark)", color: PAGE_COLORS.dark },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const data = await getFinance();
  const halfway = data.accountsEnabled && !data.account && (await awaitingSecondStep()) !== null;
  const sourceLabel =
    data.view === "household"
      ? `Household · ${data.accounts.length} shared`
      : data.source === "demo"
        ? "Demo household"
        : `${data.institutions.length} ${data.institutions.length === 1 ? "connection" : "connections"}`;
  const accountNav: AccountNav = data.accountsEnabled ? { signedIn: data.account !== null, email: data.account?.email ?? null } : null;
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className={`${jakarta.variable} font-sans`}>
        <div className="mx-auto flex max-w-[1480px]">
          <Sidebar householdName={data.household.name} sourceLabel={sourceLabel} account={accountNav} />
          <div className="min-w-0 flex-1">
            <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-line bg-surface-0/75 px-4 backdrop-blur-xl sm:px-6 lg:px-8 print:hidden">
              <Link href="/" className="flex items-center gap-2 lg:hidden">
                <PrismMark className="size-7" />
                <span className="text-lg font-extrabold tracking-tight">{BRAND.product}</span>
              </Link>
              <div className="hidden text-sm text-ink-3 lg:block">
                {data.view === "household" ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="size-2 rounded-pill bg-accent" aria-hidden />
                    Your household: what everyone has chosen to share
                  </span>
                ) : data.source === "demo" ? (
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
                {data.inHousehold ? (
                  <div className="hidden sm:block">
                    <ViewSwitch view={data.view} />
                  </div>
                ) : null}
                <ConnectBank label="Connect" signInFirst={accountNav?.signedIn === false} className="sm:hidden" />
                <ConnectBank signInFirst={accountNav?.signedIn === false} className="hidden sm:block" />
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
            {/* On a phone the header has no room for the switch; it sits just under it. */}
            {data.inHousehold ? (
              <div className="px-4 pt-3 sm:hidden">
                <ViewSwitch view={data.view} />
              </div>
            ) : null}
            {halfway ? <HalfwayBanner /> : null}
            {data.carryover.length ? <CarryoverBanner items={data.carryover} /> : null}
            <main className="px-4 pb-28 pt-5 sm:px-6 lg:px-8 lg:pb-14 lg:pt-7">
              {children}
              <footer className="mt-12 flex flex-col gap-2 border-t border-line pt-5 text-xs text-ink-3 lg:flex-row lg:items-center lg:justify-between">
                <span className="flex items-center gap-2">
                  <BisMark size={14} className="shrink-0 text-ink-2" />
                  {BRAND.product} is a product of {BRAND.company} ({BRAND.companyShort}). © {data.today.slice(0, 4)}
                </span>
                <span>
                  Information, not financial advice. Prism can read your accounts but can never move money.{" "}
                  <Link href="/privacy" className="font-semibold text-ink-2 hover:underline">
                    Privacy policy
                  </Link>
                  {" · "}
                  <Link href="/terms" className="font-semibold text-ink-2 hover:underline">
                    Terms
                  </Link>
                </span>
              </footer>
            </main>
          </div>
        </div>
        <BottomNav account={accountNav} />
      </body>
    </html>
  );
}
