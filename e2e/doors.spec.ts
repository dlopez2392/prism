// The doors a stranger might try, from the outside: no page can be framed,
// and nothing of anyone's money is handed over without signing in.

import { expect, test } from "@playwright/test";

test("no page can be framed by another site, or sniffed as another type", async ({ request }) => {
  const res = await request.get("/");
  expect(res.headers()["x-frame-options"]).toBe("DENY");
  expect(res.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
});

test("every download sends a stranger to sign in first", async ({ request }) => {
  for (const path of ["/account/export/transactions.csv", "/account/export/everything.zip", "/account/export/taxes.csv?year=2025"]) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status(), path).toBe(303);
    expect(new URL(res.headers()["location"]!).pathname + new URL(res.headers()["location"]!).search).toBe("/sign-in?next=/account");
  }
});

test("the AI connector never answers without a sign-in", async ({ request }) => {
  const res = await request.post("/mcp", { data: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
  // 401 asking for a token where it's switched on; 404 where it isn't. Never an answer.
  expect([401, 404]).toContain(res.status());
  expect(await res.text()).not.toContain("get_overview");
});
