"use server";

// src/lib/server/plan-actions.ts
//
// The Server Actions behind the budget and goal editors. Each one validates
// the whole form, writes one cookie, and returns a message; setting a cookie
// makes Next.js re-render the page in the same response, so every chart moves
// with the edit. Next checks each action's Origin against the host (CSRF), and
// nothing here trusts the browser: the form is re-parsed and the resulting
// list is re-validated before it is written.

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
import { requestToday, sourceGoals } from "./finance";
import { BUDGETS_COOKIE, encodePlanValue, GOALS_COOKIE, PLAN_COOKIE_MAX, planCookieOptions, readPlan } from "./plan-store";

const saved = (message: string): PlanFormState => ({ status: "saved", message, at: Date.now() });
const failed = (message: string, fields?: Record<string, string | undefined>): PlanFormState => ({ status: "error", message, fields });

export async function saveBudgets(_prev: PlanFormState, form: FormData): Promise<PlanFormState> {
  const read = readBudgetForm(form);
  if ("errors" in read) return failed("Check the highlighted amounts.", read.errors);
  (await cookies()).set(BUDGETS_COOKIE, encodePlanValue(read.budgets), planCookieOptions());
  return saved(read.budgets.length ? "Budgets saved on this device." : "Budgets cleared on this device.");
}

export async function resetBudgets(): Promise<PlanFormState> {
  (await cookies()).delete(BUDGETS_COOKIE);
  return saved("Back to the suggested budgets.");
}

/** The goals as they stand: this device's edits if any, else the source's. */
async function currentGoals(): Promise<GoalSettings[]> {
  const plan = readPlan(await cookies());
  return plan.goals ?? (await sourceGoals()).map(goalSettings);
}

async function writeGoals(goals: GoalSettings[], message: string): Promise<PlanFormState> {
  if (validGoals(goals) === null) return failed("Something in that goal didn't check out. Try again.");
  const value = encodePlanValue(goals);
  if (value.length > PLAN_COOKIE_MAX) return failed("That's more than this device can hold. Try shorter goal names.");
  (await cookies()).set(GOALS_COOKIE, value, planCookieOptions());
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
  (await cookies()).delete(GOALS_COOKIE);
  return saved("The example goals are back.");
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
