// An invitation that ran out can't be used or shown, so Prism doesn't keep the
// address it went to either (household-store.ts, loadHousehold): showing the
// household removes it, and a failure to remove it never breaks the page.

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { loadHousehold } = await import("./household-store");

const day = 86_400_000;
const at = (ms: number) => new Date(Date.now() + ms).toISOString();

function member({ deleteFails = false } = {}) {
  const deleted: string[][] = [];
  const supabase = {
    rpc: async () => ({ data: [{ user_id: "u1", first_name: "Dana", email: "dana@x.test", joined_at: at(-9 * day), is_me: true }], error: null }),
    from: () => ({
      select: () => ({
        order: () => ({
          returns: async () => ({
            data: [
              { id: "live", email: "sam@x.test", expires_at: at(2 * day) },
              { id: "old", email: "gone@x.test", expires_at: at(-day) },
            ],
            error: null,
          }),
        }),
      }),
      delete: () => ({
        in: (_col: string, ids: string[]) => {
          deleted.push(ids);
          return deleteFails ? Promise.reject(new Error("offline")) : Promise.resolve({ error: null });
        },
      }),
    }),
  };
  return { account: { userId: "u1", email: "dana@x.test", supabase } as never, deleted };
}

describe("a household's expired invitations", () => {
  it("are removed when the household is shown, and only the open ones are listed", async () => {
    const { account, deleted } = member();
    const household = await loadHousehold(account);
    expect(household?.invites.map((i) => i.email)).toEqual(["sam@x.test"]);
    expect(deleted).toEqual([["old"]]);
  });

  it("never cost the page when they can't be removed just now", async () => {
    const { account } = member({ deleteFails: true });
    expect((await loadHousehold(account))?.invites.map((i) => i.email)).toEqual(["sam@x.test"]);
  });
});
