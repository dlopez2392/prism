"use server";

// src/lib/server/plan-actions.ts
//
// The Server Actions behind the budget and goal editors. Each one validates
// the whole form, writes ONE place — the signed-in person's account, this
// device's cookie, or, from the Household view, the household's own plan —
// and returns a message. Either way the page re-renders in the same response
// (a cookie write does that by itself; an account or household write calls
// refresh()), so every chart moves with the edit. Next checks each action's
// Origin against the host (CSRF), and nothing here trusts the browser: the
// form is re-parsed and the resulting list is re-validated before it is
// written.
//
// A household's plan is shared by up to four people, so its writes name the
// version they were made from. Budgets are edited as a whole list, so a save
// from a list someone else has since changed is refused and theirs is shown.
// Goals are edited one at a time, so each edit is applied to the LATEST list
// (read again, and once more if someone saved in between) and nobody's other
// goals are ever put back.

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
  validBudgets,
  validGoals,
  type GoalSettings,
  type PlanFormState,
} from "@/lib/finance/plan";
import type { Budget } from "@/lib/finance/types";
import { currentAccount } from "@/lib/supabase/server";
import { saveAccountBudgets, saveAccountGoals } from "./account-store";
import { readSources, requestToday, sourceGoals } from "./finance";
import { HouseholdError, loadHouseholdPlan, saveHouseholdBudgets, saveHouseholdGoals } from "./household-store";
import { BUDGETS_COOKIE, encodePlanValue, GOALS_COOKIE, PLAN_COOKIE_MAX, planCookieOptions } from "./plan-store";

const saved = (message: string): PlanFormState => ({ status: "saved", message, at: Date.now() });
const failed = (message: string, fields?: Record<string, string | undefined>): PlanFormState => ({ status: "error", message, fields });

/** Whose plan a form edits: the person's own, unless it says the household's. */
const forHousehold = (form: FormData | undefined) => form?.get("scope") === "household";

const NOT_IN_HOUSEHOLD = "You're not in a household any more. Your own plan is under Me.";
const DIDNT_SAVE = "That didn't save. Try again in a moment.";

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

/** The household's budgets, from the version the editor was showing. Null means "back to drafted". */
async function writeHouseholdBudgets(form: FormData, budgets: Budget[] | null, message: string): Promise<PlanFormState> {
  const account = await currentAccount();
  if (!account) return failed("Sign in to change your household's budgets.");
  const raw = form.get("version");
  if (typeof raw !== "string" || !/^\d{1,9}$/.test(raw)) return failed("Something in that form didn't check out. Reload the page and try again.");
  const version = Number(raw);
  if (budgets && validBudgets(budgets) === null) return failed("Something in those budgets didn't check out. Try again.");
  try {
    await saveHouseholdBudgets(account, budgets, version);
  } catch (e) {
    if (e instanceof HouseholdError && e.reason === "stale") {
      const who = (await loadHouseholdPlan(account).catch(() => null))?.budgetsChanged?.by ?? "Someone in your household";
      refresh();
      return failed(`${who} changed these budgets a moment ago, so yours weren't saved. Theirs are showing now: check them and save again.`);
    }
    if (e instanceof HouseholdError && e.reason === "outside") return failed(NOT_IN_HOUSEHOLD);
    return failed(DIDNT_SAVE);
  }
  refresh();
  return saved(message);
}

export async function saveBudgets(_prev: PlanFormState, form: FormData): Promise<PlanFormState> {
  const read = readBudgetForm(form);
  if ("errors" in read) return failed("Check the highlighted amounts.", read.errors);
  if (forHousehold(form)) {
    return writeHouseholdBudgets(form, read.budgets, read.budgets.length ? "Household budgets saved. Everyone in your household sees them." : "Household budgets cleared.");
  }
  try {
    await writeBudgets(read.budgets);
  } catch {
    return failed(DIDNT_SAVE);
  }
  const where = (await currentAccount()) ? "to your account" : "on this device";
  return saved(read.budgets.length ? `Budgets saved ${where}.` : `Budgets cleared ${where}.`);
}

export async function resetBudgets(form?: FormData): Promise<PlanFormState> {
  if (form && forHousehold(form)) return writeHouseholdBudgets(form, null, "Back to the budgets drafted from what your household shares.");
  try {
    await writeBudgets(null);
  } catch {
    return failed(DIDNT_SAVE);
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
      return failed(DIDNT_SAVE);
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

/** One edit to a goal list: the new list and what to say, or why not. */
type GoalChange = (goals: GoalSettings[]) => { goals: GoalSettings[]; message: string } | { error: string };

/** One edit, applied to the household's latest goals; tried once more if someone saved in between. */
async function changeHouseholdGoals(change: GoalChange): Promise<PlanFormState> {
  const account = await currentAccount();
  if (!account) return failed("Sign in to change your household's goals.");
  for (let attempt = 0; attempt < 2; attempt++) {
    let plan;
    try {
      plan = await loadHouseholdPlan(account);
    } catch {
      return failed(DIDNT_SAVE);
    }
    if (!plan) return failed(NOT_IN_HOUSEHOLD);
    const next = change([...(plan.goals ?? [])]);
    if ("error" in next) return failed(next.error);
    if (validGoals(next.goals) === null) return failed("Something in that goal didn't check out. Try again.");
    try {
      await saveHouseholdGoals(account, next.goals, plan.goalsVersion);
    } catch (e) {
      if (e instanceof HouseholdError && e.reason === "stale") continue;
      if (e instanceof HouseholdError && e.reason === "outside") return failed(NOT_IN_HOUSEHOLD);
      return failed(DIDNT_SAVE);
    }
    refresh();
    return saved(next.message.replace("on this device", "for your household"));
  }
  refresh();
  return failed("Someone in your household is changing these goals right now. Try again in a moment.");
}

/** Apply one edit to whichever goals the form is for. */
async function changeGoals(form: FormData, change: GoalChange): Promise<PlanFormState> {
  if (forHousehold(form)) return changeHouseholdGoals(change);
  const next = change(await currentGoals());
  if ("error" in next) return failed(next.error);
  return writeGoals(next.goals, next.message);
}

export async function saveGoal(_prev: PlanFormState, form: FormData): Promise<PlanFormState> {
  const read = readGoalForm(form, await requestToday());
  if ("errors" in read) return failed("Check the highlighted fields.", read.errors);
  const id = form.get("id");
  return changeGoals(form, (goals) => {
    if (typeof id === "string" && id !== "") {
      const i = goals.findIndex((g) => g.id === id);
      if (i < 0) return { error: "That goal isn't here any more. It may have been deleted in another tab." };
      goals[i] = { ...goals[i]!, ...read.goal };
      return { goals, message: `Saved “${read.goal.name}” on this device.` };
    }
    if (goals.length >= MAX_GOALS) return { error: `Prism tracks up to ${MAX_GOALS} goals at once. Finish or delete one first.` };
    goals.push({ id: goalId(read.goal.name, goals.map((g) => g.id)), colorSlot: nextColorSlot(goals), ...read.goal });
    return { goals, message: `Added “${read.goal.name}”.` };
  });
}

export async function deleteGoal(_prev: PlanFormState, form: FormData): Promise<PlanFormState> {
  const id = form.get("id");
  return changeGoals(form, (goals) => {
    const goal = goals.find((g) => g.id === id);
    if (!goal) return { error: "That goal is already gone." };
    return { goals: goals.filter((g) => g.id !== id), message: `Deleted “${goal.name}”.` };
  });
}

export async function restoreGoals(): Promise<PlanFormState> {
  return writeGoals(null, "The example goals are back.");
}

/** "Use this amount" from the what-if slider: the value arrives in cents. */
export async function setGoalMonthly(_prev: PlanFormState, form: FormData): Promise<PlanFormState> {
  const id = form.get("id");
  const monthly = Number(form.get("monthly"));
  if (!Number.isInteger(monthly) || monthly < 0 || monthly > MAX_MONTHLY) return failed("That amount didn't come through. Try again.");
  return changeGoals(form, (goals) => {
    const i = goals.findIndex((g) => g.id === id);
    if (i < 0) return { error: "That goal isn't here any more." };
    goals[i] = { ...goals[i]!, monthlyContribution: monthly };
    return { goals, message: `“${goals[i]!.name}” now plans on this monthly amount.` };
  });
}
