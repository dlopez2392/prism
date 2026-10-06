"use server";

// src/lib/server/connected-apps-actions.ts
//
// The person's two decisions about connected apps: allow or refuse one that
// asks (the consent screen), and cut one off later (the Account page). Both
// act AS the signed-in person, through Supabase's OAuth server; Next checks
// each action's Origin, so another site can't press these buttons.

import { pricingFor } from "@/lib/billing/plans";
import { plusFor } from "@/lib/billing/plus";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { getT } from "@/lib/i18n/server";
import { currentAccount } from "@/lib/supabase/server";

/** Supabase's authorization ids and client ids: opaque, URL-safe. */
const OPAQUE_ID = /^[A-Za-z0-9._~-]{1,256}$/;

export async function decideConnection(form: FormData): Promise<void> {
  const id = String(form.get("authorization_id") ?? "");
  if (!OPAQUE_ID.test(id)) redirect("/account#ai");
  const account = await currentAccount();
  if (!account) redirect(`/sign-in?next=${encodeURIComponent(`/oauth/consent?authorization_id=${id}`)}`);
  const oauth = account.supabase.auth.oauth;
  // Connecting Claude or ChatGPT is part of Prism Plus: the consent page offers it, and this holds it.
  if (form.get("decision") === "allow" && !(await plusFor(account)).plus) redirect(pricingFor("apps"));
  const { data, error } =
    form.get("decision") === "allow" ? await oauth.approveAuthorization(id, { skipBrowserRedirect: true }) : await oauth.denyAuthorization(id, { skipBrowserRedirect: true });
  if (error || !data?.redirect_url) redirect(`/oauth/consent?authorization_id=${encodeURIComponent(id)}&problem=1`);
  // Back to the app that asked, carrying its code — or its "access denied".
  redirect(data.redirect_url);
}

export type DisconnectState = { status: "idle" } | { status: "done" | "error"; message: string };

export async function disconnectApp(_prev: DisconnectState, form: FormData): Promise<DisconnectState> {
  const t = await getT();
  const account = await currentAccount();
  if (!account) redirect("/sign-in");
  const clientId = String(form.get("client_id") ?? "");
  const name = String(form.get("name") ?? t("The app")).slice(0, 80);
  if (!OPAQUE_ID.test(clientId)) return { status: "error", message: t("We couldn't tell which app to disconnect.") };
  const { error } = await account.supabase.auth.oauth.revokeGrant({ clientId });
  if (error) return { status: "error", message: t("We couldn't disconnect {name} just now. Try again in a minute.", { name }) };
  refresh();
  return { status: "done", message: t("{name} is disconnected and can't read anything now.", { name }) };
}
