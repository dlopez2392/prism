// The job's settings, its caller check, the unsubscribe link and the call to
// Resend (send.ts): off unless both secrets are set and never on a preview,
// a secret compared in constant time, a link good for one person only, and
// a request carrying one-click unsubscribe and an idempotency key.

import { describe, expect, it, vi } from "vitest";
import { alertsConfig, cronAllowed, sendAlertEmail, unsubscribeFor, unsubscribeLinks, unsubscribeToken } from "./send";

const SECRET = "s".repeat(44);
const U = "11111111-1111-4111-8111-111111111111";
const V = "22222222-2222-4222-8222-222222222222";
const on = { RESEND_API_KEY: "re_test", CRON_SECRET: SECRET };

describe("alert email settings", () => {
  it("are off without both a Resend key and a long enough secret, and on any preview", () => {
    expect(alertsConfig({})).toBeNull();
    expect(alertsConfig({ RESEND_API_KEY: "re_test" })).toBeNull();
    expect(alertsConfig({ ...on, CRON_SECRET: "short" })).toBeNull();
    expect(alertsConfig({ ...on, VERCEL_ENV: "preview" })).toBeNull();
    expect(alertsConfig(on)).toEqual({ resendKey: "re_test", secret: SECRET, from: "Prism <no-reply@bis-rgv.com>", site: "https://prism.bis-rgv.com" });
  });

  it("take a sender and a site only in a safe shape", () => {
    expect(alertsConfig({ ...on, ALERTS_FROM: "Prism Alerts <alerts@example.com>", ALERTS_SITE_URL: "https://money.example/" })).toMatchObject({ from: "Prism Alerts <alerts@example.com>", site: "https://money.example" });
    expect(alertsConfig({ ...on, ALERTS_SITE_URL: "http://money.example" })).toBeNull();
    expect(alertsConfig({ ...on, ALERTS_SITE_URL: "https://money.example/path" })).toBeNull();
    expect(alertsConfig({ ...on, ALERTS_FROM: "alerts@example.com\r\nBcc: x@y.z" })).toBeNull();
  });
});

describe("the job's caller", () => {
  it("must send exactly the secret, as Vercel Cron does", () => {
    expect(cronAllowed(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(cronAllowed(null, SECRET)).toBe(false);
    expect(cronAllowed(SECRET, SECRET)).toBe(false);
    expect(cronAllowed(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(cronAllowed(`Bearer ${"t".repeat(44)}`, SECRET)).toBe(false);
  });
});

describe("an unsubscribe link", () => {
  it("names one person, and works only with the token signed for them", () => {
    const t = unsubscribeToken(U, SECRET);
    expect(unsubscribeFor(U, t, SECRET)).toBe(U);
    expect(unsubscribeFor(V, t, SECRET)).toBeNull();
    expect(unsubscribeFor(U, unsubscribeToken(U, "o".repeat(44)), SECRET)).toBeNull();
    expect(unsubscribeFor(U, t.slice(0, -1), SECRET)).toBeNull();
    expect(unsubscribeFor("not-a-person", t, SECRET)).toBeNull();
    expect(unsubscribeFor(U, undefined, SECRET)).toBeNull();
  });

  it("points at the confirm page for people and at the one-click endpoint for mail apps", () => {
    const links = unsubscribeLinks(alertsConfig(on)!, U);
    const t = unsubscribeToken(U, SECRET);
    expect(links).toEqual({ page: `https://prism.bis-rgv.com/alerts/unsubscribe?u=${U}&t=${t}`, oneClick: `https://prism.bis-rgv.com/api/alerts/unsubscribe?u=${U}&t=${t}` });
  });
});

describe("sending through Resend", () => {
  const config = alertsConfig(on)!;
  const message = { subject: "Hi", text: "Hello", html: "<p>Hello</p>" };

  it("posts the email with one-click unsubscribe headers and an idempotency key", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ id: "e1" }));
    expect(await sendAlertEmail(config, "a@x.test", message, "https://prism.bis-rgv.com/api/alerts/unsubscribe?u=1&t=2", "prism-alerts-abc", fetchImpl)).toBe("sent");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers).toMatchObject({ Authorization: "Bearer re_test", "Idempotency-Key": "prism-alerts-abc" });
    expect(JSON.parse(String(init.body))).toEqual({
      from: "Prism <no-reply@bis-rgv.com>",
      to: ["a@x.test"],
      subject: "Hi",
      text: "Hello",
      html: "<p>Hello</p>",
      headers: { "List-Unsubscribe": "<https://prism.bis-rgv.com/api/alerts/unsubscribe?u=1&t=2>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    });
  });

  it("tells a refused message from a refused key, and both from a failure", async () => {
    const status = (n: number) => sendAlertEmail(config, "a@x.test", message, "u", "k", async () => new Response("{}", { status: n }));
    expect(await status(422)).toBe("refused");
    expect(await status(403)).toBe("stop");
    expect(await status(401)).toBe("stop");
    expect(await status(500)).toBe("failed");
    expect(await status(429)).toBe("failed");
    expect(await sendAlertEmail(config, "a@x.test", message, "u", "k", async () => Promise.reject(new Error("down")))).toBe("failed");
  });
});
