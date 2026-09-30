// src/app/goals/page.tsx — what you're saving for.
//
// Hero (the one --gradient-prism card): total saved toward every goal. Each
// goal gets a ring; the chart shows progress as a share of each target (so a
// laptop and a house can share one axis honestly), past solid, future dashed.

import type { Metadata } from "next";
import { PiggyBank } from "lucide-react";
import { ChartCard } from "@/components/chart-card";
import { Legend } from "@/components/charts/core";
import { ProgressRing } from "@/components/charts/radial";
import { TimeSeriesChart } from "@/components/charts/time-series";
import { GoalEditor, RestoreGoals } from "@/components/goal-editor";
import { GoalWhatIf } from "@/components/goal-what-if";
import { Card, CardHeader, EmptyState, PageHeader, StatusPill } from "@/components/ui";
import { slotColor } from "@/lib/finance/categories";
import { addMonths, lastMonths } from "@/lib/finance/dates";
import { lastChanged, money0, monthShort, monthYear, percent } from "@/lib/finance/format";
import { projectGoal } from "@/lib/finance/networth";
import { goalSettings, MAX_GOALS } from "@/lib/finance/plan";
import { getFinance } from "@/lib/server/finance";

export const metadata: Metadata = { title: "Goals" };

const AHEAD = 24;

export default async function GoalsPage() {
  // The Me / Household switch decides: the person's own goals, or the ones their household saves toward together.
  const data = await getFinance();
  const { goals, today } = data;
  const household = data.view === "household";
  const settings = goals.map(goalSettings);
  const restore = data.source === "demo" && data.planEdited.goals && !household ? <RestoreGoals /> : null;
  const changed = household ? lastChanged(data.householdPlan?.goalsChanged) : null;
  const editor = (mode: "new" | "empty") => <GoalEditor mode={mode} others={settings} today={today} signedIn={data.account !== null} household={household} />;

  if (goals.length === 0) {
    return (
      <div>
        <PageHeader
          title="Goals"
          subtitle={household ? `What your household is saving for together.${changed ? ` ${changed}` : ""}` : "What you're saving for, and when you'll get there."}
          action={restore}
        />
        <Card>
          {household ? (
            <EmptyState
              icon={PiggyBank}
              title="Your household's goals will live here"
              body="Save toward something together — a trip, a home, a rainy-day fund. Each goal gets a ring, a finish date and a what-if slider, and everyone in the household can update it."
              action={editor("empty")}
            />
          ) : (
            <EmptyState
              icon={PiggyBank}
              title="Your goals will live here"
              body="Name something you're saving for and a monthly amount — each goal gets a ring, a finish date, and a what-if slider."
              action={editor("empty")}
            />
          )}
        </Card>
      </div>
    );
  }

  const saved = goals.reduce((s, g) => s + g.saved, 0);
  const target = goals.reduce((s, g) => s + g.target, 0);
  const monthly = goals.reduce((s, g) => s + g.monthlyContribution, 0);
  const past = lastMonths(today, 13);
  const months = [...past.map((m) => `${m}-01`), ...Array.from({ length: AHEAD }, (_, i) => addMonths(`${past.at(-1)}-01`, i + 1))];
  const labels = months.map((m) => monthYear(m));
  const series = goals.map((g) => {
    // A goal started on this device has less history than the window: its
    // line begins where Prism first heard of it, not at an invented zero.
    const known = g.history.slice(-past.length);
    const values: (number | null)[] = [...Array<null>(past.length - known.length).fill(null), ...known.map((v) => v / g.target)];
    for (let k = 1; k <= AHEAD; k++) values.push(Math.min(1, (g.saved + g.monthlyContribution * k) / g.target));
    return { id: g.id, label: `${g.emoji} ${g.name}`, color: slotColor(g.colorSlot), values, dashFrom: 12 };
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Goals"
        subtitle={
          household
            ? `What your household is saving for together, and when you'll get there.${changed ? ` ${changed}` : ""}`
            : data.planEdited.goals
              ? `What you're saving for, saved ${data.account ? "to your account" : "on this device"}, and when you'll get there.`
              : "What you're saving for, and when you'll get there."
        }
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {restore}
            {goals.length < MAX_GOALS ? (
              editor("new")
            ) : (
              <span className="text-xs text-ink-3">{MAX_GOALS} goals is the most Prism tracks at once.</span>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <Card hero className="p-5 sm:p-6 lg:col-span-4">
          <div className="text-sm font-semibold text-[var(--on-hero-soft)]">Saved toward {goals.length} goals</div>
          <div className="mt-1 text-[48px] font-extrabold leading-none tracking-tight">{money0(saved)}</div>
          <p className="mt-2 text-sm text-[var(--on-hero-soft)]">
            {percent(saved / target)} of {money0(target)}, growing {money0(monthly)} a month.
          </p>
          <div className="mt-6 h-3 w-full overflow-hidden rounded-pill bg-[var(--on-hero-faint)]">
            <div className="h-full rounded-pill bg-[var(--on-hero)]" style={{ width: `${Math.min(100, (saved / target) * 100)}%` }} />
          </div>
          <ul className="mt-6 space-y-3">
            {goals.map((g) => {
              const p = projectGoal(g, today);
              return (
                <li key={g.id}>
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="truncate font-semibold">
                      <span aria-hidden>{g.emoji}</span> {g.name}
                    </span>
                    <span className="num shrink-0 text-xs font-semibold text-[var(--on-hero-soft)]">
                      {p.projectedDate ? monthYear(p.projectedDate) : "—"}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-pill bg-[var(--on-hero-faint)]">
                    <div className="h-full rounded-pill bg-[var(--on-hero)]" style={{ width: `${p.progress * 100}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card className="p-5 sm:p-6 lg:col-span-8">
          <CardHeader title="What if…" subtitle="Drag to see how a different monthly amount moves the finish line" />
          <div className="mt-4">
            <GoalWhatIf goals={goals} today={today} household={household} />
          </div>
        </Card>
      </div>

      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {goals.map((g) => {
          const p = projectGoal(g, today);
          const color = slotColor(g.colorSlot);
          return (
            <Card as="li" key={g.id} className="relative flex flex-col items-center p-5 text-center">
              <div className="absolute top-3 right-3">
                <GoalEditor mode="edit" goal={goalSettings(g)} others={settings} today={today} signedIn={data.account !== null} household={household} />
              </div>
              <ProgressRing ratio={p.progress} color={color} size={128} stroke={13} label={`${g.name}: ${percent(p.progress)} saved`}>
                <span aria-hidden className="text-3xl">
                  {g.emoji}
                </span>
                <span className="num mt-0.5 text-sm font-extrabold text-ink-1">{percent(p.progress)}</span>
              </ProgressRing>
              <div className="mt-3 text-[15px] font-bold text-ink-1">{g.name}</div>
              <div className="num mt-1 text-sm text-ink-2">
                <span className="font-bold text-ink-1">{money0(g.saved)}</span> of {money0(g.target)}
              </div>
              <div className="mt-3">
                {p.onTrack ? (
                  <StatusPill status="good">On track for {monthShort(g.targetDate)} {g.targetDate.slice(0, 4)}</StatusPill>
                ) : (
                  <StatusPill status="warn">{p.projectedDate ? `Lands ${monthYear(p.projectedDate)}` : "Needs a monthly amount"}</StatusPill>
                )}
              </div>
              <div className="mt-3 text-xs text-ink-3">
                {money0(g.monthlyContribution)}/mo · {p.onTrack ? "keep it up" : `${money0(p.neededMonthly)}/mo gets you there on time`}
              </div>
            </Card>
          );
        })}
      </ul>

      <ChartCard
        title="Progress toward each goal"
        subtitle="Share of each target — the last 12 months, then the next two years at today's pace (dashed)"
        legend={<Legend items={series.map((s) => ({ label: s.label, color: s.color, kind: "line" }))} />}
        table={{
          caption: "Goal progress by month, as a share of target",
          columns: ["Month", ...goals.map((g) => g.name)],
          rows: labels.map((l, i) => [i > 12 ? `${l} (projected)` : l, ...series.map((s) => (s.values[i] == null ? "—" : percent(s.values[i]!)))]),
        }}
      >
        <TimeSeriesChart
          labels={labels}
          axisLabels={months.map((m) => `${monthShort(m)} ’${m.slice(2, 4)}`)}
          series={series}
          todayIndex={12}
          format="percent"
          axisFormat="percent"
          include={0}
          height={280}
          maxAxisLabels={8}
          ariaLabel="Goal progress over time as a share of each target, with projections"
        />
      </ChartCard>
    </div>
  );
}
