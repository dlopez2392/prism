// A whole wallet from its extended public key (xpub.ts): every kind of key
// and descriptor read to the same canonical key, the four kinds of address
// derived exactly, and anything private, test-network or multisig named.
//
// Vectors: the account keys of the test wallet every BIP uses (the phrase of
// eleven "abandon" and one "about"; it holds nothing). Native SegWit and
// Taproot are BIP 84's and BIP 86's own published vectors. Legacy and nested
// SegWit come from an independent reference written from the BIPs, which was
// first shown to reproduce BIP 84's and BIP 86's vectors exactly.

import { createBase58check } from "@scure/base";
import { sha256 } from "@noble/hashes/sha2.js";
import { describe, expect, it } from "vitest";
import { normalizeAddress } from "./address";
import { looksLikeWalletKey, parseWalletKey, walletAddresses, type Script, type WalletKey } from "./xpub";

const VECTORS: Record<Script, { key: string; receive: string[]; change: string }> = {
  p2pkh: {
    key: "xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj",
    receive: ["1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA", "1Ak8PffB2meyfYnbXZR9EGfLfFZVpzJvQP", "1MNF5RSaabFwcbtJirJwKnDytsXXEsVsNb"],
    change: "1J3J6EvPrv8q6AC3VCjWV45Uf3nssNMRtH",
  },
  "p2sh-p2wpkh": {
    key: "ypub6Ww3ibxVfGzLrAH1PNcjyAWenMTbbAosGNB6VvmSEgytSER9azLDWCxoJwW7Ke7icmizBMXrzBx9979FfaHxHcrArf3zbeJJJUZPf663zsP",
    receive: ["37VucYSaXLCAsxYyAPfbSi9eh4iEcbShgf", "3LtMnn87fqUeHBUG414p9CWwnoV6E2pNKS", "3B4cvWGR8X6Xs8nvTxVUoMJV77E4f7oaia"],
    change: "34K56kSjgUCUSD8GTtuF7c9Zzwokbs6uZ7",
  },
  // BIP 84.
  p2wpkh: {
    key: "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs",
    receive: ["bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu", "bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g", "bc1qp59yckz4ae5c4efgw2s5wfyvrz0ala7rgvuz8z"],
    change: "bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el",
  },
  // BIP 86.
  p2tr: {
    key: "xpub6BgBgsespWvERF3LHQu6CnqdvfEvtMcQjYrcRzx53QJjSxarj2afYWcLteoGVky7D3UKDP9QyrLprQ3VCECoY49yfdDEHGCtMMj92pReUsQ",
    receive: [
      "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr",
      "bc1p4qhjn9zdvkux4e44uhx8tc55attvtyu358kutcqkudyccelu0was9fqzwh",
      "bc1p0d0rhyynq0awa9m8cqrcr8f5nxqx3aw29w4ru5u9my3h0sfygnzs9khxz8",
    ],
    change: "bc1p3qkhfews2uk44qtvauqyr2ttdsw7svhkl9nkm9s9c3x4ax5h60wqwruhk7",
  },
};

const b58c = createBase58check(sha256);
/** The same key under other version bytes: how a tpub, a Zpub or an "xprv"-labelled key is made without real private material. */
function reversioned(key: string, version: number): string {
  const raw = new Uint8Array(b58c.decode(key));
  raw.set([(version >>> 24) & 255, (version >>> 16) & 255, (version >>> 8) & 255, version & 255], 0);
  return b58c.encode(raw);
}

const parsed = (x: unknown) => parseWalletKey(x) as WalletKey;

describe("deriving a wallet's addresses", () => {
  for (const [script, v] of Object.entries(VECTORS) as [Script, (typeof VECTORS)[Script]][]) {
    it(`derives ${script} receiving and change addresses exactly`, () => {
      const { key } = parsed(v.key);
      const at = walletAddresses(key);
      expect(v.receive.map((_, i) => at(script, 0, i))).toEqual(v.receive);
      expect(at(script, 1, 0)).toBe(v.change);
      // An independent decoder (address.ts) accepts every one, checksum and all.
      for (const a of [...v.receive, v.change]) expect(normalizeAddress("bitcoin", a)).toBe(a);
    });
  }

  it("gives different addresses for different scripts from one key", () => {
    const at = walletAddresses(parsed(VECTORS.p2wpkh.key).key);
    expect(new Set((["p2pkh", "p2sh-p2wpkh", "p2wpkh", "p2tr"] as Script[]).map((s) => at(s, 0, 0))).size).toBe(4);
  });
});

describe("reading a wallet key", () => {
  it("keeps every key in one canonical xpub form, with the scripts its prefix names", () => {
    const z = parsed(VECTORS.p2wpkh.key);
    expect(z.key).toMatch(/^xpub[1-9A-HJ-NP-Za-km-z]{107}$/);
    expect(z.scripts).toEqual(["p2wpkh"]);
    expect(parsed(VECTORS["p2sh-p2wpkh"].key).scripts).toEqual(["p2sh-p2wpkh"]);
    // A bare xpub doesn't say: its history will.
    expect(parsed(VECTORS.p2pkh.key)).toEqual({ key: VECTORS.p2pkh.key, scripts: [] });
    // The same wallet under two prefixes is one key.
    expect(parsed(reversioned(VECTORS.p2wpkh.key, 0x0488b21e)).key).toBe(z.key);
    // Pasted with a line break in it.
    expect(parsed(`${VECTORS.p2tr.key.slice(0, 50)}\n  ${VECTORS.p2tr.key.slice(50)}`).key).toBe(VECTORS.p2tr.key);
  });

  it("reads the output descriptors wallets export, which name the script", () => {
    const x = VECTORS.p2tr.key;
    expect(parsed(`tr([73c5da0a/86h/0h/0h]${x}/<0;1>/*)#abcd1234`)).toEqual({ key: x, scripts: ["p2tr"] });
    expect(parsed(`wpkh([73c5da0a/84'/0'/0']${x}/0/*)`)).toEqual({ key: x, scripts: ["p2wpkh"] });
    expect(parsed(`sh(wpkh(${x}))`)).toEqual({ key: x, scripts: ["p2sh-p2wpkh"] });
    expect(parsed(`pkh(${x}/0/*)`)).toEqual({ key: x, scripts: ["p2pkh"] });
    // A zpub inside a descriptor: the descriptor's script wins.
    expect(parsed(`tr(${VECTORS.p2wpkh.key})`).scripts).toEqual(["p2tr"]);
    // Scripts Prism doesn't read: a script tree, multisig, an unusual path.
    expect(parseWalletKey(`tr(${x},{pk(${x})})`)).toEqual({ problem: "invalid" });
    expect(parseWalletKey(`wsh(multi(2,${x},${x}))`)).toEqual({ problem: "invalid" });
    expect(parseWalletKey(`wpkh(${x}/7/*)`)).toEqual({ problem: "invalid" });
  });

  it("names a private key, a test-network key and a multisig key instead of reading them", () => {
    const x = VECTORS.p2pkh.key;
    expect(parseWalletKey(reversioned(x, 0x0488ade4))).toEqual({ problem: "private" }); // xprv
    expect(parseWalletKey(`wpkh([73c5da0a/84h/0h/0h]${reversioned(x, 0x04b2430c)}/0/*)`)).toEqual({ problem: "private" }); // zprv in a descriptor
    expect(parseWalletKey(reversioned(x, 0x043587cf))).toEqual({ problem: "testnet" }); // tpub
    expect(parseWalletKey(reversioned(x, 0x045f1cf6))).toEqual({ problem: "testnet" }); // vpub
    expect(parseWalletKey(reversioned(x, 0x02aa7ed3))).toEqual({ problem: "multisig" }); // Zpub
    // Even garbled or cut short, an extended private key is named as one, so the person hears the warning, not "not an address".
    const garbled = reversioned(x, 0x04b2430c).slice(0, 90);
    expect(parseWalletKey(garbled)).toEqual({ problem: "private" });
    expect(parseWalletKey(`wpkh(${garbled})`)).toEqual({ problem: "private" });
  });

  it("refuses a mistyped key, whatever the mistake", () => {
    const x = VECTORS.p2pkh.key;
    const typo = x.slice(0, 60) + (x[60] === "a" ? "b" : "a") + x.slice(61);
    expect(parseWalletKey(typo)).toEqual({ problem: "invalid" });
    expect(parseWalletKey(x.slice(0, -1))).toEqual({ problem: "invalid" });
    expect(parseWalletKey("")).toEqual({ problem: "invalid" });
    expect(parseWalletKey(42)).toEqual({ problem: "invalid" });
    // A random base58 string that happens to contain "prv" mid-key is not taken for a private key.
    expect(parseWalletKey(`xpub6${"zprv".padEnd(106, "a")}`)).toEqual({ problem: "invalid" });
  });

  it("tells a key from an address", () => {
    expect(looksLikeWalletKey(VECTORS.p2wpkh.key)).toBe(true);
    expect(looksLikeWalletKey(" wpkh(xpub…)")).toBe(true);
    expect(looksLikeWalletKey(VECTORS.p2wpkh.receive[0])).toBe(false);
    expect(looksLikeWalletKey("1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA")).toBe(false);
  });
});
