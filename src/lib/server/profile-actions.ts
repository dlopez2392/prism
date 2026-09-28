"use server";

// src/lib/server/profile-actions.ts
//
// Saving the name Prism greets a signed-in person by. A device-only visit
// has no profile to keep one in. Nothing from the browser is trusted: the
// name is re-read and must pass as a name before it is written.

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import type { PlanFormState } from "@/lib/finance/plan";
import { readFirstName } from "@/lib/profile";
import { currentAccount } from "@/lib/supabase/server";
import { saveAccountFirstName } from "./account-store";

export async function saveFirstName(_prev: PlanFormState, form: FormData): Promise<PlanFormState> {
  const account = await currentAccount();
  if (!account) redirect("/sign-in");
  const read = readFirstName(form.get("firstName"));
  if (!read.ok) return { status: "error", message: read.error, fields: { firstName: read.error } };
  try {
    await saveAccountFirstName(account, read.name);
  } catch {
    return { status: "error", message: "We couldn't save your name just now. Try again in a minute." };
  }
  // The welcome step is done once answered: on to the overview, greeting and all.
  if (form.get("next") === "welcome") redirect("/");
  refresh();
  return { status: "saved", message: read.name ? `Saved. Prism will greet you as ${read.name}.` : "Removed. Prism will greet you without a name.", at: Date.now() };
}
