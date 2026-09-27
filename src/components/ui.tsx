// apps/finance/src/components/ui.tsx
//
// The small set of building blocks every screen is made of. Server-safe (no
// client state); interactive pieces live in their own "use client" files.

import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  CircleCheck,
  CircleAlert,
  OctagonAlert,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import clsx from "clsx";

export function Card({
  children,
  className,
  as: As = "section",
  hero = false,
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article" | "li";
  /** The one hero-gradient card on a screen (DESIGN.md rule 6). */
  hero?: boolean;
}) {
  return (
    <As
      data-hero={hero ? "" : undefined}
      className={clsx(
        "fade-up rounded-card",
        hero ? "bg-prism text-[var(--on-hero)] shadow-hero" : "border border-line bg-surface-1 shadow-card",
        className,
      )}
    >
      {children}
    </As>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("flex items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-bold tracking-tight text-ink-1">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-[13px] text-ink-3">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function PageHeader({ eyebrow, title, subtitle, action }: { eyebrow?: string; title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow ? <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">{eyebrow}</div> : null}
        <h1 className="text-2xl font-extrabold tracking-tight text-ink-1 sm:text-[28px]">{title}</h1>
        {subtitle ? <p className="mt-1 max-w-2xl text-sm text-ink-2">{subtitle}</p> : null}
      </div>
      {action}
    </header>
  );
}

/**
 * A signed change with its direction as an arrow AND a signed number — never
 * colour alone. `goodWhenUp` decides the colour: income up is good, spending
 * up is not.
 */
export function Change({
  text,
  up,
  goodWhenUp = true,
  suffix,
  onHero = false,
}: {
  text: string;
  up: boolean | null;
  goodWhenUp?: boolean;
  suffix?: string;
  onHero?: boolean;
}) {
  const good = up === null ? null : up === goodWhenUp;
  const Icon = up === null ? null : up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-0.5 text-xs font-semibold",
        onHero ? "text-[var(--on-hero)]" : good === null ? "text-ink-2" : good ? "text-good-ink" : "text-crit-ink",
      )}
    >
      {Icon ? <Icon aria-hidden className="size-3.5" strokeWidth={2.5} /> : null}
      <span className="num">{text}</span>
      {suffix ? <span className={clsx("ml-1 font-medium", onHero ? "text-[var(--on-hero-soft)]" : "text-ink-3")}>{suffix}</span> : null}
    </span>
  );
}

export type Status = "good" | "warn" | "serious" | "crit" | "neutral" | "syncing";

const STATUS: Record<Status, { icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>; tone: string }> = {
  good: { icon: CircleCheck, tone: "text-good" },
  warn: { icon: TriangleAlert, tone: "text-warn" },
  serious: { icon: CircleAlert, tone: "text-serious" },
  crit: { icon: OctagonAlert, tone: "text-crit" },
  neutral: { icon: CircleCheck, tone: "text-ink-3" },
  syncing: { icon: RefreshCw, tone: "text-accent" },
};

/** Status is an icon AND a word, never colour alone (DESIGN.md rule 3). */
export function StatusPill({ status, children, className }: { status: Status; children: ReactNode; className?: string }) {
  const { icon: Icon, tone } = STATUS[status];
  return (
    <span className={clsx("inline-flex items-center gap-1 rounded-pill bg-surface-2 px-2 py-0.5 text-xs font-semibold text-ink-1", className)}>
      <Icon aria-hidden className={clsx("size-3.5", tone)} />
      {children}
    </span>
  );
}

export function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={clsx("inline-flex items-center gap-1 rounded-pill bg-surface-2 px-2.5 py-1 text-xs font-semibold text-ink-2", className)}>{children}</span>;
}

export function ButtonLink({
  href,
  children,
  variant = "ghost",
  className,
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "ghost";
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={clsx(
        "inline-flex h-9 items-center gap-1.5 rounded-ctl px-3.5 text-sm font-semibold transition-colors duration-150",
        variant === "primary" ? "bg-button text-ink-on-accent hover:bg-button-hover" : "border border-line-strong text-ink-1 hover:bg-surface-3",
        className,
      )}
    >
      {children}
    </Link>
  );
}

/** Empty states sell the feature: what appears here, and the action that causes it. */
export function EmptyState({ icon: Icon, title, body, action }: { icon: ComponentType<{ className?: string }>; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <div className="grid size-12 place-items-center rounded-card bg-accent-soft text-accent">
        <Icon className="size-6" />
      </div>
      <div>
        <div className="text-[15px] font-bold text-ink-1">{title}</div>
        <p className="mx-auto mt-1 max-w-sm text-sm text-ink-2">{body}</p>
      </div>
      {action}
    </div>
  );
}

export function Meter({ ratio, color, marker, label }: { ratio: number; color: string; marker?: number; label: string }) {
  const pct = Math.min(100, Math.max(0, ratio * 100));
  return (
    <div className="relative h-2 w-full rounded-pill" style={{ background: `color-mix(in srgb, ${color} 16%, transparent)` }} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)}>
      <div className="h-full rounded-pill" style={{ width: `${pct}%`, background: color }} />
      {marker !== undefined ? (
        <div aria-hidden className="absolute -top-1 h-4 w-0.5 rounded-pill bg-ink-1" style={{ left: `calc(${Math.min(100, marker * 100)}% - 1px)` }} />
      ) : null}
    </div>
  );
}
