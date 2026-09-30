// The server's half of an import (import-actions.ts): nothing from the
// browser is trusted. Every row and the import's description are checked
// again, stored only sealed, and an import shows only once every part it
// counts has arrived.

import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const refresh = vi.fn();
vi.mock("next/cache", () => ({ refresh }));
vi.mock("./finance", () => ({ requestToday: async () => "2026-09-30" }));
const signedIn = { current: null as unknown };
vi.mock("@/lib/supabase/server", () => ({ currentAccount: async () => signedIn.current }));

const { finishImport, removeImport, saveImportPart } = await import("./import-actions");
const { openPacked, vaultKey } = await import("./vault");

const ID = "0f8e2b1a-3c4d-4e5f-8a9b-0c1d2e3f4a5b";
const row = { date: "2020-01-05", amount: -1_250, merchant: "Old Diner", category: "food" };
const meta = (parts: number) => ({ name: "Old Visa", kind: "credit", attachTo: null, source: "mint", parts });

/** The imported_history table as far as these actions reach it, holding what they stored. */
function database({ limit = false } = {}) {
  const stored: { user_id: string; import_id: string; part: number; sealed: string }[] = [];
  const deleted: Record<string, unknown>[] = [];
  const supabase = {
    from: (table: string) => {
      expect(table).toBe("imported_history");
      return {
        insert: async (r: (typeof stored)[number]) => {
          if (limit) return { error: { code: "23514", message: "twenty imports" } };
          stored.push(r);
          return { error: null };
        },
        select: () => {
          const filters: Record<string, unknown> = {};
          const q = {
            eq: (col: string, v: unknown) => ((filters[col] = v), q),
            returns: async () => ({ data: stored.filter((r) => r.user_id === filters.user_id && r.import_id === filters.import_id).map((r) => ({ part: r.part })), error: null }),
          };
          return q;
        },
        delete: () => {
          const filters: Record<string, unknown> = {};
          const q = {
            eq: (col: string, v: unknown) => {
              filters[col] = v;
              if (Object.keys(filters).length === 2) {
                deleted.push({ ...filters });
                return Promise.resolve({ error: null });
              }
              return q;
            },
          };
          return q;
        },
      };
    },
  };
  signedIn.current = { userId: "u1", email: "a@x.test", supabase };
  return { stored, deleted };
}

describe("importing history", () => {
  beforeEach(() => vi.stubEnv("PRISM_VAULT_KEY", randomBytes(32).toString("base64")));
  afterEach(() => {
    vi.unstubAllEnvs();
    signedIn.current = null;
    refresh.mockClear();
  });

  it("needs a signed-in account", async () => {
    expect(await saveImportPart(ID, 1, [row])).toMatchObject({ ok: false, message: expect.stringMatching(/Sign in/) });
    expect(await finishImport(ID, meta(1), [row])).toMatchObject({ ok: false });
  });

  it("stores each batch sealed, never in the clear, and shows the import only when its last write arrives", async () => {
    const { stored } = database();
    expect(await saveImportPart(ID, 1, [row, { ...row, merchant: "Old Diner 2" }])).toEqual({ ok: true });
    expect(refresh).not.toHaveBeenCalled();
    expect(await finishImport(ID, meta(2), [row])).toEqual({ ok: true });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(stored.map((r) => r.part)).toEqual([1, 0]);
    for (const r of stored) expect(r.sealed).not.toContain("Old Diner");
    // What's sealed is exactly what was checked: the description, and the rows.
    expect(openPacked(stored[1]!.sealed, vaultKey()!)).toEqual({ v: 1, meta: meta(2), rows: [row] });
    expect(stored.every((r) => r.user_id === "u1" && r.import_id === ID)).toBe(true);
  });

  it("won't finish an import whose other parts haven't all arrived", async () => {
    const { stored } = database();
    await saveImportPart(ID, 1, [row]);
    expect(await finishImport(ID, meta(3), [row])).toMatchObject({ ok: false, message: expect.stringMatching(/didn't arrive/) });
    expect(stored.map((r) => r.part)).toEqual([1]);
  });

  it("refuses anything the page didn't check, or couldn't have: forged rows, extra fields, a bad id or part", async () => {
    const { stored } = database();
    for (const [id, part, rows] of [
      ["not-a-uuid", 1, [row]],
      [ID, 0, [row]],
      [ID, 60, [row]],
      [ID, 1.5, [row]],
      [ID, 1, []],
      [ID, 1, [{ ...row, amount: 0 }]],
      [ID, 1, [{ ...row, date: "2027-01-01" }]],
      [ID, 1, [{ ...row, category: "toString" }]],
      [ID, 1, [{ ...row, account: "Chase" }]],
      [ID, 1, Array.from({ length: 2_001 }, () => row)],
      [ID, 1, "rows"],
    ] as const) {
      expect(await saveImportPart(id, part, rows), `${id} ${part} ${JSON.stringify(rows).slice(0, 40)}`).toMatchObject({ ok: false });
    }
    for (const bad of [{ ...meta(1), kind: "crypto" }, { ...meta(1), parts: 0 }, { ...meta(1), name: "" }, null]) {
      expect(await finishImport(ID, bad, [row])).toMatchObject({ ok: false });
    }
    expect(stored).toEqual([]);
  });

  it("says so, in words, when the person already keeps twenty imports", async () => {
    database({ limit: true });
    expect(await finishImport(ID, meta(1), [row])).toEqual({ ok: false, message: "Prism keeps up to twenty imports. Remove one on Connections first." });
  });

  it("removes one import whole, and only the person's own", async () => {
    const { deleted } = database();
    expect(await removeImport(ID)).toEqual({ ok: true });
    expect(deleted).toEqual([{ user_id: "u1", import_id: ID }]);
    expect(await removeImport("'; drop table")).toMatchObject({ ok: false });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
