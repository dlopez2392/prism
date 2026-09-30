import { describe, expect, it } from "vitest";
import { base58Decode, normalizeAddress } from "./address";

describe("a Bitcoin address", () => {
  it("takes every mainnet kind, checksum and all (BIP 13, 173, 350 vectors)", () => {
    for (const a of [
      "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", // P2PKH, the genesis block's
      "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy", // P2SH
      "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", // P2WPKH, bech32
      "bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3", // P2WSH, bech32
      "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0", // Taproot, bech32m
    ]) {
      expect(normalizeAddress("bitcoin", a), a).toBe(a);
    }
    // Upper case (as in QR codes) is the same address, kept lower.
    expect(normalizeAddress("bitcoin", " BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4 ")).toBe("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4");
  });

  it("refuses a typo, another network, or the wrong checksum for its version", () => {
    for (const a of [
      "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNb", // one character off
      "1A1zP1eP5QGefi2DMPTfTL5SLmv7Div", // too short
      "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5", // bech32 checksum off
      "Bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", // mixed case
      "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx", // testnet
      "mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn", // testnet P2PKH
      // Version 1 written with bech32 instead of bech32m: valid under BIP 173, refused since BIP 350.
      "bc1pw508d6qejxtdg4y5r3zarvary0c5xw7kw508d6qejxtdg4y5r3zarvary0c5xw7k7grplx",
      // The right checksum for the wrong version, made with BIP 350's reference encoder from the Taproot and P2WPKH vectors above:
      "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqh2y7hd", // version 1 (32 bytes) with bech32
      "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kemeawh", // version 0 with bech32m (also in BIP 350's own list)
      "bc1pw508d6qejxtdg4y5r3zarvary0c5xw7kj9wkru", // version 1 with only 20 bytes: not a Taproot key
      "bc1qqqqsyqcyq5rqwzqfpg9scrgwpuk7nx3h", // version 0, checksum right, but 16 bytes (neither a key hash nor a script hash)
      // BIP 173's own invalid vectors: a 16-byte version 0 program, and a 41-byte program.
      "BC1QR508D6QEJXTDG4Y5R3ZARVARY0C5XW7KN40WF2",
      "bc1zw508d6qejxtdg4y5r3zarvary0c5xw7kw508d6qejxtdg4y5r3zarvary0c5xw7kw5rljs90",
      "0x52908400098527886E0F7030069857D2E4169EE7",
      "",
    ]) {
      expect(normalizeAddress("bitcoin", a), a).toBeNull();
    }
    expect(normalizeAddress("bitcoin", 42)).toBeNull();
  });
});

describe("an Ethereum address", () => {
  it("takes 0x and 40 hex digits in any case, kept lowercase, and never the zero address", () => {
    expect(normalizeAddress("ethereum", "0x52908400098527886E0F7030069857D2E4169EE7")).toBe("0x52908400098527886e0f7030069857d2e4169ee7");
    expect(normalizeAddress("ethereum", "0x" + "0".repeat(40))).toBeNull();
    expect(normalizeAddress("ethereum", "52908400098527886E0F7030069857D2E4169EE7")).toBeNull();
    expect(normalizeAddress("ethereum", "0x52908400098527886E0F7030069857D2E4169EE")).toBeNull();
    expect(normalizeAddress("ethereum", "0x52908400098527886E0F7030069857D2E4169EEG")).toBeNull();
  });
});

describe("a Solana address", () => {
  it("takes a base58 key of exactly 32 bytes", () => {
    expect(normalizeAddress("solana", "So11111111111111111111111111111111111111112")).toBe("So11111111111111111111111111111111111111112");
    expect(normalizeAddress("solana", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")).toBe("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    // Base58 has no 0, O, I or l.
    expect(normalizeAddress("solana", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt10")).toBeNull();
    // Right alphabet, wrong length.
    expect(normalizeAddress("solana", "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa")).toBeNull();
  });

  it("decodes base58 with its leading zero bytes", () => {
    expect(Array.from(base58Decode("1112")!)).toEqual([0, 0, 0, 1]);
    expect(base58Decode("0OIl")).toBeNull();
  });
});
