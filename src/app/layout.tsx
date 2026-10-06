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
import { LanguageToggle } from "@/components/language-toggle";
import { LocaleProvider, ScreenLanguage } from "@/components/locale";
import { getLocale } from "@/lib/i18n/server";
import { messagesFor, translator } from "@/lib/i18n/translator";
import { plusFor } from "@/lib/billing/plus";
import { awaitingSecondStep, currentAccount } from "@/lib/supabase/server";
import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-jakarta",
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const t = translator(await getLocale());
  return {
    title: { default: t("{product} — your money in full colour", { product: BRAND.product }), template: `%s · ${BRAND.product}` },
    description: t("See where your money goes, what's coming next, and how far you've come — in one vivid picture. A {company} product.", { company: BRAND.company }),
    applicationName: BRAND.product,
    authors: [{ name: BRAND.company }],
    creator: BRAND.company,
    publisher: BRAND.company,
    // Opened from a phone's Home Screen, Prism runs as its own app (manifest.ts).
    appleWebApp: { capable: true, title: BRAND.product, statusBarStyle: "default" },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: PAGE_COLORS.light },
    { media: "(prefers-color-scheme: dark)", color: PAGE_COLORS.dark },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const data = await getFinance();
  // The household's shared view is part of Prism Plus: someone in the household has to have it.
  const plus = await plusFor(await currentAccount());
  const householdLocked = data.inHousehold && !plus.householdView;
  const locale = await getLocale();
  const t = translator(locale);
  const halfway = data.accountsEnabled && !data.account && (await awaitingSecondStep()) !== null;
  const sourceLabel =
    data.view === "household"
      ? t("Household · {n} shared", { n: data.accounts.length })
      : data.source === "demo"
        ? t("Demo household")
        : t(data.institutions.length === 1 ? "{n} connection" : "{n} connections", { n: data.institutions.length });
  const accountNav: AccountNav = data.accountsEnabled ? { signedIn: data.account !== null, email: data.account?.email ?? null } : null;
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className={`${jakarta.variable} font-sans`}>
        <LocaleProvider locale={locale} messages={messagesFor(locale)}>
          <div className="mx-auto flex max-w-[1480px]">
            <Sidebar householdName={data.household.name} sourceLabel={sourceLabel} account={accountNav} offerPlus={plus.billing && !plus.plus && data.account !== null} />
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
                      {t("Your household: what everyone has chosen to share")}
                    </span>
                  ) : data.source === "demo" ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="size-2 rounded-full bg-accent" aria-hidden />
                      {t("You're viewing a demo household — nothing here is real money.")}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      <span className="size-2 rounded-full bg-good" aria-hidden />
                      {t("Live from {names}", { names: data.institutions.map((i) => i.name).join(", ") })}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {data.inHousehold ? (
                    <div className="hidden sm:block">
                      <ViewSwitch view={data.view} locked={householdLocked} />
                    </div>
                  ) : null}
                  <ConnectBank label={t("Connect")} signInFirst={accountNav?.signedIn === false} className="sm:hidden" />
                  <ConnectBank signInFirst={accountNav?.signedIn === false} className="hidden sm:block" />
                  <LanguageToggle />
                  <ThemeToggle />
                </div>
              </header>
              {data.notice ? (
                <div role="alert" className="mx-4 mt-4 flex items-center gap-2 rounded-ctl border border-line bg-surface-1 px-4 py-3 text-sm text-ink-1 sm:mx-6 lg:mx-8">
                  <TriangleAlert aria-hidden className="size-4 shrink-0 text-warn" />
                  {data.notice}{" "}
                  <Link href="/connections" className="font-semibold text-accent-ink underline-offset-2 hover:underline">
                    {t("Fix it")}
                  </Link>
                </div>
              ) : null}
              {/* On a phone the header has no room to say the money isn't real (the sidebar that also says so is hidden); it says so just under it. */}
              {data.source === "demo" && data.view !== "household" ? (
                <p className="flex items-center gap-2 px-4 pt-3 text-xs text-ink-3 sm:px-6 lg:hidden print:hidden">
                  <span className="size-2 shrink-0 rounded-full bg-accent" aria-hidden />
                  {t("A demo household: nothing here is real money.")}
                </p>
              ) : null}
              {/* On a phone the header has no room for the switch; it sits just under it. */}
              {data.inHousehold ? (
                <div className="px-4 pt-3 sm:hidden">
                  <ViewSwitch view={data.view} locked={householdLocked} />
                </div>
              ) : null}
              {halfway ? <HalfwayBanner /> : null}
              {data.carryover.length ? <CarryoverBanner items={data.carryover} /> : null}
              <main className="px-4 pb-28 pt-5 sm:px-6 lg:px-8 lg:pb-14 lg:pt-7">
                <ScreenLanguage>{children}</ScreenLanguage>
                <footer className="mt-12 flex flex-col gap-2 border-t border-line pt-5 text-xs text-ink-3 lg:flex-row lg:items-center lg:justify-between">
                  <span className="flex items-center gap-2">
                    <BisMark size={14} className="shrink-0 text-ink-2" />
                    {t("{product} is a product of {company} ({short}). © {year}", { product: BRAND.product, company: BRAND.company, short: BRAND.companyShort, year: data.today.slice(0, 4) })}
                  </span>
                  <span>
                    {t("Information, not financial advice. Prism can read your accounts but can never move money.")}{" "}
                    <Link href="/privacy" className="font-semibold text-ink-2 hover:underline">
                      {t("Privacy policy")}
                    </Link>
                    {" · "}
                    <Link href="/terms" className="font-semibold text-ink-2 hover:underline">
                      {t("Terms")}
                    </Link>
                  </span>
                </footer>
              </main>
            </div>
          </div>
          <BottomNav account={accountNav} />
        </LocaleProvider>
      </body>
    </html>
  );
}
