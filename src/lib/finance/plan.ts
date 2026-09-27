// src/lib/finance/plan.ts
//
// The person's own plan: budgets and goals they have edited, saved on this
// device until Prism has accounts. A plan is an OVERLAY on whatever the data
// source provides (the demo household's seeded plan, or budgets drafted from
// a live bank's history): an edited list replaces the source's list whole, and
// every screen reads the result through `analyze`, so an edit moves every
// chart at once.
//
// Everything here is pure and runs on either side of the network. The cookie
// codec lives in `src/lib/server/plan-store.ts`. Whatever arrives from a
// cookie is untrusted, so each validator is all-or-nothing: one bad field
// discards the whole list rather than half-applying it.

import { SPEND_CATEGORIES } from "./categories";
import { addDays, addMonths } from "./dates";
import type { Budget, Cents, FinanceData, Goal, ISODate, SpendCategoryId } from "./types";

/** A goal as the person states it; `history` is derived, never stored. */
export type GoalSettings = Omit<Goal, "history">;

export type Plan = { budgets: Budget[] | null; goals: GoalSettings[] | null };

/** Eight goals is eight colours: a ninth would have to share one. */
export const MAX_GOALS = 8;
export const GOAL_NAME_MAX = 32;
/** $1,000,000 a month is a ceiling on typos, not on ambition. */
export const MAX_MONTHLY: Cents = 100_000_000;
export const MAX_TARGET: Cents = 1_000_000_000;
export const GOAL_HORIZON_YEARS = 40;

export const GOAL_EMOJIS = ["🛟", "🏡", "🗾", "💻", "🚗", "🎓", "💍", "👶", "🏖️", "🎁", "🐶", "🌱"] as const;

/**
 * "$1,950", "1950.5", " 1,950.00 " → cents. Null for anything that is not a
 * plain non-negative dollar amount with at most two decimals — no signs, no
 * exponents, no "1.2k". The empty string is also null; callers decide whether
 * blank means "none" or "missing".
 */
export function parseDollars(input: string): Cents | null {
  const s = input.trim().replace(/^\$/, "").replace(/,/g, "").trim();
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

/** Cents → the plain string an input shows: 195000 → "1950", 1999 → "19.99". */
export function dollarsInput(cents: Cents): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

/** The last day of a "YYYY-MM" month: a goal "by March" means by March 31. */
export function monthEndOf(month: string): ISODate | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!m) return null;
  return addDays(addMonths(`${m[1]}-${m[2]}-01`, 1), -1);
}

const isInt = (x: unknown, min: number, max: number): x is number => Number.isInteger(x) && (x as number) >= min && (x as number) <= max;

function isISODate(x: unknown): x is ISODate {
  if (typeof x !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x)) return false;
  const d = new Date(`${x}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === x;
}

/** Trimmed, single-spaced, no control characters, 1–32 characters. */
export function cleanGoalName(x: unknown): string | null {
  if (typeof x !== "string") return null;
  const s = x.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, "").replace(/\s+/g, " ").trim();
  const length = [...s].length;
  return length >= 1 && length <= GOAL_NAME_MAX ? s : null;
}

export function validBudgets(x: unknown): Budget[] | null {
  if (!Array.isArray(x) || x.length > SPEND_CATEGORIES.length) return null;
  const seen = new Set<SpendCategoryId>();
  const out: Budget[] = [];
  for (const b of x as unknown[]) {
    if (!b || typeof b !== "object") return null;
    const { category, limit } = b as Record<string, unknown>;
    if (!SPEND_CATEGORIES.includes(category as SpendCategoryId) || seen.has(category as SpendCategoryId)) return null;
    if (!isInt(limit, 1, MAX_MONTHLY)) return null;
    seen.add(category as SpendCategoryId);
    out.push({ category: category as SpendCategoryId, limit });
  }
  return out.sort((a, b) => SPEND_CATEGORIES.indexOf(a.category) - SPEND_CATEGORIES.indexOf(b.category));
}

export function validGoals(x: unknown): GoalSettings[] | null {
  if (!Array.isArray(x) || x.length > MAX_GOALS) return null;
  const ids = new Set<string>();
  const out: GoalSettings[] = [];
  for (const g of x as unknown[]) {
    if (!g || typeof g !== "object") return null;
    const r = g as Record<string, unknown>;
    const name = cleanGoalName(r.name);
    if (typeof r.id !== "string" || !/^[a-z0-9-]{1,24}$/.test(r.id) || ids.has(r.id)) return null;
    if (name === null || name !== r.name) return null;
    if (!GOAL_EMOJIS.includes(r.emoji as (typeof GOAL_EMOJIS)[number])) return null;
    if (!isInt(r.target, 1, MAX_TARGET) || !isInt(r.saved, 0, MAX_TARGET) || !isInt(r.monthlyContribution, 0, MAX_MONTHLY)) return null;
    if (!isISODate(r.targetDate) || !isInt(r.colorSlot, 1, 8)) return null;
    ids.add(r.id);
    out.push({
      id: r.id,
      name,
      emoji: r.emoji as string,
      target: r.target,
      saved: r.saved,
      monthlyContribution: r.monthlyContribution,
      targetDate: r.targetDate,
      colorSlot: r.colorSlot,
    });
  }
  return out;
}

export function goalSettings(g: Goal): GoalSettings {
  return {
    id: g.id,
    name: g.name,
    emoji: g.emoji,
    target: g.target,
    saved: g.saved,
    monthlyContribution: g.monthlyContribution,
    targetDate: g.targetDate,
    colorSlot: g.colorSlot,
  };
}

/**
 * A stated goal back into a full Goal. The source's month-by-month history is
 * kept for a goal it already knew; if the person corrected what's saved, the
 * latest point moves to match. A goal made on this device has one honest
 * point — today's — rather than an invented past.
 */
export function toGoal(s: GoalSettings, base: Goal | undefined): Goal {
  if (!base || base.history.length === 0) return { ...s, history: [s.saved] };
  const history = base.saved === s.saved ? base.history : [...base.history.slice(0, -1), s.saved];
  return { ...s, history };
}

export function applyPlan<T extends FinanceData>(data: T, plan: Plan): T {
  const byId = new Map(data.goals.map((g) => [g.id, g]));
  return {
    ...data,
    budgets: plan.budgets ?? data.budgets,
    goals: plan.goals ? plan.goals.map((g) => toGoal(g, byId.get(g.id))) : data.goals,
  };
}

/** The lowest colour slot no other goal wears, so two goals never share one. */
export function nextColorSlot(goals: GoalSettings[]): number {
  const used = new Set(goals.map((g) => g.colorSlot));
  for (let s = 1; s <= 8; s++) if (!used.has(s)) return s;
  return 1;
}

/** A short id from the name, unique among `taken`: "Japan trip" → "japan-trip". */
export function goalId(name: string, taken: Iterable<string>): string {
  const base =
    name
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 20)
      .replace(/-+$/, "") || "goal";
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
}

/** The average of each category's spending over the last three full months. */
export type TypicalSpend = Record<SpendCategoryId, Cents>;

export type FieldErrors = Partial<Record<string, string>>;

/**
 * Reads the budget editor's form: one `limit:<category>` field per category,
 * blank meaning "no budget here". Every field is checked before anything is
 * returned, so a typo in one line never saves the others half-way.
 */
export function readBudgetForm(form: FormData): { budgets: Budget[] } | { errors: FieldErrors } {
  const errors: FieldErrors = {};
  const budgets: Budget[] = [];
  for (const category of SPEND_CATEGORIES) {
    const raw = form.get(`limit:${category}`);
    const text = typeof raw === "string" ? raw.trim() : "";
    if (text === "") continue;
    const cents = parseDollars(text);
    if (cents === null) errors[category] = "Enter an amount like 450 or 450.50.";
    else if (cents === 0) continue;
    else if (cents > MAX_MONTHLY) errors[category] = "That's more than $1,000,000 a month.";
    else budgets.push({ category, limit: cents });
  }
  return Object.keys(errors).length ? { errors } : { budgets };
}

export type GoalInput = Omit<GoalSettings, "id" | "colorSlot">;

/** Reads the goal editor's form. `today` bounds the target month. */
export function readGoalForm(form: FormData, today: ISODate): { goal: GoalInput } | { errors: FieldErrors } {
  const text = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v.trim() : "";
  };
  const errors: FieldErrors = {};

  const name = cleanGoalName(text("name"));
  if (name === null) errors.name = text("name") ? `Keep it to ${GOAL_NAME_MAX} characters.` : "Give the goal a name.";

  const emoji = text("emoji");
  if (!GOAL_EMOJIS.includes(emoji as (typeof GOAL_EMOJIS)[number])) errors.emoji = "Pick an icon.";

  const money = (key: string, required: boolean, max: Cents, tooBig: string) => {
    const t = text(key);
    if (t === "") {
      if (required) errors[key] = "Enter an amount.";
      return 0;
    }
    const c = parseDollars(t);
    if (c === null) errors[key] = "Enter an amount like 5000 or 5,000.";
    else if (c > max) errors[key] = tooBig;
    return c ?? 0;
  };
  const target = money("target", true, MAX_TARGET, "That's more than $10,000,000.");
  const saved = money("saved", false, MAX_TARGET, "That's more than $10,000,000.");
  const monthlyContribution = money("monthly", false, MAX_MONTHLY, "That's more than $1,000,000 a month.");
  if (!errors.target && target === 0) errors.target = "The target needs to be more than $0.";

  const month = `${text("year")}-${text("month").padStart(2, "0")}`;
  const targetDate = monthEndOf(month);
  const first = today.slice(0, 7);
  const last = `${Number(today.slice(0, 4)) + GOAL_HORIZON_YEARS}-12`;
  if (!targetDate || month < first || month > last) errors.targetDate = "Pick a month from this one onward.";

  if (Object.keys(errors).length) return { errors };
  return { goal: { name: name!, emoji, target, saved, monthlyContribution, targetDate: targetDate! } };
}

/** What an editor shows after a save: nothing yet, a confirmation, or what to fix. */
export type PlanFormState =
  | { status: "idle" }
  | { status: "saved"; message: string; at: number }
  | { status: "error"; message: string; fields?: FieldErrors };

export const IDLE: PlanFormState = { status: "idle" };
