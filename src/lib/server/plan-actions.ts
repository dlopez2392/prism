"use server";

// src/lib/server/plan-actions.ts
//
// The Server Actions behind the budget and goal editors. Each one validates
// the whole form, writes ONE place — the signed-in person's account, or this
// device's cookie — and returns a message. Either way the page re-renders in
// the same response (a cookie write does that by itself; an account write
// calls refresh()), so every chart moves with the edit. Next checks each
// action's Origin against the host (CSRF), and nothing here trusts the
// browser: the form is re-parsed and the resulting list is re-validated
// before it is written.

import { refresh } from "next/cache";
import { cookies } from "next/headers";
import {
  goalId,
  goalSettings,
  MAX_GOALS,
  MAX_MONTHLY,
  nextColorSlot,
  readBudgetForm,
  readGoalForm,
  validGoals,
  type GoalSettings,
  type PlanFormState,
} from "@/lib/finance/plan";
import type { Budget } from "@/lib/finance/types";
import { currentAccount } from "@/lib/supabase/server";
import { saveAccountBudgets, saveAccountGoals } from "./account-store";
import { readSources, requestToday, sourceGoals } from "./finance";
import { BUDGETS_COOKIE, encodePlanValue, GOALS_COOKIE, PLAN_COOKIE_MAX, planCookieOptions } from "./plan-store";

const saved = (message: string): PlanFormState => ({ status: "saved", message, at: Date.now() });
const failed = (message: string, fields?: Record<string, string | undefined>): PlanFormState => ({ status: "error", message, fields });

/** Budgets go to the account when signed in, else to this device. Null means "back to suggested". */
async function writeBudgets(budgets: Budget[] | null): Promise<void> {
  const account = await currentAccount();
  if (account) {
    await saveAccountBudgets(account, budgets);
    refresh();
    return;
  }
  const jar = await cookies();
  if (budgets) jar.set(BUDGETS_COOKIE, encodePlanValue(budgets), planCookieOptions());
  else jar.delete(BUDGETS_COOKIE);
}

export async function saveBudgets(_prev: PlanFormState, form: FormData): Promise<PlanFormState> {
  const read = readBudgetForm(form);
  if ("errors" in read) return failed("Check the highlighted amounts.", read.errors);
  try {
    await writeBudgets(read.budgets);
  } catch {
    return failed("That didn't save. Try again in a moment.");
  }
  const where = (await currentAccount()) ? "to your account" : "on this device";
  return saved(read.budgets.length ? `Budgets saved ${where}.` : `Budgets cleared ${where}.`);
}

export async function resetBudgets(): Promise<PlanFormState> {
  try {
    await writeBudgets(null);
  } catch {
    return failed("That didn't save. Try again in a moment.");
  }
  return saved("Back to the suggested budgets.");
}

/** The goals as they stand: the person's own edits if any, else the source's. */
async function currentGoals(): Promise<GoalSettings[]> {
  const sources = await readSources();
  return sources.plan.goals ?? (await sourceGoals(sources)).map(goalSettings);
}

async function writeGoals(goals: GoalSettings[] | null, message: string): Promise<PlanFormState> {
  if (goals && validGoals(goals) === null) return failed("Something in that goal didn't check out. Try again.");
  const account = await currentAccount();
  if (account) {
    try {
      await saveAccountGoals(account, goals);
    } catch {
      return failed("That didn't save. Try again in a moment.");
    }
    refresh();
    return saved(message.replace("on this device", "to your account"));
  }
  const jar = await cookies();
  if (!goals) {
    jar.delete(GOALS_COOKIE);
    return saved(message);
  }
  const value = encodePlanValue(goals);
  if (value.length > PLAN_COOKIE_MAX) return failed("That's more than this browser can hold. Try shorter goal names, or sign in to keep them in an account.");
  jar.set(GOALS_COOKIE, value, planCookieOptions());
  return saved(message);
}

export async function saveGoal(_prev: PlanFormState, form: FormData): Promise<PlanFormState> {
  const read = readGoalForm(form, await requestToday());
  if ("errors" in read) return failed("Check the highlighted fields.", read.errors);
  const goals = await currentGoals();
  const id = form.get("id");
  if (typeof id === "string" && id !== "") {
    const i = goals.findIndex((g) => g.id === id);
    if (i < 0) return failed("That goal isn't here any more. It may have been deleted in another tab.");
    goals[i] = { ...goals[i]!, ...read.goal };
    return writeGoals(goals, `Saved “${read.goal.name}” on this device.`);
  }
  if (goals.length >= MAX_GOALS) return failed(`Prism tracks up to ${MAX_GOALS} goals at once. Finish or delete one first.`);
  goals.push({ id: goalId(read.goal.name, goals.map((g) => g.id)), colorSlot: nextColorSlot(goals), ...read.goal });
  return writeGoals(goals, `Added “${read.goal.name}”.`);
}

export async function deleteGoal(_prev: PlanFormState, form: FormData): Promise<PlanFormState> {
  const id = form.get("id");
  const goals = await currentGoals();
  const goal = goals.find((g) => g.id === id);
  if (!goal) return failed("That goal is already gone.");
  return writeGoals(
    goals.filter((g) => g.id !== id),
    `Deleted “${goal.name}”.`,
  );
}

export async function restoreGoals(): Promise<PlanFormState> {
  return writeGoals(null, "The example goals are back.");
}

/** "Use this amount" from the what-if slider: the value arrives in cents. */
export async function setGoalMonthly(_prev: PlanFormState, form: FormData): Promise<PlanFormState> {
  const id = form.get("id");
  const monthly = Number(form.get("monthly"));
  if (!Number.isInteger(monthly) || monthly < 0 || monthly > MAX_MONTHLY) return failed("That amount didn't come through. Try again.");
  const goals = await currentGoals();
  const i = goals.findIndex((g) => g.id === id);
  if (i < 0) return failed("That goal isn't here any more.");
  goals[i] = { ...goals[i]!, monthlyContribution: monthly };
  return writeGoals(goals, `“${goals[i]!.name}” now plans on this monthly amount.`);
}
