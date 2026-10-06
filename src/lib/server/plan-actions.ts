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
  GOAL_NAME_MAX,
  goalSettings,
  MAX_GOALS,
  MAX_MONTHLY,
  nextColorSlot,
  readBudgetForm,
  readGoalForm,
  validBudgets,
  validGoals,
  type FieldErrors,
  type GoalSettings,
  type PlanFormState,
} from "@/lib/finance/plan";
import type { Budget } from "@/lib/finance/types";
import { currentAccount } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { msg, type T, type Vars } from "@/lib/i18n/t";
import { saveAccountBudgets, saveAccountGoals } from "./account-store";
import { readSources, requestToday, sourceGoals } from "./finance";
import { HouseholdError, loadHouseholdPlan, saveHouseholdBudgets, saveHouseholdGoals } from "./household-store";
import { BUDGETS_COOKIE, encodePlanValue, GOALS_COOKIE, PLAN_COOKIE_MAX, planCookieOptions } from "./plan-store";

const saved = (message: string): PlanFormState => ({ status: "saved", message, at: Date.now() });
const failed = (message: string, fields?: Record<string, string | undefined>): PlanFormState => ({ status: "error", message, fields });

/** Whose plan a form edits: the person's own, unless it says the household's. */
const forHousehold = (form: FormData | undefined) => form?.get("scope") === "household";

const NOT_IN_HOUSEHOLD = msg("You're not in a household any more. Your own plan is under Me.");
const DIDNT_SAVE = msg("That didn't save. Try again in a moment.");

/** Each highlighted field's message, in the person's language, with any {name} in it filled from `vars`. */
const fieldsIn = (t: T, fields: FieldErrors, vars?: Vars): FieldErrors =>
  Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v === undefined ? v : t(v, vars)]));

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
async function writeHouseholdBudgets(form: FormData, budgets: Budget[] | null, message: string, t: T): Promise<PlanFormState> {
  const account = await currentAccount();
  if (!account) return failed(t("Sign in to change your household's budgets."));
  const raw = form.get("version");
  if (typeof raw !== "string" || !/^\d{1,9}$/.test(raw)) return failed(t("Something in that form didn't check out. Reload the page and try again."));
  const version = Number(raw);
  if (budgets && validBudgets(budgets) === null) return failed(t("Something in those budgets didn't check out. Try again."));
  try {
    await saveHouseholdBudgets(account, budgets, version);
  } catch (e) {
    if (e instanceof HouseholdError && e.reason === "stale") {
      const who = (await loadHouseholdPlan(account).catch(() => null))?.budgetsChanged?.by ?? t("Someone in your household");
      refresh();
      return failed(t("{who} changed these budgets a moment ago, so yours weren't saved. Theirs are showing now: check them and save again.", { who }));
    }
    if (e instanceof HouseholdError && e.reason === "outside") return failed(t(NOT_IN_HOUSEHOLD));
    return failed(t(DIDNT_SAVE));
  }
  refresh();
  return saved(message);
}

export async function saveBudgets(_prev: PlanFormState, form: FormData): Promise<PlanFormState> {
  const t = await getT();
  const read = readBudgetForm(form);
  if ("errors" in read) return failed(t("Check the highlighted amounts."), fieldsIn(t, read.errors));
  if (forHousehold(form)) {
    return writeHouseholdBudgets(form, read.budgets, read.budgets.length ? t("Household budgets saved. Everyone in your household sees them.") : t("Household budgets cleared."), t);
  }
  try {
    await writeBudgets(read.budgets);
  } catch {
    return failed(t(DIDNT_SAVE));
  }
  const signedIn = (await currentAccount()) !== null;
  if (read.budgets.length) return saved(signedIn ? t("Budgets saved to your account.") : t("Budgets saved on this device."));
  return saved(signedIn ? t("Budgets cleared to your account.") : t("Budgets cleared on this device."));
}

export async function resetBudgets(form?: FormData): Promise<PlanFormState> {
  const t = await getT();
  if (form && forHousehold(form)) return writeHouseholdBudgets(form, null, t("Back to the budgets drafted from what your household shares."), t);
  try {
    await writeBudgets(null);
  } catch {
    return failed(t(DIDNT_SAVE));
  }
  return saved(t("Back to the suggested budgets."));
}

/** The goals as they stand: the person's own edits if any, else the source's. */
async function currentGoals(): Promise<GoalSettings[]> {
  const sources = await readSources();
  return sources.plan.goals ?? (await sourceGoals(sources)).map(goalSettings);
}

const GOAL_DIDNT_CHECK_OUT = msg("Something in that goal didn't check out. Try again.");

/** Where a goal edit was saved, which is what its message says. */
type Where = "device" | "account" | "household";

/** What to say once a goal edit is saved, by where it went. */
type Said = (where: Where) => string;

async function writeGoals(edited: GoalSettings[] | null, message: Said, t: T): Promise<PlanFormState> {
  // Written exactly as validated: nothing the validator wouldn't keep (an unlinked goal's empty accountId, say).
  const goals = edited && validGoals(edited);
  if (edited && !goals) return failed(t(GOAL_DIDNT_CHECK_OUT));
  const account = await currentAccount();
  if (account) {
    try {
      await saveAccountGoals(account, goals);
    } catch {
      return failed(t(DIDNT_SAVE));
    }
    refresh();
    return saved(message("account"));
  }
  const jar = await cookies();
  if (!goals) {
    jar.delete(GOALS_COOKIE);
    return saved(message("device"));
  }
  const value = encodePlanValue(goals);
  if (value.length > PLAN_COOKIE_MAX) return failed(t("That's more than this browser can hold. Try shorter goal names, or sign in to keep them in an account."));
  jar.set(GOALS_COOKIE, value, planCookieOptions());
  return saved(message("device"));
}

/** One edit to a goal list: the new list and what to say, or why not. */
type GoalChange = (goals: GoalSettings[]) => { goals: GoalSettings[]; message: Said } | { error: string };

/** One edit, applied to the household's latest goals; tried once more if someone saved in between. */
async function changeHouseholdGoals(change: GoalChange, t: T): Promise<PlanFormState> {
  const account = await currentAccount();
  if (!account) return failed(t("Sign in to change your household's goals."));
  for (let attempt = 0; attempt < 2; attempt++) {
    let plan;
    try {
      plan = await loadHouseholdPlan(account);
    } catch {
      return failed(t(DIDNT_SAVE));
    }
    if (!plan) return failed(t(NOT_IN_HOUSEHOLD));
    const next = change([...(plan.goals ?? [])]);
    if ("error" in next) return failed(next.error);
    const goals = validGoals(next.goals);
    if (!goals) return failed(t(GOAL_DIDNT_CHECK_OUT));
    try {
      await saveHouseholdGoals(account, goals, plan.goalsVersion);
    } catch (e) {
      if (e instanceof HouseholdError && e.reason === "stale") continue;
      if (e instanceof HouseholdError && e.reason === "outside") return failed(t(NOT_IN_HOUSEHOLD));
      return failed(t(DIDNT_SAVE));
    }
    refresh();
    return saved(next.message("household"));
  }
  refresh();
  return failed(t("Someone in your household is changing these goals right now. Try again in a moment."));
}

/** Apply one edit to whichever goals the form is for. */
async function changeGoals(form: FormData, change: GoalChange, t: T): Promise<PlanFormState> {
  if (forHousehold(form)) return changeHouseholdGoals(change, t);
  const next = change(await currentGoals());
  if ("error" in next) return failed(next.error);
  return writeGoals(next.goals, next.message, t);
}

export async function saveGoal(_prev: PlanFormState, form: FormData): Promise<PlanFormState> {
  const t = await getT();
  const read = readGoalForm(form, await requestToday());
  if ("errors" in read) return failed(t("Check the highlighted fields."), fieldsIn(t, read.errors, { max: GOAL_NAME_MAX }));
  const id = form.get("id");
  const name = read.goal.name;
  return changeGoals(
    form,
    (goals) => {
      // One account, one goal: two goals following the same balance would count it twice.
      const taken = read.goal.accountId ? goals.find((g) => g.accountId === read.goal.accountId && g.id !== id) : undefined;
      if (taken) return { error: t("“{name}” already follows that account. Pick another, or enter what's saved yourself.", { name: taken.name }) };
      if (typeof id === "string" && id !== "") {
        const i = goals.findIndex((g) => g.id === id);
        if (i < 0) return { error: t("That goal isn't here any more. It may have been deleted in another tab.") };
        goals[i] = { ...goals[i]!, ...read.goal };
        return {
          goals,
          message: (where) =>
            where === "account"
              ? t("Saved “{name}” to your account.", { name })
              : where === "household"
                ? t("Saved “{name}” for your household.", { name })
                : t("Saved “{name}” on this device.", { name }),
        };
      }
      if (goals.length >= MAX_GOALS) return { error: t("Prism tracks up to {n} goals at once. Finish or delete one first.", { n: MAX_GOALS }) };
      goals.push({ id: goalId(name, goals.map((g) => g.id)), colorSlot: nextColorSlot(goals), ...read.goal });
      return { goals, message: () => t("Added “{name}”.", { name }) };
    },
    t,
  );
}

export async function deleteGoal(_prev: PlanFormState, form: FormData): Promise<PlanFormState> {
  const t = await getT();
  const id = form.get("id");
  return changeGoals(
    form,
    (goals) => {
      const goal = goals.find((g) => g.id === id);
      if (!goal) return { error: t("That goal is already gone.") };
      return { goals: goals.filter((g) => g.id !== id), message: () => t("Deleted “{name}”.", { name: goal.name }) };
    },
    t,
  );
}

export async function restoreGoals(): Promise<PlanFormState> {
  const t = await getT();
  return writeGoals(null, () => t("The example goals are back."), t);
}

/** "Use this amount" from the what-if slider: the value arrives in cents. */
export async function setGoalMonthly(_prev: PlanFormState, form: FormData): Promise<PlanFormState> {
  const t = await getT();
  const id = form.get("id");
  const monthly = Number(form.get("monthly"));
  if (!Number.isInteger(monthly) || monthly < 0 || monthly > MAX_MONTHLY) return failed(t("That amount didn't come through. Try again."));
  return changeGoals(
    form,
    (goals) => {
      const i = goals.findIndex((g) => g.id === id);
      if (i < 0) return { error: t("That goal isn't here any more.") };
      goals[i] = { ...goals[i]!, monthlyContribution: monthly };
      const name = goals[i]!.name;
      return { goals, message: () => t("“{name}” now plans on this monthly amount.", { name }) };
    },
    t,
  );
}
