"use client";

// src/components/transactions-table.tsx
//
// Every transaction, searchable and filterable by category, newest first.
// The list arrives with the page; filtering is instant because it is local.
// With `canFix` (a signed-in account's own money), each row opens the
// transaction: its category, or a split, tags and who owes for it
// (transaction-dialog.tsx); a row the person changed says so, in words. A link whose
// #fragment names a category or a merchant (a citation from a connected app's
// research, view.ts ledgerHash) opens the list already narrowed to it.

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { CircleCheck, Search, SearchX } from "lucide-react";
import clsx from "clsx";
import { CategoryIcon } from "@/components/category-icon";
import { openedFrom, TransactionDialog, type Opened } from "@/components/transaction-dialog";
import { categoryLabel } from "@/lib/finance/categories";
import { useT } from "@/components/locale";
import { money, shortDate } from "@/lib/finance/format";
import { p2pLabel } from "@/lib/finance/p2p";
import { orderLabel } from "@/lib/finance/orders";
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
  ruleShops = [],
}: {
  transactions: Transaction[];
  accountNames: Record<string, string>;
  /** The person may change categories: signed in, looking at their own money. */
  canFix?: boolean;
  /** Where they can't yet, the one line saying how they could. */
  fixHint?: string | null;
  /** The shops whose every purchase the person splits the same way. */
  ruleShops?: string[];
}) {
  const t = useT();
  const { locale } = t;
  const dialog = useRef<HTMLDialogElement>(null);
  const [fixing, setFixing] = useState<Opened | null>(null);
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
      (x) =>
        (category === "all" || x.category === category) &&
        // The name as Prism groups it too (store numbers dropped, spaces collapsed): what a ledger link carries.
        // And who a Venmo, PayPal or Cash App payment was for, and their note: "alex", "pizza".
        (q === "" ||
          x.merchant.toLowerCase().includes(q) ||
          normalizeMerchant(x.merchant).includes(q) ||
          money(x.amount).includes(q) ||
          (x.p2p !== undefined && `${x.p2p.name} ${x.p2p.note ?? ""}`.toLowerCase().includes(q)) ||
          // What an Amazon charge paid for: "dog food".
          (x.order?.items ?? []).some((i) => i.name.toLowerCase().includes(q)) ||
          // The person's own tags, and who owes them: "vacation", "sam".
          (x.tags ?? []).some((tag) => tag.toLowerCase().includes(q)) ||
          (x.owed !== undefined && x.owed.who.toLowerCase().includes(q))),
    );
    return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [transactions, category, q]);

  const total = rows.reduce((s, x) => s + x.amount, 0);

  function fix(txn: Transaction) {
    setFixing(openedFrom(txn, transactions));
    setSession((n) => n + 1);
    setNotice(null);
    dialog.current?.showModal();
  }

  return (
    <div ref={root} className="scroll-mt-24">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="relative flex-1">
          <span className="sr-only">{t("Search transactions")}</span>
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShown(PAGE);
            }}
            placeholder={t("Search a merchant, person, tag or amount")}
            className="h-10 w-full rounded-ctl border border-line bg-surface-2 pr-3 pl-9 text-sm text-ink-1 placeholder:text-ink-3 focus:border-[var(--focus)]"
          />
        </label>
        <label className="sm:w-52">
          <span className="sr-only">{t("Category")}</span>
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
                {c === "all" ? t("All categories") : categoryLabel(c, t)}
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
        <span>{rows.length === 1 ? t("1 transaction") : t("{n} transactions", { n: rows.length.toLocaleString("en-US") })}</span>
        <span className="num">{t("Net {amount}", { amount: money(total) })}</span>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <SearchX aria-hidden className="size-6 text-ink-3" />
          <div className="text-sm font-semibold text-ink-1">{t("Nothing matches that")}</div>
          <p className="text-sm text-ink-3">{t("Try a shorter search, or a different category.")}</p>
        </div>
      ) : (
        <ul className="mt-2 divide-y divide-[var(--line)]">
          {rows.slice(0, shown).map((x) => {
            const where = x.split
              ? t("part {part} of {parts}, split by you", { part: x.split.part, parts: x.split.parts })
              : x.bankCategory
                ? t("(changed by you)")
                : null;
            const content = (
              <>
                <CategoryIcon category={x.category} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-ink-1">{x.merchant}</div>
                  {x.p2p ? (
                    <div className="truncate text-xs text-ink-2">
                      {p2pLabel(x.p2p, t)}
                      {x.p2p.note ? ` · ${x.p2p.note}` : ""}
                    </div>
                  ) : null}
                  {x.order ? <div className="truncate text-xs text-ink-2">{orderLabel(x.order, t)}</div> : null}
                  <div className="truncate text-xs text-ink-3">
                    {categoryLabel(x.category, t)}
                    {where ? (x.split ? ` · ${where}` : ` ${where}`) : ""} · {accountNames[x.accountId] ?? t("Account")}
                    {x.pending ? ` · ${t("Pending")}` : ""}
                  </div>
                  {x.owed || x.tags?.length || x.excluded ? (
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      {x.excluded ? <span className="rounded-pill border border-line-strong px-2 py-0.5 text-[11px] font-semibold text-ink-2">{t("Left out of totals")}</span> : null}
                      {x.owed ? (
                        <span className="rounded-pill bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-ink-2">
                          {x.owed.paid ? t("{who} paid you back", { who: x.owed.who }) : t("{who} owes you {amount}", { who: x.owed.who, amount: money(x.owed.amount) })}
                        </span>
                      ) : null}
                      {(x.tags ?? []).map((tag) => (
                        <span key={tag} className="rounded-pill bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-ink-1">
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="text-right">
                  <div className={clsx("num text-sm font-bold", x.amount > 0 ? "text-good-ink" : "text-ink-1")}>
                    {x.amount > 0 ? "+" : ""}
                    {money(x.amount)}
                  </div>
                  <div className="num text-xs text-ink-3">{shortDate(x.date, locale)}</div>
                </div>
              </>
            );
            // Its name for a screen reader: what it is, then what opening it lets you do.
            const name = [
              x.merchant,
              x.p2p ? p2pLabel(x.p2p, t) : null,
              x.order ? orderLabel(x.order, t) : null,
              t("{amount} on {date}: {category}", { amount: money(x.amount), date: shortDate(x.date, locale), category: categoryLabel(x.category, t) }),
            ]
              .filter(Boolean)
              .join(", ");
            const state = x.split ? t("part {part} of {parts}", { part: x.split.part, parts: x.split.parts }) : x.bankCategory ? t("changed by you") : null;
            return (
              <li key={x.id}>
                {canFix ? (
                  <button
                    type="button"
                    onClick={() => fix(x)}
                    aria-label={t("Open {name}. Change its category, split it, tag it, note who owes you, or leave it out of your totals.", {
                      name: [name, state, x.excluded ? t("left out of your totals") : null].filter(Boolean).join(", "),
                    })}
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
          {t("Show {n} more", { n: Math.min(PAGE, rows.length - shown) })}
        </button>
      ) : null}
      {canFix ? <TransactionDialog dialogRef={dialog} opened={fixing} session={session} onDone={setNotice} ruleShops={ruleShops} /> : null}
    </div>
  );
}
