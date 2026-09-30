// src/lib/crypto/xpub.ts
//
// A whole Bitcoin wallet from its extended PUBLIC key: every address the
// wallet has used or will use, worked out here, on Prism's server. The key
// itself is never sent anywhere; the balance service (balances.ts) is asked
// about one address at a time. An extended public key can't spend, but it
// shows everything a wallet has ever held, so it is sealed like an address.
//
// Accepted: xpub, ypub (nested SegWit, "3…") and zpub (native SegWit,
// "bc1q…"), mainnet and single-signature only, and the output descriptors
// wallets such as Sparrow and Bitcoin Core export: pkh(), sh(wpkh()), wpkh()
// and tr() around one such key, with an optional key origin and a /0/* or
// /<0;1>/* suffix. Every key is kept in one canonical form (xpub version
// bytes) with the scripts it pays to, so the same wallet can't be added
// twice under two prefixes. A bare "xpub" doesn't say which kind of address
// the wallet uses; that is found from its history (balances.ts).
//
// Addresses follow BIP 44/49/84/86: receiving m/…/0/i and change m/…/1/i
// below the given key. The curve arithmetic is @scure/bip32 and
// @noble/curves (audited, no dependencies of their own), never hand-rolled.

import { HDKey } from "@scure/bip32";
import { bech32, bech32m, createBase58check } from "@scure/base";
import { schnorr } from "@noble/curves/secp256k1.js";
import { ripemd160 } from "@noble/hashes/legacy.js";
import { sha256 } from "@noble/hashes/sha2.js";
import type { Script } from "./wallets";

export type { Script };

/** A wallet key as kept: canonical xpub, and the scripts it pays to ([] until its history says). */
export type WalletKey = { key: string; scripts: Script[] };
export type WalletKeyProblem = "private" | "testnet" | "multisig" | "invalid";

const b58c = createBase58check(sha256);

// SLIP-132 version bytes. Public single-signature mainnet keys are accepted; everything else is named.
const VERSIONS = new Map<number, Script[] | WalletKeyProblem>([
  [0x0488b21e, []], // xpub: legacy or Taproot, found from its history
  [0x049d7cb2, ["p2sh-p2wpkh"]], // ypub
  [0x04b24746, ["p2wpkh"]], // zpub
  [0x0295b43f, "multisig"], // Ypub
  [0x02aa7ed3, "multisig"], // Zpub
  [0x043587cf, "testnet"], // tpub
  [0x044a5262, "testnet"], // upub
  [0x045f1cf6, "testnet"], // vpub
  [0x024289ef, "testnet"], // Upub
  [0x02575483, "testnet"], // Vpub
  [0x0488ade4, "private"], // xprv
  [0x049d7878, "private"], // yprv
  [0x04b2430c, "private"], // zprv
  [0x0295b005, "private"], // Yprv
  [0x02aa7a99, "private"], // Zprv
  [0x04358394, "private"], // tprv
  [0x044a4e28, "private"], // uprv
  [0x045f18bc, "private"], // vprv
  [0x024285b5, "private"], // Uprv
  [0x02575048, "private"], // Vprv
]);

/** Something that should be read as a wallet key or descriptor rather than an address. */
export function looksLikeWalletKey(x: unknown): boolean {
  if (typeof x !== "string") return false;
  const s = x.replace(/\s+/g, "");
  return /^[xyztuvXYZTUV](pub|prv)/.test(s) || /^(pkh|wpkh|tr|sh)\(/.test(s);
}

function decodeKey(s: string): WalletKey | { problem: WalletKeyProblem } {
  let raw: Uint8Array;
  try {
    raw = b58c.decode(s);
  } catch {
    return { problem: "invalid" };
  }
  if (raw.length !== 78) return { problem: "invalid" };
  const version = ((raw[0]! << 24) | (raw[1]! << 16) | (raw[2]! << 8) | raw[3]!) >>> 0;
  const kind = VERSIONS.get(version);
  if (kind === undefined) return { problem: "invalid" };
  if (!Array.isArray(kind)) return { problem: kind };
  // A public key's data starts 02 or 03; anything else (00 is a private key's) isn't a public key.
  if (raw[45] !== 0x02 && raw[45] !== 0x03) return { problem: "invalid" };
  const canonical = new Uint8Array(raw);
  canonical.set([0x04, 0x88, 0xb2, 0x1e], 0);
  const key = b58c.encode(canonical);
  try {
    // Checks the point is on the curve.
    HDKey.fromExtendedKey(key);
  } catch {
    return { problem: "invalid" };
  }
  return { key, scripts: [...kind] };
}

const DESCRIPTOR_KEY = String.raw`(?:\[[0-9a-fA-F]{8}(?:/\d+['hH]?)*\])?([1-9A-HJ-NP-Za-km-z]{100,120})(?:/0/\*|/<0;1>/\*)?`;
const DESCRIPTORS: [RegExp, Script][] = [
  [new RegExp(`^pkh\\(${DESCRIPTOR_KEY}\\)$`), "p2pkh"],
  [new RegExp(`^sh\\(wpkh\\(${DESCRIPTOR_KEY}\\)\\)$`), "p2sh-p2wpkh"],
  [new RegExp(`^wpkh\\(${DESCRIPTOR_KEY}\\)$`), "p2wpkh"],
  [new RegExp(`^tr\\(${DESCRIPTOR_KEY}\\)$`), "p2tr"],
];

/** A wallet's extended public key or descriptor, checked in full: the canonical key and its scripts, or what's wrong with it. */
export function parseWalletKey(raw: unknown): WalletKey | { problem: WalletKeyProblem } {
  if (typeof raw !== "string") return { problem: "invalid" };
  // Keys and descriptors never contain spaces; a pasted one may have wrapped.
  const s = raw.replace(/\s+/g, "");
  // A private key, bare or inside a descriptor (where a key follows "(" or a "]" origin). Never matched mid-key.
  if (/(^|[(\]])[xyztuvXYZTUV]prv/.test(s)) return { problem: "private" };
  if (s.length > 400) return { problem: "invalid" };
  if (/^(pkh|wpkh|tr|sh)\(/.test(s)) {
    // The checksum after "#" guards against typos; the key's own checksum below does the same job.
    const body = s.replace(/#[a-z0-9]{8}$/, "");
    for (const [pattern, script] of DESCRIPTORS) {
      const m = pattern.exec(body);
      if (!m) continue;
      const decoded = decodeKey(m[1]!);
      return "problem" in decoded ? decoded : { key: decoded.key, scripts: [script] };
    }
    return { problem: "invalid" };
  }
  return decodeKey(s);
}

const hash160 = (b: Uint8Array) => ripemd160(sha256(b));
const toBig = (b: Uint8Array) => b.reduce((n, x) => (n << BigInt(8)) | BigInt(x), BigInt(0));
const bytes = (...parts: (Uint8Array | number[])[]) => Uint8Array.from(parts.flatMap((p) => Array.from(p)));

function addressOf(script: Script, publicKey: Uint8Array): string {
  switch (script) {
    case "p2pkh":
      return b58c.encode(bytes([0x00], hash160(publicKey)));
    case "p2sh-p2wpkh":
      return b58c.encode(bytes([0x05], hash160(bytes([0x00, 0x14], hash160(publicKey)))));
    case "p2wpkh":
      return bech32.encode("bc", [0, ...bech32.toWords(hash160(publicKey))]);
    case "p2tr": {
      // BIP 86: the key itself, tweaked with no script tree. Q = lift_x(P) + int(TapTweak(P))·G.
      const x = publicKey.slice(1);
      const internal = schnorr.utils.lift_x(toBig(x));
      const t = toBig(schnorr.utils.taggedHash("TapTweak", x));
      const output = internal.add(schnorr.Point.BASE.multiply(t));
      return bech32m.encode("bc", [1, ...bech32m.toWords(schnorr.utils.pointToBytes(output))]);
    }
  }
}

/** The wallet's addresses, one at a time: receiving (change 0) and change (1), index i, for one script. */
export function walletAddresses(key: string): (script: Script, change: 0 | 1, index: number) => string {
  const root = HDKey.fromExtendedKey(key);
  const chains = [root.deriveChild(0), root.deriveChild(1)] as const;
  const keys = new Map<string, Uint8Array>();
  return (script, change, index) => {
    const id = `${change}/${index}`;
    let pub = keys.get(id);
    if (!pub) {
      pub = chains[change].deriveChild(index).publicKey!;
      keys.set(id, pub);
    }
    return addressOf(script, pub);
  };
}
