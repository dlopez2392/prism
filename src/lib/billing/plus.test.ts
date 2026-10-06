// Who may use what: everything open while billing is off, a person's own
// plan or their household's once it's on, and the gates left open (never
// shut) when the database can't be asked.

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { EVERYTHING_OPEN, plusFor, plusFromRow } = await import("./plus");

const row = (over: Record<string, unknown> = {}) => ({
  plan: null,
  billing_interval: null,
  status: null,
  period_end: null,
  trial_end: null,
  ends_at: null,
  customer_id: null,
  subscription_id: null,
  own_plus: false,
  household_plan: false,
  household_plus: false,
  subscribed_before: false,
  ...over,
});

function accountAnswering(answer: { data: unknown; error: unknown }) {
  const rpc = vi.fn(async () => answer);
  return { account: { supabase: { rpc }, userId: "u", email: "a@x.test" } as never, rpc };
}

function billingOn() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ref.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_" + "k".repeat(24));
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_" + "w".repeat(32));
  vi.stubEnv("CRON_SECRET", "c".repeat(44));
}

describe("a person's plan", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("opens everything to everyone while billing is off, as before Prism Plus", async () => {
    const { account, rpc } = accountAnswering({ data: [row()], error: null });
    expect(await plusFor(account)).toEqual(EVERYTHING_OPEN);
    expect(await plusFor(null)).toEqual(EVERYTHING_OPEN);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("with billing on: free with nothing, Plus with their own plan or a household member's Household plan", async () => {
    billingOn();
    const { account, rpc } = accountAnswering({ data: [row()], error: null });
    expect(await plusFor(account)).toMatchObject({ billing: true, plus: false, householdView: false, trial: true, own: null });
    expect(rpc).toHaveBeenCalledWith("my_plan", { p_livemode: false });
    expect(await plusFor(null)).toMatchObject({ billing: true, plus: false, trial: true });

    const own = plusFromRow(row({ plan: "plus", billing_interval: "year", status: "active", own_plus: true, household_plus: true, subscribed_before: true, customer_id: "cus_1" }));
    expect(own).toMatchObject({ plus: true, householdView: true, covered: false, trial: false, customerId: "cus_1", own: { plan: "plus", interval: "year", counts: true } });
    expect(plusFromRow(row({ household_plan: true, household_plus: true }))).toMatchObject({ plus: true, covered: true, own: null });
    // Someone else's individual plan opens the household's shared view, and nothing else.
    expect(plusFromRow(row({ household_plus: true }))).toMatchObject({ plus: false, householdView: true });
    // A plan that ended is still described (when it ended), but gives nothing, and there's no second trial.
    expect(plusFromRow(row({ plan: "plus", billing_interval: "month", status: "canceled", subscribed_before: true }))).toMatchObject({ plus: false, trial: false, own: { counts: false } });
  });

  it("errs toward the person when the database can't be asked: the gates stay open, and say so", async () => {
    billingOn();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { account } = accountAnswering({ data: null, error: { code: "57014" } });
    expect(await plusFor(account)).toMatchObject({ billing: true, checked: false, plus: true, householdView: true });
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
