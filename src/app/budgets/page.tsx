// src/app/budgets/page.tsx — this month's budgets.
//
// Hero (the one --gradient-prism card): how much of the month's plan is left.
// Each budget then gets a ring with a "today" tick — if the colour is behind
// the tick you're under pace — and the bullet chart puts spent, projected and
// the limit on one line per category.

import type { Metadata } from "next";
import { CircleCheck, OctagonAlert, Target, TriangleAlert } from "lucide-react";
import { BudgetEditor } from "@/components/budget-editor";
import { ProgressRing } from "@/components/charts/radial";
import { Key } from "@/components/charts/core";
import { CategoryIcon } from "@/components/category-icon";
import { Card, CardHeader, EmptyState, Meter, PageHeader, StatusPill } from "@/components/ui";
import { daysLeftInMonth, monthEnd, typicalMonthlySpend, type BudgetStatus } from "@/lib/finance/budgets";
import { CATEGORIES, categoryColor } from "@/lib/finance/categories";
import { money0, monthLong, shortDate } from "@/lib/finance/format";
import { analyze } from "@/lib/finance/model";
import { getFinance } from "@/lib/server/finance";

export const metadata: Metadata = { title: "Budgets" };

function state(b: BudgetStatus) {
  if (b.state === "over") return <StatusPill status="crit">Over by {money0(b.spent - b.limit)}</StatusPill>;
  if (b.state === "at_risk") return <StatusPill status="warn">Watch — on pace for {money0(b.projected)}</StatusPill>;
  return <StatusPill status="good">On track</StatusPill>;
}

export default async function BudgetsPage() {
  const data = await getFinance();
  const a = analyze(data);
  const { budgets, budgetTotals: totals } = a;
  const left = daysLeftInMonth(a.today);
  const end = monthEnd(a.today);
  const month = monthLong(a.today);
  const edited = data.planEdited.budgets;
  const drafted = data.source === "plaid" && !edited;
  const editor = (variant: "ghost" | "primary", label?: string) => (
    <BudgetEditor budgets={data.budgets} typical={typicalMonthlySpend(data.transactions, a.today)} edited={edited} variant={variant} label={label} />
  );
  const scale = Math.max(1, ...budgets.map((b) => Math.max(b.limit, b.projected, b.spent))) * 1.08;
  const sorted = [...budgets].sort((x, y) => y.limit - x.limit);

  if (budgets.length === 0) {
    return (
      <div>
        <PageHeader title="Budgets" subtitle={`Your plan for ${month}.`} />
        <Card>
          {edited ? (
            <EmptyState
              icon={Target}
              title="No budgets set"
              body="Give any category a monthly limit and we'll pace your spending against it all month."
              action={editor("primary", "Set a budget")}
            />
          ) : (
            <EmptyState
              icon={Target}
              title="Budgets appear once there's a month of spending"
              body="We draft a budget per category from your last three months, so you start from what's real. Or set your own now."
              action={editor("primary", "Set a budget")}
            />
          )}
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`${left} ${left === 1 ? "day" : "days"} left in ${month}`}
        title="Budgets"
        subtitle={
          drafted
            ? "Drafted from your last three months — a starting point from what's real. Change any line to make it yours."
            : edited
              ? `Your plan for ${month}, saved on this device, and how it's going.`
              : `Your plan for ${month}, and how it's going.`
        }
        action={editor("ghost")}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <Card hero className="p-5 sm:p-6 lg:col-span-5">
          <div className="text-sm font-semibold text-[var(--on-hero-soft)]">Left to spend in {month}</div>
          <div className="mt-1 text-[48px] font-extrabold leading-none tracking-tight">{money0(Math.max(0, totals.remaining))}</div>
          <p className="mt-2 text-sm text-[var(--on-hero-soft)]">
            About {money0(Math.max(0, totals.remaining) / left)} a day for the next {left} {left === 1 ? "day" : "days"}.
          </p>
          <div className="mt-6 h-3 w-full overflow-hidden rounded-pill bg-[var(--on-hero-faint)]">
            <div className="h-full rounded-pill bg-[var(--on-hero)]" style={{ width: `${Math.min(100, (totals.spent / totals.limit) * 100)}%` }} />
          </div>
          <div className="mt-2 flex justify-between text-xs font-semibold text-[var(--on-hero-soft)]">
            <span>{money0(totals.spent)} spent</span>
            <span>{money0(totals.limit)} planned</span>
          </div>
          <dl className="mt-6 grid grid-cols-3 gap-3">
            {[
              { label: "On track", icon: CircleCheck, n: budgets.filter((b) => b.state === "on_track").length },
              { label: "Watch", icon: TriangleAlert, n: budgets.filter((b) => b.state === "at_risk").length },
              { label: "Over", icon: OctagonAlert, n: budgets.filter((b) => b.state === "over").length },
            ].map(({ label, icon: Icon, n }) => (
              <div key={label} className="rounded-ctl bg-[var(--on-hero-faint)] p-3">
                <dt className="flex items-center gap-1.5 text-xs font-semibold text-[var(--on-hero-soft)]">
                  <Icon aria-hidden className="size-3.5" />
                  {label}
                </dt>
                <dd className="mt-1 text-2xl font-extrabold">{n}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card className="p-5 sm:p-6 lg:col-span-7">
          <CardHeader title="Spent, projected and planned" subtitle={`Projection uses what usually lands after today — ${shortDate(end)} is month end`} />
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
            <span className="flex items-center gap-1.5">
              <Key color="var(--c-1)" kind="rect" /> Spent
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="size-2.5 rounded-[3px] bg-[var(--c-1)] opacity-35" /> Still to come (projected)
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="h-3 w-0.5 rounded-pill bg-ink-1" /> Budget
            </span>
          </div>
          <ul className="mt-4 space-y-3">
            {sorted.map((b) => {
              const color = categoryColor(b.category);
              const spentPct = (b.spent / scale) * 100;
              const projPct = (Math.max(0, b.projected - b.spent) / scale) * 100;
              return (
                <li key={b.category} className="grid grid-cols-[88px_1fr_auto] items-center gap-3 sm:grid-cols-[120px_1fr_auto]">
                  <span className="truncate text-sm font-semibold text-ink-1">{CATEGORIES[b.category].label}</span>
                  <div className="relative h-4 rounded-pill bg-surface-2" role="img" aria-label={`${CATEGORIES[b.category].label}: ${money0(b.spent)} spent, ${money0(b.projected)} projected, budget ${money0(b.limit)}`}>
                    <div className="absolute inset-y-0 left-0 h-full rounded-l-pill" style={{ width: `${spentPct}%`, background: color }} />
                    <div className="absolute inset-y-0 h-full rounded-r-pill opacity-35" style={{ left: `calc(${spentPct}% + 2px)`, width: `${projPct}%`, background: color }} />
                    <div className="absolute -inset-y-1 w-0.5 rounded-pill bg-ink-1" style={{ left: `${(b.limit / scale) * 100}%` }} />
                  </div>
                  <span className="num w-24 text-right text-xs text-ink-2 sm:w-28">
                    <span className="font-bold text-ink-1">{money0(b.spent)}</span> / {money0(b.limit)}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {sorted.map((b) => {
          const color = categoryColor(b.category);
          const perDay = Math.max(0, b.remaining) / left;
          return (
            <Card as="li" key={b.category} className="p-5">
              <div className="flex items-center gap-4">
                <ProgressRing
                  ratio={b.used}
                  color={color}
                  tick={b.timeElapsed}
                  size={92}
                  stroke={11}
                  label={`${CATEGORIES[b.category].label}: ${Math.round(b.used * 100)}% of budget used, ${Math.round(b.timeElapsed * 100)}% of the month gone`}
                >
                  <span className="num text-lg font-extrabold text-ink-1">{Math.round(b.used * 100)}%</span>
                </ProgressRing>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <CategoryIcon category={b.category} size="sm" />
                    <span className="truncate text-[15px] font-bold text-ink-1">{CATEGORIES[b.category].label}</span>
                  </div>
                  <div className="num mt-2 text-xl font-extrabold tracking-tight text-ink-1">
                    {money0(b.spent)} <span className="text-sm font-semibold text-ink-3">of {money0(b.limit)}</span>
                  </div>
                  <div className="mt-2">{state(b)}</div>
                </div>
              </div>
              <div className="mt-4 border-t border-line pt-3">
                <Meter ratio={b.used} color={color} marker={b.timeElapsed} label={`${CATEGORIES[b.category].label} budget used`} />
                <div className="mt-2 flex justify-between text-xs text-ink-3">
                  <span>{b.remaining >= 0 ? `${money0(perDay)}/day left` : `${money0(-b.remaining)} over`}</span>
                  <span>Ends near {money0(b.projected)}</span>
                </div>
              </div>
            </Card>
          );
        })}
      </ul>
      <p className="text-xs text-ink-3">The tick on each ring and bar marks how far through {month} you are. Colour behind the tick means you&apos;re under pace.</p>
    </div>
  );
}
