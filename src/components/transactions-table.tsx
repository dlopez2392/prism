"use client";

// src/components/transactions-table.tsx
//
// Every transaction, searchable and filterable by category, newest first.
// The list arrives with the page; filtering is instant because it is local.
// With `canFix` (a signed-in account's own money), each row opens "Change
// category"; a row the person changed says so, in words. A link whose
// #fragment names a category or a merchant (a citation from a connected app's
// research, view.ts ledgerHash) opens the list already narrowed to it.

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { CircleCheck, Search, SearchX } from "lucide-react";
import clsx from "clsx";
import { CategoryFixDialog } from "@/components/category-fixer";
import { CategoryIcon } from "@/components/category-icon";
import { CATEGORIES } from "@/lib/finance/categories";
import { money, shortDate } from "@/lib/finance/format";
import { normalizeMerchant } from "@/lib/finance/recurring";
import type { CategoryId, Transaction } from "@/lib/finance/types";
import { readLedgerHash } from "@/lib/finance/view";

const PAGE = 25;
const FILTERS: (CategoryId | "all")[] = ["all", "housing", "food", "transport", "shopping", "fun", "health", "travel", "bills", "other", "income", "transfer"];

export function TransactionsTable({
  transactions,
  accountNames,
  canFix = false,
  fixHint = null,
}: {
  transactions: Transaction[];
  accountNames: Record<string, string>;
  /** The person may change categories: signed in, looking at their own money. */
  canFix?: boolean;
  /** Where they can't yet, the one line saying how they could. */
  fixHint?: string | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [fixing, setFixing] = useState<Transaction | null>(null);
  const [session, setSession] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryId | "all">("all");
  const [shown, setShown] = useState(PAGE);
  const q = useDeferredValue(query.trim().toLowerCase());
  const root = useRef<HTMLDivElement>(null);

  // Read after hydration (the server never sees a fragment), and again whenever the fragment changes.
  useEffect(() => {
    const narrow = () => {
      const asked = readLedgerHash(window.location.hash);
      if (!asked) return;
      setQuery("find" in asked ? asked.find : "");
      setCategory("category" in asked ? asked.category : "all");
      setShown(PAGE);
      root.current?.scrollIntoView({ block: "start" });
    };
    narrow();
    window.addEventListener("hashchange", narrow);
    return () => window.removeEventListener("hashchange", narrow);
  }, []);

  const rows = useMemo(() => {
    const out = transactions.filter(
      (t) =>
        (category === "all" || t.category === category) &&
        // The name as Prism groups it too (store numbers dropped, spaces collapsed): what a ledger link carries.
        (q === "" || t.merchant.toLowerCase().includes(q) || normalizeMerchant(t.merchant).includes(q) || money(t.amount).includes(q)),
    );
    return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [transactions, category, q]);

  const total = rows.reduce((s, t) => s + t.amount, 0);

  function fix(t: Transaction) {
    setFixing(t);
    setSession((n) => n + 1);
    setNotice(null);
    dialog.current?.showModal();
  }

  return (
    <div ref={root} className="scroll-mt-24">
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
            className="h-10 w-full rounded-ctl border border-line bg-surface-2 pr-3 pl-9 text-sm text-ink-1 placeholder:text-ink-3 focus:border-[var(--focus)]"
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
            className="h-10 w-full rounded-ctl border border-line bg-surface-2 px-3 text-sm font-semibold text-ink-1 focus:border-[var(--focus)]"
          >
            {FILTERS.map((c) => (
              <option key={c} value={c}>
                {c === "all" ? "All categories" : CATEGORIES[c].label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Always in the DOM so screen readers announce it; drawn only when it speaks. */}
      <p role="status" className={clsx("flex items-center gap-1 text-xs font-semibold text-good-ink", notice && "mt-3")}>
        {notice ? (
          <>
            <CircleCheck aria-hidden className="size-3.5 shrink-0" />
            {notice}
          </>
        ) : null}
      </p>
      {fixHint ? <p className="mt-3 text-xs text-ink-3">{fixHint}</p> : null}

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
          {rows.slice(0, shown).map((t) => {
            const content = (
              <>
                <CategoryIcon category={t.category} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-ink-1">{t.merchant}</div>
                  <div className="truncate text-xs text-ink-3">
                    {CATEGORIES[t.category].label}
                    {t.bankCategory ? " (changed by you)" : ""} · {accountNames[t.accountId] ?? "Account"}
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
              </>
            );
            return (
              <li key={t.id}>
                {canFix ? (
                  <button
                    type="button"
                    onClick={() => fix(t)}
                    aria-label={`Change category for ${t.merchant}, ${money(t.amount)} on ${shortDate(t.date)}. Now ${CATEGORIES[t.category].label}${t.bankCategory ? ", changed by you" : ""}.`}
                    className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-ctl px-2 py-2.5 text-left transition-colors duration-150 hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-[var(--focus)]"
                  >
                    {content}
                  </button>
                ) : (
                  <div className="flex items-center gap-3 py-2.5">{content}</div>
                )}
              </li>
            );
          })}
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
      {canFix ? <CategoryFixDialog dialogRef={dialog} transaction={fixing} session={session} onDone={setNotice} /> : null}
    </div>
  );
}
