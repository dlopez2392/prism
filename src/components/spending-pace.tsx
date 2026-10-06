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
import { capitalized, money0, monthLong } from "@/lib/finance/format";
import type { ISODate, Transaction } from "@/lib/finance/types";
import { EN, type T } from "@/lib/i18n/t";

export function SpendingPace({ transactions, from, to, className, t = EN }: { transactions: Transaction[]; from: ISODate; to: ISODate; className?: string; t?: T }) {
  const before = addMonths(from, -1);
  const thisCurve = cumulativeSpend(transactions, from, to);
  const lastCurve = cumulativeSpend(transactions, before);
  const days = Math.max(daysInMonth(from), lastCurve.length);
  const dayLabels = Array.from({ length: days }, (_, i) => t("Day {n}", { n: i + 1 }));
  const spent = thisCurve.at(-1) ?? 0;
  const lastWhole = lastCurve.at(-1) ?? 0;
  // By the same day of last month, or its last day when it's shorter.
  const lastBySameDay = lastCurve[Math.min(thisCurve.length, lastCurve.length) - 1] ?? 0;
  const whole = to === endOfMonth(from);
  // Lower case in a Spanish sentence ("todo septiembre"); a capital where it stands alone, as a legend or a column.
  const name = monthLong(from, t.locale);
  const prior = monthLong(before, t.locale);
  const [Name, Prior] = [capitalized(name), capitalized(prior)];

  return (
    <ChartCard
      className={className}
      title={t("Spending pace")}
      subtitle={whole ? t("All of {month} against all of {prior}", { month: name, prior }) : t("{month} so far against all of {prior}", { month: name, prior })}
      legend={
        <Legend
          items={[
            { label: Name, color: "var(--accent)", kind: "line", value: money0(spent) },
            { label: Prior, color: "var(--c-other)", kind: "line", value: money0(lastWhole) },
          ]}
        />
      }
      table={{
        caption: t("Cumulative spending by day of month"),
        columns: [t("Day"), Name, Prior],
        rows: Array.from({ length: days }, (_, i) => [
          dayLabels[i]!,
          thisCurve[i] !== undefined ? money0(thisCurve[i]!) : "—",
          lastCurve[i] !== undefined ? money0(lastCurve[i]!) : "—",
        ]),
      }}
    >
      <TimeSeriesChart
        labels={dayLabels}
        axisLabels={dayLabels.map((_, i) => String(i + 1))}
        series={[
          { id: "last", label: Prior, color: "var(--c-other)", values: lastCurve, muted: true },
          { id: "this", label: Name, color: "var(--accent)", values: thisCurve, area: true },
        ]}
        include={0}
        height={250}
        ariaLabel={
          whole
            ? t("Cumulative spending: {spent} in all of {month}, against {before} in all of {prior}.", { spent: money0(spent), month: name, before: money0(lastWhole), prior })
            : t("Cumulative spending: {spent} so far in {month}, against {before} by the same day last month.", { spent: money0(spent), month: name, before: money0(lastBySameDay) })
        }
      />
    </ChartCard>
  );
}
