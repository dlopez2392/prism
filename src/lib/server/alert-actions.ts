"use server";

// src/lib/server/alert-actions.ts
//
// Turning alert emails on or off, and choosing what they cover (Account
// page). Nothing from the browser is trusted: every choice is read again and
// must be one Prism offers. Turning them off also deletes what the job kept
// for the person (a database trigger), at once.

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { isAlertChoice } from "@/lib/alerts/choices";
import { alertsConfig } from "@/lib/alerts/send";
import { BRAND } from "@/lib/brand";
import type { PlanFormState } from "@/lib/finance/plan";
import { currentAccount } from "@/lib/supabase/server";
import { saveAlertSettings } from "./account-store";

export async function saveAlertEmails(_prev: PlanFormState, form: FormData): Promise<PlanFormState> {
  const account = await currentAccount();
  if (!account) redirect("/sign-in?next=/account");
  if (!alertsConfig()) return { status: "error", message: "Alert emails aren't available yet." };
  const on = form.get("on") === "on";
  const kinds = [...new Set(form.getAll("kinds").filter(isAlertChoice))];
  const amounts = form.get("amounts") === "on";
  if (on && kinds.length === 0) {
    const message = "Choose at least one kind of alert, or turn the emails off.";
    return { status: "error", message, fields: { kinds: message } };
  }
  try {
    // Off saves only that: the kinds and amounts stay as chosen for when they're turned back on.
    await saveAlertSettings(account, on ? { on, kinds, amounts } : { on });
  } catch {
    return { status: "error", message: "We couldn't save that just now. Try again in a minute." };
  }
  refresh();
  return {
    status: "saved",
    message: on ? `Saved. ${BRAND.product} emails you the morning there's news.` : `Saved. ${BRAND.product} won't email you alerts.`,
    at: Date.now(),
  };
}
