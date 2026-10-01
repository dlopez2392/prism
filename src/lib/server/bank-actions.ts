"use server";

// src/lib/server/bank-actions.ts
//
// The Server Action behind a finished "Sign in again": the person went
// through Plaid's update mode for one of their banks, so whatever Plaid
// warned about it (a sign-in, a consent running out, access withdrawn) is
// over. Only the owner's own row can be touched (row-level security), a
// connected app can't write at all, and the bank is marked as news so the
// next page reads it afresh. Next checks the action's Origin (CSRF).

import { currentAccount } from "@/lib/supabase/server";
import { clearBankAttention } from "./account-store";

export async function bankSignedInAgain(itemId: string): Promise<void> {
  if (typeof itemId !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(itemId)) return;
  const account = await currentAccount();
  if (!account) return;
  try {
    await clearBankAttention(account, itemId, { news: true });
  } catch {
    // The next visit's sync clears a sign-in anyway; a consent warning waits for the next try.
  }
}
