"use client";

// apps/finance/src/components/shell.tsx
//
// Navigation: a sidebar at ≥1024px, a bottom tab bar below it (DESIGN.md
// rule 9). The bottom bar's "More" sheet uses the native Popover API, so it
// opens without a line of state and closes on Esc or an outside tap for free.

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChartPie,
  Landmark,
  LayoutDashboard,
  Menu,
  PiggyBank,
  PlugZap,
  Target,
  Telescope,
  Waves,
  type LucideIcon,
} from "lucide-react";
import clsx from "clsx";

type NavItem = { href: string; label: string; icon: LucideIcon };

export const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: "Your money",
    items: [
      { href: "/", label: "Overview", icon: LayoutDashboard },
      { href: "/cash-flow", label: "Cash flow", icon: Waves },
      { href: "/spending", label: "Spending", icon: ChartPie },
      { href: "/budgets", label: "Budgets", icon: Target },
    ],
  },
  {
    group: "Your future",
    items: [
      { href: "/future", label: "Future", icon: Telescope },
      { href: "/goals", label: "Goals", icon: PiggyBank },
      { href: "/net-worth", label: "Net worth", icon: Landmark },
    ],
  },
];

const CONNECTIONS: NavItem = { href: "/connections", label: "Connections", icon: PlugZap };
const TABS = ["/", "/spending", "/budgets", "/future"];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function PrismMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <defs>
        <linearGradient id="prism-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--c-1)" />
          <stop offset="55%" stopColor="var(--c-2)" />
          <stop offset="100%" stopColor="var(--c-5)" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#prism-mark)" />
      <path d="M16 7 L25 23 H7 Z" fill="none" stroke="var(--on-hero)" strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M16 7 L19.5 23" stroke="var(--on-hero-soft)" strokeWidth="1.6" />
    </svg>
  );
}

export function Sidebar({ householdName, sourceLabel }: { householdName: string; sourceLabel: string }) {
  const pathname = usePathname();
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
          {item.label}
        </Link>
      </li>
    );
  };
  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-line bg-surface-1/70 px-3 py-5 backdrop-blur-xl lg:flex">
      <Link href="/" className="mb-7 flex items-center gap-2.5 px-3">
        <PrismMark className="size-8" />
        <span className="text-xl font-extrabold tracking-tight text-ink-1">Prism</span>
      </Link>
      <nav aria-label="Main" className="-mx-3 flex-1 overflow-y-auto px-3">
        {NAV.map((g) => (
          <div key={g.group} className="mb-6">
            <div className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-3">{g.group}</div>
            <ul className="space-y-0.5">{g.items.map(link)}</ul>
          </div>
        ))}
      </nav>
      <ul className="border-t border-line pt-3">{link(CONNECTIONS)}</ul>
      <div className="mt-3 flex items-center gap-3 rounded-ctl bg-surface-2 p-3">
        <div className="bg-prism grid size-9 place-items-center rounded-full text-sm font-bold text-[var(--on-hero)]">{householdName.slice(0, 1)}</div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-ink-1">{householdName}</div>
          <div className="truncate text-xs text-ink-3">{sourceLabel}</div>
        </div>
      </div>
    </aside>
  );
}

export function BottomNav() {
  const pathname = usePathname();
  const all = NAV.flatMap((g) => g.items);
  const tabs = TABS.map((h) => all.find((i) => i.href === h)!);
  const more = [...all.filter((i) => !TABS.includes(i.href)), CONNECTIONS];
  const moreActive = more.some((i) => isActive(pathname, i.href));
  return (
    <>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface-1/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
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
                  {item.label}
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
              More
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
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}
