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
//
// A Bitcoin wallet can be added whole, by its extended public key or a
// descriptor (xpub.ts), and is read in full before the reply. Anything that
// can spend (a private key, a recovery phrase) is refused here as well as in
// the browser, and never kept, logged or repeated back.

import { randomBytes } from "node:crypto";
import { refresh } from "next/cache";
import { normalizeAddress } from "@/lib/crypto/address";
import { chainEnabled } from "@/lib/crypto/balances";
import { secretKind, secretWarning } from "@/lib/crypto/secrets";
import { CHAINS, cleanWalletName, isChain, isWholeWallet, MAX_WALLETS, walletMoney, type Wallet } from "@/lib/crypto/wallets";
import { looksLikeWalletKey, parseWalletKey, type WalletKeyProblem } from "@/lib/crypto/xpub";
import { money0 } from "@/lib/finance/format";
import type { PlanFormState } from "@/lib/finance/plan";
import { getT } from "@/lib/i18n/server";
import { msg, type T } from "@/lib/i18n/t";
import { currentAccount, type Account } from "@/lib/supabase/server";
import { loadAccountWallets, saveAccountWallets } from "./account-store";
import { vaultKey, type VaultKey } from "./vault";
import { readWallets, readWholeWallets } from "./wallets";

const failed = (message: string, fields?: Record<string, string>): PlanFormState => ({ status: "error", message, fields });

const NOT_BITCOIN = msg("That isn't a Bitcoin address or extended public key. Copy it from your wallet app and paste it again.");
/** Why a wallet key was refused, in English: shown with t(). A private key gets secrets.ts's own warning instead. */
const KEY_PROBLEMS: Record<Exclude<WalletKeyProblem, "private">, string> = {
  testnet: msg("That key is for Bitcoin's test network. Prism reads real bitcoin only."),
  multisig: msg("That's a multi-signature wallet's key. Prism reads single-signature wallets only, for now."),
  invalid: NOT_BITCOIN,
};

async function owner(t: T): Promise<{ account: Account; key: VaultKey } | PlanFormState> {
  const account = await currentAccount();
  if (!account) return failed(t("Sign in to add a wallet. It's kept in your account."));
  let key: VaultKey | null = null;
  try {
    key = vaultKey();
  } catch {
    key = null;
  }
  if (!key) return failed(t("Prism can't save that right now. Try again later."));
  return { account, key };
}

export async function addWallet(_prev: PlanFormState, form: FormData): Promise<PlanFormState> {
  const t = await getT();
  const who = await owner(t);
  if ("status" in who) return who;
  const chain = form.get("chain");
  if (!isChain(chain)) return failed(t("Pick the wallet's network."), { chain: t("Pick the wallet's network.") });
  const network = CHAINS[chain].label;
  if (!chainEnabled(chain)) return failed(t("{network} wallets aren't switched on yet.", { network }), { chain: t("Not switched on yet.") });
  const raw = form.get("address");
  const secret = secretKind(raw);
  if (secret) return failed(t("Check the highlighted fields."), { address: secretWarning(secret, true, t) });
  const whole = chain === "bitcoin" && looksLikeWalletKey(raw);
  let address: string | null;
  let scripts: Wallet["scripts"];
  if (whole) {
    const parsed = parseWalletKey(raw);
    if ("problem" in parsed)
      return failed(t("Check the highlighted fields."), { address: parsed.problem === "private" ? secretWarning("private-key", true, t) : t(KEY_PROBLEMS[parsed.problem]) });
    ({ key: address, scripts } = parsed);
  } else {
    address = normalizeAddress(chain, raw);
  }
  if (!address)
    return failed(t("Check the highlighted fields."), {
      address: chain === "bitcoin" ? t(NOT_BITCOIN) : t("That isn't a {network} address. Copy it from your wallet app and paste it again.", { network }),
    });
  const typed = form.get("name");
  const name = typeof typed === "string" && typed.trim() === "" ? t("{network} wallet", { network }) : cleanWalletName(typed);
  if (!name) return failed(t("Check the highlighted fields."), { name: t("Give it a name, up to 40 characters.") });

  let wallets: Wallet[];
  try {
    wallets = await loadAccountWallets(who.account, who.key);
  } catch {
    return failed(t("That didn't save. Try again in a moment."));
  }
  if (wallets.some((w) => w.chain === chain && w.address === address)) return failed(t("That wallet is already in Prism."), { address: t("Already added.") });
  if (wallets.length >= MAX_WALLETS) return failed(t("You can add up to {n} wallets. Remove one first.", { n: MAX_WALLETS }));

  const added: Wallet = { id: randomBytes(6).toString("hex"), chain, address, name, reading: null, ...(whole ? { scripts } : {}) };
  let read: Wallet;
  if (whole) {
    const { fresh, tooLarge } = await readWholeWallets([added]);
    if (tooLarge.has(added.id))
      return failed(t("That wallet has more addresses than Prism reads (over 500 on a side). Add the addresses you use most, one at a time, instead."));
    const r = fresh.get(added.id);
    read = r ? { ...added, reading: r.reading, scripts: r.scripts } : added;
  } else {
    [read] = (await readWallets([added])).wallets as [Wallet];
  }
  try {
    await saveAccountWallets(who.account, [...wallets, read], who.key);
  } catch {
    return failed(t("That didn't save. Try again in a moment."));
  }
  refresh();
  const saved = (message: string): PlanFormState => ({ status: "saved", message, at: Date.now() });
  if (!read.reading)
    return saved(
      whole
        ? t("{name} added. Prism couldn't read all of its addresses just now, and tries again in a few minutes.", { name })
        : t("{name} added. Prism couldn't read its balance just now, and tries again on your next visit.", { name }),
    );
  const amount = money0(walletMoney(read).account.balance);
  if (!whole) return saved(t("{name} added: {amount} today.", { name, amount }));
  const used = read.reading.addresses ?? 0;
  if (used === 0) return saved(t("{name} added. It hasn't been used yet, so it counts $0 until bitcoin arrives.", { name }));
  return saved(used === 1 ? t("{name} added: {amount} today, across 1 address.", { name, amount }) : t("{name} added: {amount} today, across {n} addresses.", { name, amount, n: used }));
}

export async function removeWallet(_prev: PlanFormState, form: FormData): Promise<PlanFormState> {
  const t = await getT();
  const who = await owner(t);
  if ("status" in who) return who;
  const id = form.get("id");
  let wallets: Wallet[];
  try {
    wallets = await loadAccountWallets(who.account, who.key);
  } catch {
    return failed(t("That didn't remove. Try again in a moment."));
  }
  const gone = wallets.find((w) => w.id === id);
  if (!gone) return failed(t("That wallet isn't there any more."));
  try {
    await saveAccountWallets(
      who.account,
      wallets.filter((w) => w.id !== gone.id),
      who.key,
    );
  } catch {
    return failed(t("That didn't remove. Try again in a moment."));
  }
  refresh();
  const message = isWholeWallet(gone)
    ? t("{name} removed. Its key is gone from your account.", { name: gone.name })
    : t("{name} removed. Its address is gone from your account.", { name: gone.name });
  return { status: "saved", message, at: Date.now() };
}
