"use client";

import { useId } from "react";

// src/components/shell.tsx
//
// Navigation: a sidebar at ≥1024px, a bottom tab bar below it (DESIGN.md
// rule 9). The bottom bar's "More" sheet uses the native Popover API, so it
// opens without a line of state and closes on Esc or an outside tap for free.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/components/locale";
import { msg } from "@/lib/i18n/t";
import {
  CalendarRange,
  ChartPie,
  Landmark,
  LayoutDashboard,
  Menu,
  PiggyBank,
  PlugZap,
  ReceiptText,
  Sparkles,
  Target,
  Telescope,
  UserRound,
  Waves,
  type LucideIcon,
} from "lucide-react";
import clsx from "clsx";
import { BisMark } from "@/components/bis-mark";
import { BRAND } from "@/lib/brand";

type NavItem = { href: string; label: string; icon: LucideIcon };

export const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: msg("Your money"),
    items: [
      { href: "/", label: msg("Overview"), icon: LayoutDashboard },
      { href: "/cash-flow", label: msg("Cash flow"), icon: Waves },
      { href: "/spending", label: msg("Spending"), icon: ChartPie },
      { href: "/budgets", label: msg("Budgets"), icon: Target },
      { href: "/year", label: msg("Your year"), icon: CalendarRange },
      { href: "/taxes", label: msg("Taxes"), icon: ReceiptText },
    ],
  },
  {
    group: msg("Your future"),
    items: [
      { href: "/future", label: msg("Future"), icon: Telescope },
      { href: "/goals", label: msg("Goals"), icon: PiggyBank },
      { href: "/net-worth", label: msg("Net worth"), icon: Landmark },
    ],
  },
];

const CONNECTIONS: NavItem = { href: "/connections", label: msg("Connections"), icon: PlugZap };
const TABS = ["/", "/spending", "/budgets", "/future"];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function PrismMark({ className }: { className?: string }) {
  // Each mark owns its gradient. With one shared id, every copy points at the
  // first — and on a phone that one sits in the hidden sidebar, where a
  // display:none gradient paints nothing, so the other marks went blank.
  const gradient = `prism-mark-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--c-1)" />
          <stop offset="55%" stopColor="var(--c-2)" />
          <stop offset="100%" stopColor="var(--c-5)" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${gradient})`} />
      <path d="M16 7 L25 23 H7 Z" fill="none" stroke="var(--on-hero)" strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M16 7 L19.5 23" stroke="var(--on-hero-soft)" strokeWidth="1.6" />
    </svg>
  );
}

/** Where the person goes for their account: Account when signed in, Sign in when accounts exist, nothing otherwise. */
export type AccountNav = { signedIn: boolean; email: string | null } | null;

function accountItem(account: AccountNav): NavItem | null {
  if (!account) return null;
  return account.signedIn ? { href: "/account", label: msg("Account"), icon: UserRound } : { href: "/sign-in", label: msg("Sign in"), icon: UserRound };
}

export function Sidebar({ householdName, sourceLabel, account, offerPlus = false }: { householdName: string; sourceLabel: string; account: AccountNav; offerPlus?: boolean }) {
  const pathname = usePathname();
  const t = useT();
  const link = (item: NavItem) => {
    const active = isActive(pathname, item.href);
    const Icon = item.icon;
    return (
      <li key={item.href}>
        <Link
          href={item.href}
          aria-current={active ? "page" : undefined}
          className={clsx(
            "relative flex h-10 items-center gap-3 rounded-ctl px-3 text-sm font-semibold transition-colors duration-150",
            active ? "bg-accent-soft text-ink-1" : "text-ink-2 hover:bg-surface-3 hover:text-ink-1",
          )}
        >
          {active ? <span aria-hidden className="bg-prism absolute inset-y-2 -left-3 w-[3px] rounded-r-pill" /> : null}
          <Icon aria-hidden className={clsx("size-[18px]", active ? "text-accent" : "")} strokeWidth={2.2} />
          {t(item.label)}
        </Link>
      </li>
    );
  };
  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-line bg-surface-1/70 px-3 py-5 backdrop-blur-xl lg:flex print:hidden">
      <Link href="/" className="mb-7 flex items-center gap-2.5 px-3" aria-label={t("{product} by {company} — overview", { product: BRAND.product, company: BRAND.company })}>
        <PrismMark className="size-8" />
        <span className="leading-tight">
          <span className="block text-xl font-extrabold tracking-tight text-ink-1">{BRAND.product}</span>
          <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-3">
            <BisMark size={10} /> {t("by {company}", { company: BRAND.companyShort })}
          </span>
        </span>
      </Link>
      <nav aria-label={t("Main")} className="-mx-3 flex-1 overflow-y-auto px-3">
        {NAV.map((g) => (
          <div key={g.group} className="mb-6">
            <div className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-3">{t(g.group)}</div>
            <ul className="space-y-0.5">{g.items.map(link)}</ul>
          </div>
        ))}
      </nav>
      <ul className="border-t border-line pt-3">
        {link(CONNECTIONS)}
        {/* Billing is on and they're on the free plan: one quiet way to see what Plus adds. */}
        {offerPlus ? link({ href: "/pricing", label: BRAND.plus, icon: Sparkles }) : null}
      </ul>
      {account?.signedIn ? (
        <Link href="/account" className="mt-3 flex items-center gap-3 rounded-ctl bg-surface-2 p-3 transition-colors duration-150 hover:bg-surface-3">
          <div className="bg-prism grid size-9 shrink-0 place-items-center rounded-full text-sm font-bold text-[var(--on-hero)]">{householdName.slice(0, 1)}</div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-ink-1">{householdName}</div>
            <div className="truncate text-xs text-ink-3">{account.email ?? sourceLabel}</div>
          </div>
        </Link>
      ) : (
        <div className="mt-3 rounded-ctl bg-surface-2 p-3">
          <div className="flex items-center gap-3">
            <div className="bg-prism grid size-9 shrink-0 place-items-center rounded-full text-sm font-bold text-[var(--on-hero)]">{householdName.slice(0, 1)}</div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-ink-1">{householdName}</div>
              <div className="truncate text-xs text-ink-3">{sourceLabel}</div>
            </div>
          </div>
          {account ? (
            <Link
              href="/sign-in"
              className="mt-3 flex h-9 items-center justify-center gap-1.5 rounded-ctl border border-line-strong text-sm font-semibold text-ink-1 transition-colors duration-150 hover:bg-surface-3"
            >
              <UserRound aria-hidden className="size-4" />
              {t("Sign in")}
            </Link>
          ) : null}
        </div>
      )}
    </aside>
  );
}

export function BottomNav({ account }: { account: AccountNav }) {
  const pathname = usePathname();
  const t = useT();
  const all = NAV.flatMap((g) => g.items);
  const tabs = TABS.map((h) => all.find((i) => i.href === h)!);
  const you = accountItem(account);
  const more = [...all.filter((i) => !TABS.includes(i.href)), CONNECTIONS, ...(you ? [you] : [])];
  const moreActive = more.some((i) => isActive(pathname, i.href));
  return (
    <>
      <nav
        aria-label={t("Main")}
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface-1/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden print:hidden"
      >
        <ul className="mx-auto grid max-w-lg grid-cols-5">
          {tabs.map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={clsx("flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold", active ? "text-accent-ink" : "text-ink-3")}
                >
                  <Icon aria-hidden className="size-5" strokeWidth={2.2} />
                  {t(item.label)}
                </Link>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              popoverTarget="more-sheet"
              className={clsx("flex h-16 w-full flex-col items-center justify-center gap-1 text-[11px] font-semibold", moreActive ? "text-accent-ink" : "text-ink-3")}
            >
              <Menu aria-hidden className="size-5" strokeWidth={2.2} />
              {t("More")}
            </button>
          </li>
        </ul>
      </nav>
      <div
        id="more-sheet"
        popover="auto"
        className="fixed inset-x-3 top-auto bottom-20 m-0 mx-auto w-auto max-w-lg rounded-card border border-line bg-surface-1 p-2 text-ink-1 shadow-pop backdrop:bg-transparent"
      >
        <ul>
          {more.map((item) => {
            const Icon = item.icon;
            const active = isActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  onClick={() => document.getElementById("more-sheet")?.hidePopover()}
                  className={clsx("flex h-12 items-center gap-3 rounded-ctl px-3 text-sm font-semibold", active ? "bg-accent-soft text-ink-1" : "text-ink-2 hover:bg-surface-3")}
                >
                  <Icon aria-hidden className="size-[18px]" />
                  {t(item.label)}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}
