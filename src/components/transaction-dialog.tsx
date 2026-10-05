"use client";

// src/components/transaction-dialog.tsx
//
// One transaction, opened from the ledger: whether it counts in the person's
// totals at all (a switch, saved the moment it's flipped), its category
// (category-fixer.tsx), or how it splits across categories, its tags, and who
// owes the person for it (finance/details.ts). A split line opens whole, by the id the bank gave
// it, whichever of its parts was tapped; its parts take their categories from
// the split, so it has no single category to change. A split can be kept for
// every purchase at the same shop; one there can still be kept whole.

import { startTransition, useActionState, useId, useState, useTransition, type FormEvent } from "react";
import { PackageOpen, Plus, ReceiptText, X } from "lucide-react";
import clsx from "clsx";
import { FixForm } from "@/components/category-fixer";
import { buttonGhost, buttonPrimary, Dialog, FormMessage } from "@/components/dialog";
import { CATEGORIES, SPEND_CATEGORIES, isSpendCategory } from "@/lib/finance/categories";
import { DETAIL_LIMITS, ruleKey } from "@/lib/finance/details";
import { itemParts } from "@/lib/finance/orders";
import { dayDate, money, shortDate } from "@/lib/finance/format";
import { dollarsInput, parseDollars } from "@/lib/finance/plan";
import type { Cents, SpendCategoryId, Transaction } from "@/lib/finance/types";
import { Switch } from "@/components/switch";
import { leaveOut, saveTransactionDetail, type DetailState } from "@/lib/server/details-actions";

/** A line as the bank sent it, with what the person added: its parts when it's split. */
export type Opened = { whole: Transaction; parts: Transaction[] };

/** The whole line behind a tapped row: its own, or its split's, gathered from every part. */
export function openedFrom(row: Transaction, all: Transaction[]): Opened {
  if (!row.split) return { whole: row, parts: [] };
  const of = row.split.of;
  const parts = all.filter((t) => t.split?.of === of).sort((a, b) => a.split!.part - b.split!.part);
  const first = parts[0] ?? row;
  const whole: Transaction = { ...first, id: of, amount: row.split.total, category: first.bankCategory ?? first.category };
  delete whole.split;
  delete whole.bankCategory;
  return { whole, parts };
}

const field = "h-10 w-full rounded-ctl border border-line-strong bg-surface-2 text-sm text-ink-1 placeholder:text-ink-3 focus:border-[var(--focus)] aria-[invalid=true]:border-crit";

export function TransactionDialog({
  dialogRef,
  opened,
  session,
  onDone,
  ruleShops = [],
}: {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  opened: Opened | null;
  /** A new number each time the dialog opens, so the forms start fresh. */
  session: number;
  onDone: (message: string) => void;
  /** The shops whose every purchase the person splits the same way, by ruleKey. */
  ruleShops?: string[];
}) {
  const [tab, setTab] = useState<"category" | "details">("category");
  const [seen, setSeen] = useState(session);
  // Each opening starts on Category, or on the split for a line that has one.
  if (seen !== session) {
    setSeen(session);
    setTab(opened?.parts.length ? "details" : "category");
  }
  const t = opened?.whole ?? null;
  const close = () => dialogRef.current?.close();
  const done = (message: string) => {
    onDone(message);
    close();
  };
  const split = Boolean(opened?.parts.length);

  return (
    <Dialog
      dialogRef={dialogRef}
      title={t ? t.merchant : "Transaction"}
      description={t ? `${t.amount > 0 ? "+" : ""}${money(t.amount)} · ${dayDate(t.date)}` : undefined}
      icon={ReceiptText}
    >
      {t && opened ? (
        <>
          <LeaveOut key={`${session}-${t.id}-out`} t={t} onDone={done} />
          <div role="tablist" aria-label="What to change" className="mb-4 inline-flex rounded-ctl border border-line bg-surface-2 p-1">
            {(
              [
                ["category", "Category"],
                ["details", "Split, tags, owed"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={clsx(
                  "rounded-[calc(var(--radius-ctl)-4px)] px-3 py-1.5 text-xs font-bold transition-colors duration-150",
                  tab === id ? "bg-button text-ink-on-accent" : "text-ink-2 hover:bg-surface-3 hover:text-ink-1",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === "category" ? (
            split ? (
              <div className="rounded-ctl bg-surface-2 p-3 text-sm text-ink-2">
                This one is split, so each part has its own category. Change them under <span className="font-semibold text-ink-1">Split, tags, owed</span>, or turn the split off there.
              </div>
            ) : (
              <FixForm key={`${session}-${t.id}-category`} t={t} onDone={done} onCancel={close} />
            )
          ) : (
            <DetailForm key={`${session}-${t.id}-details`} opened={opened} onDone={done} onCancel={close} shopHasRule={ruleShops.includes(ruleKey(t.merchant) ?? "")} />
          )}
        </>
      ) : null}
    </Dialog>
  );
}

/** Whether the line counts in the person's totals: flipped and saved at once, and flipped back to undo. */
function LeaveOut({ t, onDone }: { t: Transaction; onDone: (message: string) => void }) {
  // Left out with its whole account: only counting the account again brings it back.
  const byAccount = t.excluded === "account";
  const [out, setOut] = useState(t.excluded !== undefined);
  const [error, setError] = useState<string | null>(null);
  const [saving, start] = useTransition();
  const flip = (next: boolean) => {
    setOut(next);
    setError(null);
    start(async () => {
      const result = await leaveOut(t.id, next);
      if (result.status === "saved") onDone(result.message);
      else {
        setOut(!next);
        setError(result.status === "error" ? result.message : null);
      }
    });
  };
  return (
    <div className="mb-4 rounded-ctl border border-line bg-surface-2 p-3">
      <Switch
        checked={out}
        onChange={flip}
        disabled={saving || t.pending || byAccount}
        label="Leave out of my totals"
        description={
          byAccount
            ? "Its whole account is left out of your totals. To count it again, use Choose what counts on Net worth."
            : t.pending
              ? "Once it's no longer pending, you can leave it out."
              : "Not counted in spending, income or budgets: for a one-off like a car, or a work trip you're paid back for. It stays in your transactions."
        }
      />
      {error ? (
        <p role="alert" className="mt-2 text-sm font-medium text-crit-ink">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** `label`: the item a part stands for, when it was split by an Amazon charge's items. */
type Part = { category: SpendCategoryId; amount: string; label?: string };

function DetailForm({ opened, onDone, onCancel, shopHasRule }: { opened: Opened; onDone: (message: string) => void; onCancel: () => void; shopHasRule: boolean }) {
  const id = useId();
  const { whole: t, parts: given } = opened;
  const total: Cents = Math.abs(t.amount);
  const canSplit = t.amount < 0 && t.category !== "income";
  const first: SpendCategoryId = isSpendCategory(t.category) ? t.category : "other";
  const [splitOn, setSplitOn] = useState(given.length > 0);
  // Every purchase at this shop split this way: ticked while the shop has a split of its own.
  const [ruleOn, setRuleOn] = useState(shopHasRule);
  const shopNamed = ruleKey(t.merchant) !== null;
  // The first part is always "the rest", so the parts add up by construction.
  const [rest, setRest] = useState<Part[]>(
    given.length ? given.slice(1).map((p) => ({ category: p.category as SpendCategoryId, amount: dollarsInput(-p.amount) })) : [{ category: first === "shopping" ? "food" : "shopping", amount: "" }],
  );
  const [firstCategory, setFirstCategory] = useState<SpendCategoryId>(given[0] && isSpendCategory(given[0].category) ? given[0].category : first);
  const [firstLabel, setFirstLabel] = useState<string | null>(null);
  // An Amazon charge can be split by what it paid for: one part per item (the smallest added up past the limit), each in this line's category to start.
  const items = canSplit && t.order && t.order.items.length >= 2 ? t.order.items : null;
  const byItems = () => {
    const parts = itemParts(items!, DETAIL_LIMITS.parts);
    setSplitOn(true);
    // A split by one order's items is this charge's own, never every purchase at the shop.
    setRuleOn(false);
    setFirstCategory(first);
    setFirstLabel(parts[0]!.name);
    setRest(parts.slice(1).map((p) => ({ category: first, amount: dollarsInput(p.amount), label: p.name })));
  };
  const [tags, setTags] = useState((t.tags ?? []).join(", "));
  const [owedOn, setOwedOn] = useState(Boolean(t.owed));
  const [who, setWho] = useState(t.owed?.who ?? "");
  const [owedAmount, setOwedAmount] = useState(t.owed ? dollarsInput(t.owed.amount) : "");
  const [state, action, pending] = useActionState(async (_prev: DetailState, detail: unknown) => {
    const next = await saveTransactionDetail(t.id, detail);
    if (next.status === "saved") onDone(next.message);
    return next;
  }, { status: "idle" } as DetailState);

  const amounts = rest.map((p) => (p.amount.trim() ? parseDollars(p.amount) : null));
  const placed = amounts.reduce<number>((s, a) => s + (a ?? 0), 0);
  const left = total - placed;
  const partError = amounts.some((a) => a === null || a === 0) ? "Give every part an amount." : left <= 0 ? `The other parts add up to ${money(placed)}, more than the ${money(total)} this cost.` : null;
  const owedCents = owedAmount.trim() ? parseDollars(owedAmount) : null;
  const owedError = !owedOn ? null : !who.trim() ? "Say who owes you." : owedCents === null || owedCents === 0 ? "Say how much they owe you." : owedCents > total ? `At most ${money(total)}, what this cost.` : null;
  const blocked = (splitOn && partError !== null) || owedError !== null;

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (blocked) return;
    const detail = {
      split: splitOn ? [{ category: firstCategory, amount: left }, ...rest.map((p, i) => ({ category: p.category, amount: amounts[i]! }))] : null,
      ...(splitOn && shopNamed ? { rule: ruleOn } : {}),
      tags: tags.split(",").map((x) => x.trim()).filter(Boolean),
      owed: owedOn ? { who: who.trim(), amount: owedCents!, paid: null } : null,
    };
    startTransition(() => action(detail));
  }

  const select = (value: SpendCategoryId, onChange: (c: SpendCategoryId) => void, label: string) => (
    <select value={value} onChange={(e) => onChange(e.target.value as SpendCategoryId)} aria-label={label} className={clsx(field, "px-2 font-semibold")}>
      {SPEND_CATEGORIES.map((c) => (
        <option key={c} value={c}>
          {CATEGORIES[c].label}
        </option>
      ))}
    </select>
  );

  return (
    <form onSubmit={submit} noValidate>
      {canSplit ? (
        <fieldset>
          <legend className="sr-only">Split</legend>
          <label className="flex cursor-pointer items-start gap-2.5 text-sm text-ink-1">
            <input type="checkbox" checked={splitOn} onChange={(e) => setSplitOn(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-[var(--button)]" />
            <span>
              <span className="font-semibold">Split across categories</span>
              <span className="block text-[13px] text-ink-3">Every total, budget and chart counts each part where it belongs.</span>
            </span>
          </label>
          {items ? (
            <button type="button" onClick={byItems} className="mt-2 ml-6.5 inline-flex items-center gap-1 text-[13px] font-semibold text-accent-ink hover:underline">
              <PackageOpen aria-hidden className="size-3.5" />
              Split by its {items.length} items, then choose each one&apos;s category
            </button>
          ) : null}
          {splitOn ? (
            <div className="mt-3 space-y-2">
              {firstLabel ? <p className="truncate text-xs text-ink-3">{firstLabel}</p> : null}
              <div className="grid grid-cols-[1fr_8rem_2rem] items-center gap-2">
                {select(firstCategory, setFirstCategory, firstLabel ? `Part 1 category, ${firstLabel}` : "Part 1 category")}
                <div className="num px-1 text-right text-sm font-bold text-ink-1" aria-live="polite">
                  {left > 0 ? money(left) : "—"}
                </div>
                <span />
              </div>
              {rest.map((p, i) => (
                <div key={i}>
                  {p.label ? <p className="mb-1 truncate text-xs text-ink-3">{p.label}</p> : null}
                  <div className="grid grid-cols-[1fr_8rem_2rem] items-center gap-2">
                    {select(p.category, (c) => setRest((r) => r.map((x, j) => (j === i ? { ...x, category: c } : x))), p.label ? `Part ${i + 2} category, ${p.label}` : `Part ${i + 2} category`)}
                    <div className="relative">
                      <span aria-hidden className="pointer-events-none absolute inset-y-0 left-2.5 grid place-items-center text-sm text-ink-3">
                        $
                      </span>
                      <input
                        value={p.amount}
                        onChange={(e) => setRest((r) => r.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
                        inputMode="decimal"
                        autoComplete="off"
                        aria-label={`Part ${i + 2} amount`}
                        aria-invalid={amounts[i] === null && p.amount.trim() !== "" ? true : undefined}
                        className={clsx(field, "num pr-2 pl-6")}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setRest((r) => r.filter((_, j) => j !== i))}
                      disabled={rest.length === 1}
                      aria-label={`Remove part ${i + 2}`}
                      className="grid size-8 place-items-center rounded-ctl text-ink-3 hover:bg-surface-3 disabled:opacity-40"
                    >
                      <X aria-hidden className="size-4" />
                    </button>
                  </div>
                </div>
              ))}
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-3">
                <span>The first part is whatever the others leave of {money(total)}.</span>
                {rest.length + 1 < DETAIL_LIMITS.parts ? (
                  <button type="button" onClick={() => setRest((r) => [...r, { category: "other", amount: "" }])} className="inline-flex items-center gap-1 font-semibold text-accent-ink hover:underline">
                    <Plus aria-hidden className="size-3.5" />
                    Add a part
                  </button>
                ) : null}
              </div>
              {partError ? <p className="text-xs font-medium text-crit-ink">{partError}</p> : null}
              {shopNamed ? (
                <label className="flex cursor-pointer items-start gap-2.5 pt-1 text-sm text-ink-1">
                  <input type="checkbox" checked={ruleOn} onChange={(e) => setRuleOn(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-[var(--button)]" />
                  <span>
                    <span className="font-semibold [overflow-wrap:anywhere]">Split every {t.merchant} purchase this way</span>
                    <span className="block text-[13px] text-ink-3">By the same shares, the ones before this and the ones to come. One you split yourself keeps its own.</span>
                  </span>
                </label>
              ) : null}
            </div>
          ) : shopHasRule ? (
            <p className="mt-2 text-[13px] text-ink-3">This one stays whole. Other {t.merchant} purchases still follow your split; remove it under Split rules on Spending.</p>
          ) : null}
        </fieldset>
      ) : null}

      <div className={canSplit ? "mt-5" : ""}>
        <label htmlFor={`${id}-tags`} className="mb-1 block text-[13px] font-semibold text-ink-2">
          Tags
        </label>
        <input id={`${id}-tags`} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Vacation 2026, Work trip" autoComplete="off" className={clsx(field, "px-3")} />
        <p className="mt-1 text-xs text-ink-3">Separate them with commas. Up to {DETAIL_LIMITS.tags}; search the list for one to see them all.</p>
      </div>

      {t.amount < 0 ? (
        <fieldset className="mt-5">
          <legend className="sr-only">Someone owes you</legend>
          <label className="flex cursor-pointer items-start gap-2.5 text-sm text-ink-1">
            <input type="checkbox" checked={owedOn} onChange={(e) => setOwedOn(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-[var(--button)]" />
            <span className="font-semibold">Someone owes me for this</span>
          </label>
          {owedOn ? (
            <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_9rem]">
              <div>
                <label htmlFor={`${id}-who`} className="mb-1 block text-[13px] font-semibold text-ink-2">
                  Who
                </label>
                <input id={`${id}-who`} value={who} onChange={(e) => setWho(e.target.value)} maxLength={DETAIL_LIMITS.whoLength} autoComplete="off" placeholder="Sam" className={clsx(field, "px-3")} />
              </div>
              <div>
                <label htmlFor={`${id}-owed`} className="mb-1 block text-[13px] font-semibold text-ink-2">
                  How much
                </label>
                <div className="relative">
                  <span aria-hidden className="pointer-events-none absolute inset-y-0 left-2.5 grid place-items-center text-sm text-ink-3">
                    $
                  </span>
                  <input id={`${id}-owed`} value={owedAmount} onChange={(e) => setOwedAmount(e.target.value)} inputMode="decimal" autoComplete="off" placeholder={dollarsInput(Math.round(total / 2))} className={clsx(field, "num pr-2 pl-6")} />
                </div>
              </div>
              {t.owed?.paid ? <p className="text-xs text-ink-3 sm:col-span-2">Marked paid back on {shortDate(t.owed.paid)}.</p> : null}
              {owedError ? <p className="text-xs font-medium text-crit-ink sm:col-span-2">{owedError}</p> : null}
            </div>
          ) : null}
        </fieldset>
      ) : null}

      <FormMessage state={state} />

      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onCancel} className={buttonGhost}>
          Cancel
        </button>
        <button type="submit" disabled={pending || blocked} className={clsx(buttonPrimary, "min-w-24")}>
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
