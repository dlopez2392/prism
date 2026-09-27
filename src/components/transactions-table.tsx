"use client";

// src/components/transactions-table.tsx
//
// Every transaction, searchable and filterable by category, newest first.
// The list arrives with the page; filtering is instant because it is local.

import { useDeferredValue, useMemo, useState } from "react";
import { Search, SearchX } from "lucide-react";
import clsx from "clsx";
import { CategoryIcon } from "@/components/category-icon";
import { CATEGORIES } from "@/lib/finance/categories";
import { money, shortDate } from "@/lib/finance/format";
import type { CategoryId, Transaction } from "@/lib/finance/types";

const PAGE = 25;
const FILTERS: (CategoryId | "all")[] = ["all", "housing", "food", "transport", "shopping", "fun", "health", "travel", "bills", "other", "income", "transfer"];

export function TransactionsTable({ transactions, accountNames }: { transactions: Transaction[]; accountNames: Record<string, string> }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryId | "all">("all");
  const [shown, setShown] = useState(PAGE);
  const q = useDeferredValue(query.trim().toLowerCase());

  const rows = useMemo(() => {
    const out = transactions.filter(
      (t) => (category === "all" || t.category === category) && (q === "" || t.merchant.toLowerCase().includes(q) || money(t.amount).includes(q)),
    );
    return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [transactions, category, q]);

  const total = rows.reduce((s, t) => s + t.amount, 0);

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="relative flex-1">
          <span className="sr-only">Search transactions</span>
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShown(PAGE);
            }}
            placeholder="Search a merchant or amount"
            className="h-10 w-full rounded-ctl border border-line bg-surface-2 pr-3 pl-9 text-sm text-ink-1 placeholder:text-ink-3 focus:border-[var(--focus)] focus:outline-none"
          />
        </label>
        <label className="sm:w-52">
          <span className="sr-only">Category</span>
          <select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value as CategoryId | "all");
              setShown(PAGE);
            }}
            className="h-10 w-full rounded-ctl border border-line bg-surface-2 px-3 text-sm font-semibold text-ink-1 focus:border-[var(--focus)] focus:outline-none"
          >
            {FILTERS.map((c) => (
              <option key={c} value={c}>
                {c === "all" ? "All categories" : CATEGORIES[c].label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-ink-3">
        <span>
          {rows.length.toLocaleString("en-US")} {rows.length === 1 ? "transaction" : "transactions"}
        </span>
        <span className="num">Net {money(total)}</span>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <SearchX aria-hidden className="size-6 text-ink-3" />
          <div className="text-sm font-semibold text-ink-1">Nothing matches that</div>
          <p className="text-sm text-ink-3">Try a shorter search, or a different category.</p>
        </div>
      ) : (
        <ul className="mt-2 divide-y divide-[var(--line)]">
          {rows.slice(0, shown).map((t) => (
            <li key={t.id} className="flex items-center gap-3 py-2.5">
              <CategoryIcon category={t.category} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-ink-1">{t.merchant}</div>
                <div className="truncate text-xs text-ink-3">
                  {CATEGORIES[t.category].label} · {accountNames[t.accountId] ?? "Account"}
                  {t.pending ? " · Pending" : ""}
                </div>
              </div>
              <div className="text-right">
                <div className={clsx("num text-sm font-bold", t.amount > 0 ? "text-good-ink" : "text-ink-1")}>
                  {t.amount > 0 ? "+" : ""}
                  {money(t.amount)}
                </div>
                <div className="num text-xs text-ink-3">{shortDate(t.date)}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {shown < rows.length ? (
        <button
          type="button"
          onClick={() => setShown((s) => s + PAGE)}
          className="mt-3 h-10 w-full rounded-ctl border border-line text-sm font-semibold text-ink-1 transition-colors duration-150 hover:bg-surface-3"
        >
          Show {Math.min(PAGE, rows.length - shown)} more
        </button>
      ) : null}
    </div>
  );
}
