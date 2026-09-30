// What must never be typed into Prism (secrets.ts): anything that can spend is
// recognised, in the browser and on the server, and anything a person may
// share is not mistaken for it. No real secret appears here: every one is
// built from placeholders of the right shape.

import { describe, expect, it } from "vitest";
import { secretKind, secretWarning } from "./secrets";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const b58 = (n: number, start = 0) => Array.from({ length: n }, (_, i) => B58[(start + i * 7) % 58]).join("");

describe("recognising what can spend", () => {
  it("knows an extended private key, bare or inside a descriptor", () => {
    for (const prefix of ["xprv", "yprv", "zprv", "tprv", "Yprv", "Zprv"]) expect(secretKind(prefix + b58(107))).toBe("private-key");
    expect(secretKind(`wpkh([73c5da0a/84h/0h/0h]xprv${b58(107)}/0/*)`)).toBe("private-key");
  });

  it("knows a single private key in each network's usual form", () => {
    expect(secretKind(`5${b58(50)}`)).toBe("private-key"); // Bitcoin WIF, uncompressed
    expect(secretKind(`K${b58(51)}`)).toBe("private-key"); // compressed
    expect(secretKind(`L${b58(51, 3)}`)).toBe("private-key");
    expect(secretKind(`0x${"ab".repeat(32)}`)).toBe("private-key"); // Ethereum
    expect(secretKind("cd".repeat(32))).toBe("private-key");
    expect(secretKind(b58(88))).toBe("private-key"); // Solana, base58 of 64 bytes
    expect(secretKind(`[${Array.from({ length: 64 }, (_, i) => i * 3).join(",")}]`)).toBe("private-key"); // Solana wallet file
  });

  it("knows a recovery phrase of twelve or twenty-four words, however it's spaced", () => {
    const twelve = Array.from({ length: 12 }, (_, i) => ["river", "stone", "apple", "cabin"][i % 4]).join(" ");
    expect(secretKind(twelve)).toBe("recovery-phrase");
    expect(secretKind(`  ${twelve.replace(/ /g, "\n")}  `)).toBe("recovery-phrase");
    expect(secretKind(`${twelve} ${twelve}`)).toBe("recovery-phrase");
  });

  it("never mistakes what a person may share for a secret", () => {
    for (const shareable of [
      "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
      "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
      "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy",
      "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr",
      "0x52908400098527886E0F7030069857D2E4169EE7",
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj",
      "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs",
      // An xpub whose letters happen to spell "prv" part-way through is still just an xpub.
      `xpub6${"zprv".padEnd(106, "a")}`,
      "wpkh([73c5da0a/84h/0h/0h]xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj/0/*)",
      "my savings wallet",
      "",
    ])
      expect(secretKind(shareable), shareable).toBeNull();
    expect(secretKind(undefined)).toBeNull();
    expect(secretKind(42)).toBeNull();
  });
});

describe("what the person is told", () => {
  it("says whether it went anywhere, and never repeats it", () => {
    expect(secretWarning("recovery-phrase", false)).toMatch(/recovery phrase\. It wasn't sent anywhere\./);
    expect(secretWarning("private-key", true)).toMatch(/private key, which can spend your coins\. Prism didn't keep it\./);
  });
});
