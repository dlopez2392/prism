"use client";

// src/components/spending-donut.tsx
//
// The category donut and its legend list, sharing one highlight: hover a row
// and its slice lifts; hover a slice and its row lights. ≤ 6 slices plus
// "Other", per the part-to-whole rule — anything smaller folds. With `hrefs`,
// a slice and its row open what they stand for. The legend takes two columns
// only when its card is wide enough to give every name its full width.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Donut, type Slice } from "@/components/charts/radial";
import { money0 } from "@/lib/finance/format";
import { useT } from "@/components/locale";

export function SpendingDonut({
  slices,
  total,
  label,
  size = 200,
  hrefs,
}: {
  slices: Slice[];
  total: number;
  label: string;
  size?: number;
  /** Where each slice leads, by its id. */
  hrefs?: Record<string, string>;
}) {
  const [active, setActive] = useState<string | null>(null);
  const router = useRouter();
  const t = useT();
  return (
    <div className="@container flex w-full flex-col items-center gap-5">
      <Donut
        slices={slices}
        size={size}
        centerLabel={label}
        centerValue={money0(total)}
        ariaLabel={t("Spending by category: {list}", { list: slices.map((s) => `${s.label} ${money0(s.value)}`).join(", ") })}
        active={active}
        onActive={setActive}
        onSelect={hrefs ? (id) => hrefs[id] && router.push(hrefs[id]) : undefined}
      />
      <ul className="grid w-full min-w-0 grid-cols-1 gap-x-4 gap-y-0.5 @md:grid-cols-2">
        {slices.map((s) => {
          const row = (
            <>
              <span aria-hidden className="size-2.5 shrink-0 rounded-[3px]" style={{ background: s.color }} />
              <span className="min-w-0 flex-1 truncate font-medium text-ink-1">{s.label}</span>
              <span className="num text-xs text-ink-3">{total > 0 ? Math.round((s.value / total) * 100) : 0}%</span>
              <span className="num text-right font-semibold text-ink-1">{money0(s.value)}</span>
            </>
          );
          const look = clsx(
            "flex items-center gap-2 rounded-ctl px-2 py-1.5 text-[13px] transition-colors duration-150",
            active === s.id ? "bg-surface-3" : "",
            active && active !== s.id ? "opacity-60" : "",
          );
          const href = hrefs?.[s.id];
          return (
            <li key={s.id} onPointerEnter={() => setActive(s.id)} onPointerLeave={() => setActive(null)}>
              {href ? (
                <Link href={href} className={clsx(look, "hover:bg-surface-3")} onFocus={() => setActive(s.id)} onBlur={() => setActive(null)}>
                  {row}
                  <span className="sr-only">: {t("see these transactions")}</span>
                </Link>
              ) : (
                <div className={look}>{row}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
