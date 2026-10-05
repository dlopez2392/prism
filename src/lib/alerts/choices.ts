// src/lib/alerts/choices.ts
//
// What a person can ask to be emailed about (profiles.alert_kinds), in the
// words the Account page uses. Kept apart from plan.ts so the page's form can
// import it without the job's code. The labels are translated where they're
// shown (msg, lib/i18n/t.ts).

import { msg } from "@/lib/i18n/t";

export const ALERT_CHOICES = ["bank", "bill-short", "price-rise", "weekly"] as const;
export type AlertChoice = (typeof ALERT_CHOICES)[number];
export const isAlertChoice = (x: unknown): x is AlertChoice => ALERT_CHOICES.includes(x as AlertChoice);

export const ALERT_CHOICE_LABELS: Record<AlertChoice, { label: string; hint: string }> = {
  bank: { label: msg("A bank needs you"), hint: msg("It needs you to sign in again, or will stop updating soon.") },
  "bill-short": { label: msg("A bill may not be covered"), hint: msg("Due before your next paycheck, with not enough in the account it comes out of.") },
  "price-rise": { label: msg("A subscription went up"), hint: msg("A recurring charge came in higher than the one before.") },
  weekly: {
    label: msg("Summaries"),
    hint: msg("On Mondays, last week's spending, your budgets so far and the bills coming up. Early each month, the month before in a few lines."),
  },
};
