"use server";

// src/lib/server/wallet-actions.ts
//
// The Server Actions behind "Add a wallet" on Connections: a self-custody
// crypto wallet, by its public address, which Prism can read and never move.
// Signed-in only (the address is kept sealed in the account), and nothing from
// the browser is trusted: the network, the address (in full, checksum and
// all, address.ts) and the name are each checked here. The balance is read
// straight away so the person sees it; an address that can't be read yet is
// still kept, since a new wallet may simply never have been used. Next checks
// each action's Origin against the host (CSRF).

import { randomBytes } from "node:crypto";
import { refresh } from "next/cache";
import { normalizeAddress } from "@/lib/crypto/address";
import { chainEnabled } from "@/lib/crypto/balances";
import { CHAINS, cleanWalletName, isChain, MAX_WALLETS, walletMoney, type Wallet } from "@/lib/crypto/wallets";
import { money0 } from "@/lib/finance/format";
import type { PlanFormState } from "@/lib/finance/plan";
import { currentAccount, type Account } from "@/lib/supabase/server";
import { loadAccountWallets, saveAccountWallets } from "./account-store";
import { vaultKey, type VaultKey } from "./vault";
import { readWallets } from "./wallets";

const failed = (message: string, fields?: Record<string, string>): PlanFormState => ({ status: "error", message, fields });

async function owner(): Promise<{ account: Account; key: VaultKey } | PlanFormState> {
  const account = await currentAccount();
  if (!account) return failed("Sign in to add a wallet. It's kept in your account.");
  let key: VaultKey | null = null;
  try {
    key = vaultKey();
  } catch {
    key = null;
  }
  if (!key) return failed("Prism can't save that right now. Try again later.");
  return { account, key };
}

export async function addWallet(_prev: PlanFormState, form: FormData): Promise<PlanFormState> {
  const who = await owner();
  if ("status" in who) return who;
  const chain = form.get("chain");
  if (!isChain(chain)) return failed("Pick the wallet's network.", { chain: "Pick the wallet's network." });
  if (!chainEnabled(chain)) return failed(`${CHAINS[chain].label} wallets aren't switched on yet.`, { chain: "Not switched on yet." });
  const address = normalizeAddress(chain, form.get("address"));
  if (!address) return failed("Check the highlighted fields.", { address: `That isn't a ${CHAINS[chain].label} address. Copy it from your wallet app and paste it again.` });
  const typed = form.get("name");
  const name = typeof typed === "string" && typed.trim() === "" ? `${CHAINS[chain].label} wallet` : cleanWalletName(typed);
  if (!name) return failed("Check the highlighted fields.", { name: "Give it a name, up to 40 characters." });

  let wallets: Wallet[];
  try {
    wallets = await loadAccountWallets(who.account, who.key);
  } catch {
    return failed("That didn't save. Try again in a moment.");
  }
  if (wallets.some((w) => w.chain === chain && w.address === address)) return failed("That wallet is already in Prism.", { address: "Already added." });
  if (wallets.length >= MAX_WALLETS) return failed(`You can add up to ${MAX_WALLETS} wallets. Remove one first.`);

  const added: Wallet = { id: randomBytes(6).toString("hex"), chain, address, name, reading: null };
  const [read] = (await readWallets([added])).wallets;
  try {
    await saveAccountWallets(who.account, [...wallets, read!], who.key);
  } catch {
    return failed("That didn't save. Try again in a moment.");
  }
  refresh();
  if (!read!.reading) return { status: "saved", message: `${name} added. Prism couldn't read its balance just now, and tries again on your next visit.`, at: Date.now() };
  return { status: "saved", message: `${name} added: ${money0(walletMoney(read!).account.balance)} today.`, at: Date.now() };
}

export async function removeWallet(_prev: PlanFormState, form: FormData): Promise<PlanFormState> {
  const who = await owner();
  if ("status" in who) return who;
  const id = form.get("id");
  let wallets: Wallet[];
  try {
    wallets = await loadAccountWallets(who.account, who.key);
  } catch {
    return failed("That didn't remove. Try again in a moment.");
  }
  const gone = wallets.find((w) => w.id === id);
  if (!gone) return failed("That wallet isn't there any more.");
  try {
    await saveAccountWallets(
      who.account,
      wallets.filter((w) => w.id !== gone.id),
      who.key,
    );
  } catch {
    return failed("That didn't remove. Try again in a moment.");
  }
  refresh();
  return { status: "saved", message: `${gone.name} removed. Its address is gone from your account.`, at: Date.now() };
}
