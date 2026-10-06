// Who may connect real money (src/lib/linking.ts): with accounts on, only a
// signed-in account; with them off, only Plaid's sandbox, into the device.

import { describe, expect, it } from "vitest";
import { connectReason, linkingRefusal, signInToConnect } from "./linking";

describe("connecting real money", () => {
  it("needs a signed-in account whenever accounts are on", () => {
    expect(linkingRefusal({ accountsEnabled: true, signedIn: false, realMoney: false })).toMatchObject({ status: 401, error: "sign_in_required" });
    expect(linkingRefusal({ accountsEnabled: true, signedIn: false, realMoney: true, kind: "coinbase" })).toMatchObject({
      status: 401,
      message: expect.stringMatching(/Coinbase/),
    });
    expect(linkingRefusal({ accountsEnabled: true, signedIn: false, realMoney: true, kind: "investments" })).toMatchObject({ status: 401, message: "Sign in to connect an investment account. It's kept in your account, where two-step sign-in protects it." });
    expect(linkingRefusal({ accountsEnabled: true, signedIn: true, realMoney: true })).toBeNull();
  });

  it("never parks anything real in a cookie, even where accounts are off", () => {
    expect(linkingRefusal({ accountsEnabled: false, signedIn: false, realMoney: true })).toMatchObject({ status: 503, error: "accounts_required" });
  });

  it("still lets a developer's sandbox link to the device, so Prism can be built without accounts", () => {
    expect(linkingRefusal({ accountsEnabled: false, signedIn: false, realMoney: false })).toBeNull();
  });
});

describe("the way to sign in first", () => {
  it("says why, and comes back to the page the person was on", () => {
    expect(signInToConnect("bank", "/budgets?month=2026-09")).toBe("/sign-in?why=bank&next=%2Fbudgets%3Fmonth%3D2026-09");
    expect(signInToConnect("coinbase", "/connections")).toBe("/sign-in?why=coinbase&next=%2Fconnections");
    expect(signInToConnect("investments", "/connections")).toBe("/sign-in?why=investments&next=%2Fconnections");
  });

  it("never comes back to another site", () => {
    for (const evil of ["https://evil.example/", "//evil.example", "/\\evil.example", 42]) expect(signInToConnect("bank", evil)).toBe("/sign-in?why=bank");
  });

  it("is read back as one of two reasons, or none", () => {
    expect(connectReason("bank")).toBe("bank");
    expect(connectReason("coinbase")).toBe("coinbase");
    expect(connectReason("investments")).toBe("investments");
    for (const other of ["", "BANK", "<script>", undefined, ["bank"]]) expect(connectReason(other)).toBeNull();
  });
});
