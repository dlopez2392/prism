import { describe, expect, it } from "vitest";
import { FIRST_NAME_MAX, landingAfterSignIn, readFirstName } from "./profile";

describe("first name", () => {
  it("keeps real names from many languages, tidied", () => {
    for (const [typed, kept] of [
      ["Dan", "Dan"],
      ["  María   José ", "María José"],
      ["O'Brien", "O'Brien"],
      ["D’Angelo", "D’Angelo"],
      ["Jean-Luc", "Jean-Luc"],
      ["J. R.", "J. R."],
      ["Zoë", "Zoë"],
      ["Nguyễn", "Nguyễn"],
      ["美咲", "美咲"],
      ["Александр", "Александр"],
      ["x".repeat(FIRST_NAME_MAX), "x".repeat(FIRST_NAME_MAX)],
    ] as const) {
      expect(readFirstName(typed)).toEqual({ ok: true, name: kept });
    }
  });

  it("treats blank as going without a name", () => {
    for (const blank of ["", "   ", "\u0000\t", null]) expect(readFirstName(blank)).toEqual({ ok: true, name: null });
  });

  it("refuses anything that reads like a password, not a name", () => {
    for (const typed of ["Summer2024!", "hunter2", "P@ssw0rd", "dan#1", "correct-horse-9", "-Dan", "'Dan", "dan_lopez", "a+b"]) {
      const read = readFirstName(typed);
      expect(read.ok, typed).toBe(false);
      // The refusal never repeats what was typed.
      if (!read.ok) expect(read.error).not.toContain(typed);
    }
  });

  it("refuses an over-long name, counting characters rather than bytes", () => {
    expect(readFirstName("x".repeat(FIRST_NAME_MAX + 1)).ok).toBe(false);
    expect(readFirstName("é".repeat(FIRST_NAME_MAX)).ok).toBe(true);
  });
});

describe("where a sign-in lands", () => {
  const now = Date.parse("2026-09-28T16:00:00Z");

  it("sends an account's first sign-in to the welcome step", () => {
    expect(landingAfterSignIn({ email_confirmed_at: "2026-09-28T15:59:58Z" }, now)).toBe("/account?welcome=1");
    // The auth server's clock running slightly ahead still counts.
    expect(landingAfterSignIn({ email_confirmed_at: "2026-09-28T16:00:30Z" }, now)).toBe("/account?welcome=1");
  });

  it("sends everyone else to the overview", () => {
    expect(landingAfterSignIn({ email_confirmed_at: "2026-09-20T09:00:00Z" }, now)).toBe("/");
    expect(landingAfterSignIn({ email_confirmed_at: null }, now)).toBe("/");
    expect(landingAfterSignIn({ email_confirmed_at: "not a date" }, now)).toBe("/");
    expect(landingAfterSignIn(null, now)).toBe("/");
  });
});
