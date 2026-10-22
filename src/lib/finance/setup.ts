// src/lib/finance/setup.ts
//
// Getting started: the few things that make Prism useful in the first week,
// and whether each is done, for the checklist on Overview. Four for everyone
// (a bank, budgets, alerts, the calendar), counted; and two that only apply to
// some (a business account, last year's return), listed but never counted,
// so nobody is told they're behind for not owning a business.
//
// Each step is done when the thing itself is, never because it was ticked:
// a bank linked, budgets set by hand, alert emails on, a calendar feed made,
// an account marked as business, a return saved.
//
// Pure: reads what the page already has.

import { msg } from "@/lib/i18n/t";

/** The cookie that keeps Getting started hidden on a device: a year. */
export const SETUP_COOKIE = "prism-setup";

export type SetupStep = {
  id: "bank" | "budgets" | "alerts" | "calendar" | "business" | "return";
  done: boolean;
  /** Counted toward getting started; the rest apply only to some. */
  core: boolean;
  title: string;
  detail: string;
  href: string;
};

export type SetupInput = {
  /** Anything of the person's own linked or imported: not the example household. */
  ownMoney: boolean;
  budgetsSet: boolean;
  /** Alert emails can be sent from this site at all, and whether theirs are on. */
  alertsAvailable: boolean;
  alertsOn: boolean;
  calendarFeed: boolean;
  businessAccounts: number;
  taxReturns: number;
};

/** The steps, the counted ones first, each with whether it's done. */
export function setupSteps(s: SetupInput): SetupStep[] {
  const steps: SetupStep[] = [
    {
      id: "bank",
      done: s.ownMoney,
      core: true,
      title: msg("Connect a bank"),
      detail: msg("Everything in Prism starts with your own accounts. Prism can read them and can never move money."),
      href: "/connections",
    },
    {
      id: "budgets",
      done: s.budgetsSet,
      core: true,
      title: msg("Set your budgets"),
      detail: msg("Prism drafts them from what you spend. Change any to what you want to spend."),
      href: "/budgets",
    },
    ...(s.alertsAvailable
      ? [
          {
            id: "alerts" as const,
            done: s.alertsOn,
            core: true,
            title: msg("Turn on alerts"),
            detail: msg("An email or a phone alert when a bill won't fit, a price goes up or a bank needs you."),
            href: "/account#alerts",
          },
        ]
      : []),
    {
      id: "calendar",
      done: s.calendarFeed,
      core: true,
      title: msg("Put your bills in your calendar"),
      detail: msg("Bills and paydays in the calendar on your phone, kept up to date."),
      href: "/future#next-30",
    },
    {
      id: "business",
      done: s.businessAccounts > 0,
      core: false,
      title: msg("Have a business account? Mark it"),
      detail: msg("It's kept out of your personal totals and sorted for Schedule C."),
      href: "/net-worth",
    },
    {
      id: "return",
      done: s.taxReturns > 0,
      core: false,
      title: msg("Add last year's tax return"),
      detail: msg("Its figures sit beside this year's on Taxes. The file never leaves your device."),
      href: "/taxes/return",
    },
  ];
  return steps;
}

/** Whether the checklist still has something to say: a counted step not done. */
export function setupOpen(steps: SetupStep[]): boolean {
  return steps.some((s) => s.core && !s.done);
}
