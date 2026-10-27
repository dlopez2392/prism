// src/lib/finance/check-in.ts
//
// The money check-in: one page to look at once a month. Last month in
// numbers (alert-snapshot.ts's monthlyNumbers, the same the recap email
// sends); what's worth a look now, gathered from every part of Prism, each
// with the page that settles it; what changed (the categories that moved
// most, the prices that rose); and the month ahead.
//
// Nothing is stored: an item leaves the list when what it's about is
// settled (the refund comes back, the bill is paid, the bank reconnects),
// never because it was ticked. Every item is a description and a link,
// never advice, and Prism never acts on any of it.
//
// Pure: reads the analysis.

import { monthlyNumbers, type MonthlyNumbers } from "./alert-snapshot";
import { alertsFor } from "./alerts";
import { categoryBreakdown } from "./cashflow";
import { cardsFor } from "./cards";
import { categoryLabel } from "./categories";
import { addDays, addMonths, daysBetween, startOfMonth } from "./dates";
import { estimatedTax } from "./estimated-tax";
import { feesFor } from "./fees";
import { money, money0, shortDate } from "./format";
import { inflationFor, type PriceChange } from "./inflation";
import type { Analysis } from "./model";
import type { Cents, ISODate, SpendCategoryId } from "./types";
import { EN, type T } from "@/lib/i18n/t";

export type CheckItem = {
  id: string;
  /** "now": money or access at stake soon; "soon": worth a look this month; "idea": worth knowing. */
  tone: "now" | "soon" | "idea";
  title: string;
  detail: string;
  href: string;
};

export type CategoryMove = { category: SpendCategoryId; label: string; now: Cents; before: Cents; change: Cents };

export type CheckIn = {
  /** Last month, whole; null when Prism doesn't hold all of it. */
  month: MonthlyNumbers | null;
  /** What's worth a look, the most pressing first. */
  items: CheckItem[];
  /** The categories that moved most last month against the month before. */
  moves: CategoryMove[];
  /** Prices that rose against a year ago, the biggest effect first. */
  rises: PriceChange[];
  /** The bills the forecast has in the next 30 days. */
  ahead: { count: number; total: Cents } | null;
  nextPayday: ISODate | null;
};

/** A category's move counts when it's this big, both ways. */
const MOVE_MIN: Cents = 5_000;
const MOVE_SHARE = 0.15;
/** A card payment is "due" in the list from this many days ahead. */
const DUE_DAYS = 7;
/** An estimated tax payment is mentioned from this many days ahead. */
const EST_DAYS = 30;
/** What a friend owes is worth a nudge after this many days. */
const OWED_DAYS = 14;
/** A cushion under this many months of essentials is mentioned. */
const THIN_MONTHS = 3;

const order = { now: 0, soon: 1, idea: 2 } as const;

export function checkIn(a: Analysis, t: T = EN): CheckIn {
  const { today } = a;
  const { locale } = t;
  const txns = a.data.transactions;
  const items: CheckItem[] = [];

  // What the alerts already say: a bank that needs signing in, a bill the account won't cover, a price that rose, a new subscription, a charge after cancelling.
  for (const al of alertsFor(a, t)) items.push({ id: al.id, tone: al.urgent ? "now" : "soon", title: al.title, detail: al.detail, href: al.href });

  // Refunds past their usual wait.
  for (const w of a.refunds.waiting.filter((x) => x.late > 0)) {
    items.push({
      id: `refund:${w.id}`,
      tone: "soon",
      title: t("Your {amount} refund from {name} is late", { amount: money(w.amount), name: w.name }),
      detail: t("Waiting since {date}. Check with them, or say on Refunds if it came back another way.", { date: shortDate(w.asked, locale) }),
      href: "/refunds",
    });
  }

  // Fees in the last 30 days nobody gave back, and charges that may have gone through twice.
  const f = feesFor(txns, today);
  const fresh = f.fees.filter((x) => !x.refund && x.date > addDays(today, -30) && !Object.hasOwn(a.data.refundMarks ?? {}, x.id));
  if (fresh.length) {
    const total = fresh.reduce((s, x) => s + x.amount, 0);
    items.push({
      id: `fees:${fresh.map((x) => x.id).join(",")}`,
      tone: "soon",
      title: fresh.length === 1 ? t("A {amount} bank fee you could ask back", { amount: money(total) }) : t("{n} bank fees you could ask back: {amount}", { n: fresh.length, amount: money(total) }),
      detail: t("Banks often give a fee back if you ask. Fees has a request ready to send."),
      href: "/fees",
    });
  }
  for (const d of f.doubles.filter((x) => x.date > addDays(today, -30) && !x.ids.some((id) => Object.hasOwn(a.data.refundMarks ?? {}, id)))) {
    items.push({
      id: `double:${d.ids.join(",")}`,
      tone: "soon",
      title: t("{merchant} charged {amount} twice on {date}", { merchant: d.merchant, amount: money(d.amount), date: shortDate(d.date, locale) }),
      detail: t("That can be right. If you only meant to pay once, ask them to reverse one."),
      href: "/fees",
    });
  }

  // Budgets over this month, or on course to be.
  const over = a.budgets.filter((b) => b.state === "over");
  const atRisk = a.budgets.filter((b) => b.state === "at_risk");
  if (over.length) {
    items.push({
      id: `budgets-over:${over.map((b) => b.category).join(",")}`,
      tone: "soon",
      title:
        over.length === 1
          ? t("{category} is over its budget by {amount}", { category: categoryLabel(over[0]!.category, t), amount: money0(-over[0]!.remaining) })
          : t("{n} budgets are over this month", { n: over.length }),
      detail: t("Budgets shows where, and how the rest of the month looks."),
      href: "/budgets",
    });
  } else if (atRisk.length) {
    items.push({
      id: `budgets-risk:${atRisk.map((b) => b.category).join(",")}`,
      tone: "idea",
      title: atRisk.length === 1 ? t("{category} is on course to go over its budget", { category: categoryLabel(atRisk[0]!.category, t) }) : t("{n} budgets are on course to go over", { n: atRisk.length }),
      detail: t("At this month's pace. Budgets shows what's left for each."),
      href: "/budgets",
    });
  }

  // Cards: overdue, a payment due within the week, and a high share of the limits in use.
  const cards = cardsFor(a.data.accounts, txns, today);
  for (const c of cards.cards) {
    if (c.overdue) {
      items.push({ id: `card-overdue:${c.id}`, tone: "now", title: t("{card} is overdue", { card: c.name }), detail: t("Your card's lender says a payment is overdue."), href: "/cards" });
    } else if (c.dueDate && c.dueDate >= today && daysBetween(today, c.dueDate) <= DUE_DAYS && (c.minimumPayment ?? 0) > 0) {
      items.push({
        id: `card-due:${c.id}:${c.dueDate}`,
        tone: "now",
        title: t("{card}: {amount} due {date}", { card: c.name, amount: money(c.minimumPayment!), date: shortDate(c.dueDate, locale) }),
        detail: c.statementBalance ? t("The minimum. The statement balance is {amount}.", { amount: money(c.statementBalance) }) : t("The minimum your card's lender reports."),
        href: "/cards",
      });
    }
  }
  if (cards.usage !== null && cards.usage > 0.3) {
    items.push({
      id: "card-usage",
      tone: "idea",
      title: t("{pct} of your card limits in use", { pct: `${Math.round(cards.usage * 100)}%` }),
      detail: t("Credit scores tend to favour under 30%. Cards shows what paying before each statement would take."),
      href: "/cards",
    });
  }

  // An estimated tax payment due within the month, not yet met.
  const est = estimatedTax(a.data);
  // In its last week it's an alert (alerts.ts), already above under the same id.
  if (est?.next && est.next.state !== "paid" && daysBetween(today, est.next.due) <= EST_DAYS && !items.some((i) => i.id === `estimated-tax:${est.taxYear}:${est.next!.n}`)) {
    items.push({
      id: `estimated-tax:${est.taxYear}:${est.next.n}`,
      tone: daysBetween(today, est.next.due) <= DUE_DAYS ? "now" : "soon",
      title: t("Estimated tax payment due {date}", { date: shortDate(est.next.due, locale) }),
      detail:
        est.perQuarter !== null && est.next.target !== null
          ? t("Under the safe-harbor rule, about {amount} more by then, with withholding like last year's. Taxes shows the year.", { amount: money0(Math.max(0, est.next.target - est.next.paid)) })
          : t("Taxes shows the year's four dates and what Prism has seen paid to the IRS."),
      href: "/taxes",
    });
  }

  // What friends have owed for a while.
  const owedLong = a.refunds.owed.filter((o) => daysBetween(o.t.date, today) >= OWED_DAYS);
  if (owedLong.length) {
    const total = owedLong.reduce((s, o) => s + o.owed.amount, 0);
    items.push({
      id: `owed:${owedLong.map((o) => o.t.split?.of ?? o.t.id).join(",")}`,
      tone: "idea",
      title: owedLong.length === 1 ? t("{who} still owes you {amount}", { who: owedLong[0]!.owed.who, amount: money(total) }) : t("{n} people still owe you {amount}", { n: owedLong.length, amount: money(total) }),
      detail: t("Refunds has a friendly reminder ready to send."),
      href: "/refunds",
    });
  }

  // A thin cushion.
  if (a.runway && a.runway.months.essentials < THIN_MONTHS) {
    items.push({
      id: "runway",
      tone: "idea",
      title: t("Your savings would cover essentials for {n}", { n: a.runway.months.essentials < 1 ? t("less than a month") : t("about {n} months", { n: Math.floor(a.runway.months.essentials) }) }),
      detail: t("Many people aim for three to six. Future shows how it's worked out."),
      href: "/future",
    });
  }

  items.sort((x, y) => order[x.tone] - order[y.tone]);

  // Last month against the month before, by category.
  const thisMonth = startOfMonth(today);
  const from = addMonths(thisMonth, -1);
  const to = addDays(thisMonth, -1);
  const prevFrom = addMonths(from, -1);
  const month = monthlyNumbers(a);
  const moves: CategoryMove[] =
    month?.before
      ? categoryBreakdown(txns, { from, to }, { from: prevFrom, to: addDays(from, -1) })
          .map((r) => ({ category: r.category, label: categoryLabel(r.category, t), now: r.amount, before: r.previous, change: r.amount - r.previous }))
          .filter((m) => Math.abs(m.change) >= MOVE_MIN && m.before > 0 && Math.abs(m.change) / m.before >= MOVE_SHARE)
          .sort((x, y) => Math.abs(y.change) - Math.abs(x.change))
          .slice(0, 3)
      : [];

  return {
    month,
    items,
    moves,
    rises: inflationFor(txns, today).prices.filter((p) => p.change > 0).slice(0, 3),
    ahead: month?.ahead ?? null,
    nextPayday: a.income.next?.date ?? null,
  };
}
