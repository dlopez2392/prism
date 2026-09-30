// src/lib/crypto/address.ts
//
// Whether a public address is one a network would accept, checked in full
// before it's kept or sent anywhere: a typo is caught here, not by a balance
// service. Server-only (it hashes with node:crypto).
//
//   Bitcoin  — legacy base58check (P2PKH "1…", P2SH "3…", double SHA-256
//              checksum) and native segwit: bech32 for version 0 (BIP 173),
//              bech32m for version 1 and up, Taproot "bc1p…" (BIP 350).
//              Mainnet only.
//   Ethereum — 0x and 40 hex digits, kept lowercase (the mixed-case checksum
//              of EIP-55 needs keccak, and lowercase is the same address).
//   Solana   — a base58 public key of exactly 32 bytes.

import { createHash } from "node:crypto";
import type { Chain } from "./wallets";

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Base58 to bytes, or null for a character outside the alphabet. Leading "1"s are leading zero bytes. */
export function base58Decode(s: string): Uint8Array | null {
  let n = BigInt(0);
  for (const ch of s) {
    const i = BASE58.indexOf(ch);
    if (i < 0) return null;
    n = n * BigInt(58) + BigInt(i);
  }
  const bytes: number[] = [];
  while (n > BigInt(0)) {
    bytes.unshift(Number(n % BigInt(256)));
    n /= BigInt(256);
  }
  for (const ch of s) {
    if (ch !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest();

function bitcoinLegacy(s: string): boolean {
  if (!/^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(s)) return false;
  const b = base58Decode(s);
  if (!b || b.length !== 25 || (b[0] !== 0x00 && b[0] !== 0x05)) return false;
  const check = sha256(sha256(b.subarray(0, 21)));
  return b.subarray(21).every((x, i) => x === check[i]);
}

const BECH32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32_CONST = 1;
const BECH32M_CONST = 0x2bc830a3;

function polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i]!;
  }
  return chk >>> 0;
}

function convertBits(data: number[], from: number, to: number): number[] | null {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  const max = (1 << to) - 1;
  const keep = (1 << (from + to - 1)) - 1;
  for (const v of data) {
    acc = ((acc << from) | v) & keep;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >> bits) & max);
    }
  }
  // No padding may carry data, and there may be no more than 4 bits of it.
  if (bits >= from || ((acc << (to - bits)) & max) !== 0) return null;
  return out;
}

function bitcoinSegwit(input: string): boolean {
  // One case throughout: lower for storing, upper is allowed (QR codes).
  if (input !== input.toLowerCase() && input !== input.toUpperCase()) return false;
  const s = input.toLowerCase();
  if (s.length < 14 || s.length > 90 || !s.startsWith("bc1")) return false;
  const data: number[] = [];
  for (const ch of s.slice(3)) {
    const v = BECH32.indexOf(ch);
    if (v < 0) return false;
    data.push(v);
  }
  if (data.length < 7) return false;
  const hrp = [..."bc"].map((c) => c.charCodeAt(0));
  const check = polymod([...hrp.map((c) => c >> 5), 0, ...hrp.map((c) => c & 31), ...data]);
  const version = data[0]!;
  if (version > 16) return false;
  // Version 0 is bech32; every later version is bech32m (BIP 350).
  if (check !== (version === 0 ? BECH32_CONST : BECH32M_CONST)) return false;
  const program = convertBits(data.slice(1, -6), 5, 8);
  if (!program || program.length < 2 || program.length > 40) return false;
  if (version === 0) return program.length === 20 || program.length === 32;
  if (version === 1) return program.length === 32;
  return true;
}

/** The address as Prism keeps it, or null when no network would accept it. */
export function normalizeAddress(chain: Chain, raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  switch (chain) {
    case "bitcoin":
      if (bitcoinLegacy(s)) return s;
      return bitcoinSegwit(s) ? s.toLowerCase() : null;
    case "ethereum": {
      if (!/^0x[0-9a-fA-F]{40}$/.test(s)) return null;
      const lower = s.toLowerCase();
      return /^0x0{40}$/.test(lower) ? null : lower;
    }
    case "solana": {
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)) return null;
      return base58Decode(s)?.length === 32 ? s : null;
    }
  }
}
