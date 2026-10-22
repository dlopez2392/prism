"use server";

// src/lib/server/setup-actions.ts — Hide on Getting started (finance/setup.ts): a cookie on this device
// that Overview reads, set by the server so the page is drawn again without the card at once.
// Next checks the action's Origin against the host (CSRF).

import { refresh } from "next/cache";
import { cookies } from "next/headers";
import { SETUP_COOKIE } from "@/lib/finance/setup";

export async function hideSetup(): Promise<void> {
  (await cookies()).set(SETUP_COOKIE, "hidden", { path: "/", maxAge: 31_536_000, sameSite: "lax" });
  refresh();
}
