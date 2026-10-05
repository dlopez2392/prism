"use client";

// src/components/goal-what-if.tsx
//
// "What if I put in a bit more?" — drag the monthly amount and watch the
// finish date move. Pure arithmetic from projectGoal; nothing is saved until
// the person chooses "Plan on this amount", which writes it to the goal.

import { useActionState, useState } from "react";
import { CircleCheck } from "lucide-react";
import clsx from "clsx";
import { buttonPrimary } from "@/components/dialog";
import { useT } from "@/components/locale";
import { slotColor } from "@/lib/finance/categories";
import { capitalized, money0, monthYear } from "@/lib/finance/format";
import { monthsUntil, projectGoal } from "@/lib/finance/networth";
import { IDLE } from "@/lib/finance/plan";
import type { Goal } from "@/lib/finance/types";
import { setGoalMonthly } from "@/lib/server/plan-actions";

export function GoalWhatIf({ goals, today, household = false }: { goals: Goal[]; today: string; household?: boolean }) {
  const t = useT();
  const { locale } = t;
  const [id, setId] = useState(goals[0]?.id);
  const goal = goals.find((g) => g.id === id) ?? goals[0];
  const [monthly, setMonthly] = useState<Record<string, number>>({});
  const [saved, save, saving] = useActionState(setGoalMonthly, IDLE);
  if (!goal) return null;

  const current = projectGoal(goal, today);
  const amount = monthly[goal.id] ?? goal.monthlyContribution;
  const tried = projectGoal(goal, today, amount);
  const max = Math.max(goal.monthlyContribution * 3, current.neededMonthly * 1.5, 10_000);
  const step = max > 200_000 ? 5_000 : 1_000;
  const shift = current.monthsToGo !== null && tried.monthsToGo !== null ? current.monthsToGo - tried.monthsToGo : null;
  const color = slotColor(goal.colorSlot);

  return (
    <div>
      <div role="tablist" aria-label={t("Goal")} className="flex flex-wrap gap-2">
        {goals.map((g) => (
          <button
            key={g.id}
            role="tab"
            type="button"
            aria-selected={g.id === goal.id}
            onClick={() => setId(g.id)}
            className={clsx(
              "inline-flex h-9 items-center gap-1.5 rounded-pill border px-3 text-sm font-semibold transition-colors duration-150",
              g.id === goal.id ? "border-transparent bg-button text-ink-on-accent" : "border-line text-ink-2 hover:bg-surface-3",
            )}
          >
            <span aria-hidden>{g.emoji}</span>
            {g.name}
          </button>
        ))}
      </div>

      <div className="mt-5 grid gap-5 sm:grid-cols-[1fr_auto] sm:items-end">
        <label className="block">
          <span className="flex items-baseline justify-between text-sm">
            <span className="font-semibold text-ink-1">{t("Monthly amount")}</span>
            <span className="num text-2xl font-extrabold text-ink-1">{money0(amount)}</span>
          </span>
          <input
            type="range"
            min={0}
            max={max}
            step={step}
            value={amount}
            onChange={(e) => setMonthly((m) => ({ ...m, [goal.id]: Number(e.target.value) }))}
            className="mt-3 w-full"
            style={{ accentColor: color }}
            aria-valuetext={t("{amount} a month", { amount: money0(amount) })}
          />
          <span className="mt-1 flex justify-between text-xs text-ink-3">
            <span>$0</span>
            <span>{t("Now: {amount}", { amount: money0(goal.monthlyContribution) })}</span>
            <span>{money0(max)}</span>
          </span>
        </label>
        <button
          type="button"
          onClick={() => setMonthly((m) => ({ ...m, [goal.id]: goal.monthlyContribution }))}
          className="h-9 rounded-ctl border border-line px-3 text-sm font-semibold text-ink-2 hover:bg-surface-3"
        >
          {t("Reset")}
        </button>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3" aria-live="polite">
        <Figure label={t("You'd finish")} value={tried.projectedDate ? capitalized(monthYear(tried.projectedDate, locale)) : t("Never at $0")} />
        <Figure
          label={t("Compared with now")}
          value={
            shift === null
              ? "—"
              : shift === 0
                ? t("Same month")
                : shift === 1
                  ? t("1 month sooner")
                  : shift > 0
                    ? t("{n} months sooner", { n: shift })
                    : shift === -1
                      ? t("1 month later")
                      : t("{n} months later", { n: -shift })
          }
        />
        <Figure
          label={t("To hit {month}", { month: monthYear(goal.targetDate, locale) })}
          value={t("{amount}/mo", { amount: money0(tried.neededMonthly) })}
          note={
            monthsUntil(today, goal.targetDate) <= 0 ? t("Target date has passed") : tried.onTrack ? t("You're on track") : t("Needed to arrive on time")
          }
        />
      </div>

      <form action={save} className="mt-4 flex min-h-10 flex-wrap items-center justify-end gap-3">
        <input type="hidden" name="id" value={goal.id} />
        <input type="hidden" name="monthly" value={amount} />
        {household ? <input type="hidden" name="scope" value="household" /> : null}
        <p role="status" className="flex items-center gap-1 text-xs font-semibold text-good-ink">
          {saved.status === "saved" && amount === goal.monthlyContribution ? (
            <>
              <CircleCheck aria-hidden className="size-3.5" />
              {saved.message}
            </>
          ) : saved.status === "error" ? (
            <span className="text-crit-ink">{saved.message}</span>
          ) : null}
        </p>
        {amount !== goal.monthlyContribution ? (
          <button type="submit" disabled={saving} className={buttonPrimary}>
            {saving ? t("Saving…") : t("Plan on {amount} a month", { amount: money0(amount) })}
          </button>
        ) : null}
      </form>
    </div>
  );
}

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-ctl bg-surface-2 p-3.5">
      <div className="text-xs font-semibold text-ink-3">{label}</div>
      <div className="mt-1 text-lg font-extrabold tracking-tight text-ink-1">{value}</div>
      {note ? <div className="mt-0.5 text-xs text-ink-2">{note}</div> : null}
    </div>
  );
}
