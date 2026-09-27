"use client";

// apps/finance/src/components/goal-what-if.tsx
//
// "What if I put in a bit more?" — drag the monthly amount and watch the
// finish date move. Pure arithmetic from projectGoal; nothing is saved.

import { useState } from "react";
import clsx from "clsx";
import { slotColor } from "@/lib/finance/categories";
import { money0, monthYear } from "@/lib/finance/format";
import { monthsUntil, projectGoal } from "@/lib/finance/networth";
import type { Goal } from "@/lib/finance/types";

export function GoalWhatIf({ goals, today }: { goals: Goal[]; today: string }) {
  const [id, setId] = useState(goals[0]?.id);
  const goal = goals.find((g) => g.id === id) ?? goals[0];
  const [monthly, setMonthly] = useState<Record<string, number>>({});
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
      <div role="tablist" aria-label="Goal" className="flex flex-wrap gap-2">
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
            <span className="font-semibold text-ink-1">Monthly amount</span>
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
            aria-valuetext={`${money0(amount)} a month`}
          />
          <span className="mt-1 flex justify-between text-xs text-ink-3">
            <span>$0</span>
            <span>Now: {money0(goal.monthlyContribution)}</span>
            <span>{money0(max)}</span>
          </span>
        </label>
        <button
          type="button"
          onClick={() => setMonthly((m) => ({ ...m, [goal.id]: goal.monthlyContribution }))}
          className="h-9 rounded-ctl border border-line px-3 text-sm font-semibold text-ink-2 hover:bg-surface-3"
        >
          Reset
        </button>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3" aria-live="polite">
        <Figure label="You'd finish" value={tried.projectedDate ? monthYear(tried.projectedDate) : "Never at $0"} />
        <Figure
          label="Compared with now"
          value={shift === null ? "—" : shift === 0 ? "Same month" : shift > 0 ? `${shift} ${shift === 1 ? "month" : "months"} sooner` : `${-shift} ${shift === -1 ? "month" : "months"} later`}
        />
        <Figure
          label={`To hit ${monthYear(goal.targetDate)}`}
          value={`${money0(tried.neededMonthly)}/mo`}
          note={monthsUntil(today, goal.targetDate) <= 0 ? "Target date has passed" : tried.onTrack ? "You're on track" : "Needed to arrive on time"}
        />
      </div>
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
