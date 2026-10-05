// src/lib/crypto/secrets.ts
//
// What must never be typed into Prism: anything that can spend. A wallet is
// added by what it shows (an address, or a Bitcoin wallet's extended PUBLIC
// key); a private key, an extended private key or a recovery phrase moves the
// coins, so it is refused in the browser before it is sent, and again on the
// server should the browser not have checked. It is never kept, logged or
// repeated back.
//
// Pure, and small enough for the browser bundle: shapes only, no crypto.

import { EN, type T } from "@/lib/i18n/t";

export type SecretKind = "private-key" | "recovery-phrase";

const BASE58 = "[1-9A-HJ-NP-Za-km-z]";

/** Which kind of secret `x` looks like, or null when it looks like something a person may share. */
export function secretKind(x: unknown): SecretKind | null {
  if (typeof x !== "string") return null;
  const s = x.trim();
  // An extended PRIVATE key, bare or inside a descriptor: xprv, yprv, zprv, their multisig and test-network kin.
  if (new RegExp(`(^|[(\\]])[xyztuvXYZTUV]prv${BASE58}{100,}`).test(s)) return "private-key";
  // Bitcoin's wallet import format: "5…" (51 characters) or "K…"/"L…" (52), and the test network's "9…"/"c…".
  if (new RegExp(`^[5KL9c]${BASE58}{50,51}$`).test(s)) return "private-key";
  // A raw 32-byte key in hex (an Ethereum private key; an address is only 20 bytes).
  if (/^(0x)?[0-9a-fA-F]{64}$/.test(s)) return "private-key";
  // A Solana secret key: 64 bytes, in base58 (a public key is 32) or as the JSON byte array wallet files hold.
  if (new RegExp(`^${BASE58}{85,90}$`).test(s)) return "private-key";
  if (/^\[\s*\d{1,3}(\s*,\s*\d{1,3}){31,63}\s*\]$/.test(s)) return "private-key";
  // A recovery phrase: twelve or more plain words.
  const words = s.split(/\s+/);
  if (words.length >= 12 && words.every((w) => /^[a-zA-Z]+$/.test(w))) return "recovery-phrase";
  return null;
}

/** What to tell the person. `sent` is false when the browser stopped it, true when it reached the server. */
export function secretWarning(kind: SecretKind, sent: boolean, t: T = EN): string {
  if (kind === "recovery-phrase") {
    return sent
      ? t("That looks like a recovery phrase. Prism didn't keep it. Anyone who has it can take your coins, so never type it into a website or app. Prism only ever needs a public address.")
      : t("That looks like a recovery phrase. It wasn't sent anywhere. Anyone who has it can take your coins, so never type it into a website or app. Prism only ever needs a public address.");
  }
  return sent
    ? t("That's a private key, which can spend your coins. Prism didn't keep it. Never type it into a website or app. Prism only ever needs a public address, or for Bitcoin an extended public key (xpub, ypub or zpub).")
    : t("That's a private key, which can spend your coins. It wasn't sent anywhere. Never type it into a website or app. Prism only ever needs a public address, or for Bitcoin an extended public key (xpub, ypub or zpub).");
}
