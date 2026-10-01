// The privacy policy tells people everything Prism keeps in their browser.
// This keeps it honest: a new cookie or browser-storage key anywhere in the
// source fails here until it's declared in src/lib/privacy.ts, and shown on
// /privacy.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PRIVACY_CONTACT, PROVIDERS, PUSH_SERVICES, STORED_ON_DEVICE } from "./privacy";

const SRC = path.resolve(import.meta.dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

const source = sourceFiles(SRC).map((f) => readFileSync(f, "utf8"));

/** Cookie names the code sets: `*_COOKIE = "name"` constants, and cookies written straight from the browser. */
function cookiesInSource(): string[] {
  const names = new Set<string>();
  for (const text of source) {
    for (const m of text.matchAll(/_COOKIE\s*=\s*"([^"]+)"/g)) names.add(m[1]!);
    for (const m of text.matchAll(/document\.cookie\s*=\s*"([^"=]+)=/g)) names.add(m[1]!);
  }
  return [...names].sort();
}

/** localStorage / sessionStorage keys: the literal passed to setItem, or the constant it names. */
function storageKeysInSource(): string[] {
  const names = new Set<string>();
  for (const text of source) {
    for (const m of text.matchAll(/(?:local|session)Storage\.setItem\(\s*(?:"([^"]+)"|([A-Z_]+))/g)) {
      if (m[1]) names.add(m[1]);
      else {
        const constant = new RegExp(`const ${m[2]}\\s*=\\s*"([^"]+)"`).exec(text);
        if (constant) names.add(constant[1]!);
      }
    }
  }
  return [...names].sort();
}

describe("the privacy policy", () => {
  const declared = STORED_ON_DEVICE.map((c) => c.name);

  it("declares every cookie Prism sets", () => {
    const found = cookiesInSource();
    // Sanity: the scan finds the ones we know are there.
    expect(found).toEqual(expect.arrayContaining(["prism-auth", "prism-vault", "__Host-prism-bank-return", "prism-tz"]));
    expect(found.filter((name) => !declared.includes(name))).toEqual([]);
  });

  it("declares every browser-storage key Prism writes", () => {
    const found = storageKeysInSource();
    expect(found).toContain("prism-theme");
    expect(found.filter((name) => !declared.includes(name))).toEqual([]);
  });

  it("declares nothing that no longer exists", () => {
    const inSource = new Set([...cookiesInSource(), ...storageKeysInSource()]);
    const ours = STORED_ON_DEVICE.filter((c) => !c.setByLibrary).map((c) => c.name);
    expect(ours.filter((name) => !inSource.has(name))).toEqual([]);
    // The one a library sets: Supabase names its sign-in cookie after Prism's auth cookie.
    expect(STORED_ON_DEVICE.filter((c) => c.setByLibrary).map((c) => c.name)).toEqual(["prism-auth-code-verifier"]);
  });

  it("says, for each, what it's for and how long it's kept", () => {
    for (const c of STORED_ON_DEVICE) {
      expect(c.what.length, c.name).toBeGreaterThan(20);
      expect(c.lasts.length, c.name).toBeGreaterThan(3);
    }
  });

  it("names the companies that handle people's data, with their own policies, and a way to reach us", () => {
    expect(PROVIDERS.map((p) => p.name)).toEqual(expect.arrayContaining(["Plaid", "Supabase", "Vercel", "Resend"]));
    for (const p of [...PROVIDERS, ...PUSH_SERVICES]) expect(p.policy, p.name).toMatch(/^https:\/\//);
    expect(PRIVACY_CONTACT).toMatch(/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/);
  });
});

describe("the push services the policy names", () => {
  it("are every service a device's alerts can be sent to, and no other", async () => {
    const { PUSH_HOSTS } = await import("./alerts/webpush");
    const known: Record<string, string> = {
      "fcm.googleapis.com": "Google",
      "updates.push.services.mozilla.com": "Mozilla",
      "web.push.apple.com": "Apple",
      "wns2-par02p.notify.windows.com": "Microsoft",
    };
    // Each allowed host is one of these companies'; a new one fails here until the policy names it.
    const named = PUSH_HOSTS.map((h) => {
      const hits = Object.keys(known).filter((host) => h.test(host));
      expect(hits, String(h)).toHaveLength(1);
      return known[hits[0]!]!;
    });
    expect(PUSH_SERVICES.map((p) => p.name).sort()).toEqual([...new Set(named)].sort());
  });
});
