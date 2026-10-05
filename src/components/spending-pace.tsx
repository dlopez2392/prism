// src/components/spending-pace.tsx
//
// The "spending pace" chart: one month's spending, added up day by day,
// against the whole of the month before it. Overview shows this month so far;
// Spending's one-month view shows whichever month is being looked at.

import { ChartCard } from "@/components/chart-card";
import { Legend } from "@/components/charts/core";
import { TimeSeriesChart } from "@/components/charts/time-series";
import { cumulativeSpend } from "@/lib/finance/cashflow";
import { addMonths, daysInMonth, endOfMonth } from "@/lib/finance/dates";
import { money0, monthLong } from "@/lib/finance/format";
import type { ISODate, Transaction } from "@/lib/finance/types";

export function SpendingPace({ transactions, from, to, className }: { transactions: Transaction[]; from: ISODate; to: ISODate; className?: string }) {
  const before = addMonths(from, -1);
  const thisCurve = cumulativeSpend(transactions, from, to);
  const lastCurve = cumulativeSpend(transactions, before);
  const days = Math.max(daysInMonth(from), lastCurve.length);
  const dayLabels = Array.from({ length: days }, (_, i) => `Day ${i + 1}`);
  const spent = thisCurve.at(-1) ?? 0;
  const lastWhole = lastCurve.at(-1) ?? 0;
  // By the same day of last month, or its last day when it's shorter.
  const lastBySameDay = lastCurve[Math.min(thisCurve.length, lastCurve.length) - 1] ?? 0;
  const whole = to === endOfMonth(from);
  const name = monthLong(from);
  const prior = monthLong(before);

  return (
    <ChartCard
      className={className}
      title="Spending pace"
      subtitle={whole ? `All of ${name} against all of ${prior}` : `${name} so far against all of ${prior}`}
      legend={
        <Legend
          items={[
            { label: name, color: "var(--accent)", kind: "line", value: money0(spent) },
            { label: prior, color: "var(--c-other)", kind: "line", value: money0(lastWhole) },
          ]}
        />
      }
      table={{
        caption: "Cumulative spending by day of month",
        columns: ["Day", name, prior],
        rows: Array.from({ length: days }, (_, i) => [
          `Day ${i + 1}`,
          thisCurve[i] !== undefined ? money0(thisCurve[i]!) : "—",
          lastCurve[i] !== undefined ? money0(lastCurve[i]!) : "—",
        ]),
      }}
    >
      <TimeSeriesChart
        labels={dayLabels}
        axisLabels={dayLabels.map((_, i) => String(i + 1))}
        series={[
          { id: "last", label: prior, color: "var(--c-other)", values: lastCurve, muted: true },
          { id: "this", label: name, color: "var(--accent)", values: thisCurve, area: true },
        ]}
        include={0}
        height={250}
        ariaLabel={
          whole
            ? `Cumulative spending: ${money0(spent)} in all of ${name}, against ${money0(lastWhole)} in all of ${prior}.`
            : `Cumulative spending: ${money0(spent)} so far in ${name}, against ${money0(lastBySameDay)} by the same day last month.`
        }
      />
    </ChartCard>
  );
}
