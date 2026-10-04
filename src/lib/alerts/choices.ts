// src/lib/alerts/choices.ts
//
// What a person can ask to be emailed about (profiles.alert_kinds), in the
// words the Account page uses. Kept apart from plan.ts so the page's form can
// import it without the job's code.

export const ALERT_CHOICES = ["bank", "bill-short", "price-rise", "weekly"] as const;
export type AlertChoice = (typeof ALERT_CHOICES)[number];
export const isAlertChoice = (x: unknown): x is AlertChoice => ALERT_CHOICES.includes(x as AlertChoice);

export const ALERT_CHOICE_LABELS: Record<AlertChoice, { label: string; hint: string }> = {
  bank: { label: "A bank needs you", hint: "It needs you to sign in again, or will stop updating soon." },
  "bill-short": { label: "A bill may not be covered", hint: "Due before your next paycheck, with not enough in the account it comes out of." },
  "price-rise": { label: "A subscription went up", hint: "A recurring charge came in higher than the one before." },
  weekly: { label: "Summaries", hint: "On Mondays, last week's spending, your budgets so far and the bills coming up. Early each month, the month before in a few lines." },
};
