import { describe, expect, it } from "vitest";
import { plaidConfig, plaidRequest, PlaidError } from "./client";
import { syncTransactions } from "./sync";
import { accountKind, incomeKindOf, mapAccount, mapCategory, mapHoldings, mapTransaction, reconstructHistory, signedBalance, suggestedLimit, taxHintOf } from "./map";
import type { PlaidAccount, PlaidTransaction } from "./client";

const acct = (over: Partial<PlaidAccount>): PlaidAccount => ({
  account_id: "a1",
  name: "Checking",
  official_name: null,
  mask: "0000",
  type: "depository",
  subtype: "checking",
  balances: { available: 100.5, current: 120, iso_currency_code: "USD" },
  ...over,
});

const ptx = (over: Partial<PlaidTransaction>): PlaidTransaction => ({
  transaction_id: "t1",
  account_id: "a1",
  amount: 12.34,
  date: "2026-09-10",
  name: "SQ *COFFEE",
  merchant_name: "Bean There",
  pending: false,
  personal_finance_category: { primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_COFFEE" },
  ...over,
});

describe("mapTransaction", () => {
  it("flips Plaid's sign: money out is negative here", () => {
    expect(mapTransaction(ptx({ amount: 12.34 })).amount).toBe(-1_234);
    expect(mapTransaction(ptx({ amount: -2_500 })).amount).toBe(250_000);
  });

  it("prefers the clean merchant name", () => {
    expect(mapTransaction(ptx({})).merchant).toBe("Bean There");
    expect(mapTransaction(ptx({ merchant_name: null })).merchant).toBe("SQ *COFFEE");
    // A card's interest charge says so, for the payoff plan; nothing else does.
    expect(mapTransaction(ptx({ personal_finance_category: { primary: "BANK_FEES", detailed: "BANK_FEES_INTEREST_CHARGE" } })).interestCharge).toBe(true);
    expect(mapTransaction(ptx({ personal_finance_category: { primary: "BANK_FEES", detailed: "BANK_FEES_OVERDRAFT_FEES" } }))).not.toHaveProperty("interestCharge");
    expect(mapTransaction(ptx({}))).not.toHaveProperty("interestCharge");
  });
});

describe("what kind of income the bank says it is", () => {
  const income = (detailed: string) => ({ primary: "INCOME", detailed });

  it("reads both of Plaid's category versions, and only for income", () => {
    expect(incomeKindOf(income("INCOME_WAGES"))).toBe("pay");
    expect(incomeKindOf(income("INCOME_SALARY"))).toBe("pay");
    expect(incomeKindOf(income("INCOME_INTEREST_EARNED"))).toBe("interest");
    expect(incomeKindOf(income("INCOME_DIVIDENDS"))).toBe("dividends");
    expect(incomeKindOf(income("INCOME_RETIREMENT_PENSION"))).toBe("retirement");
    expect(incomeKindOf(income("INCOME_UNEMPLOYMENT"))).toBe("benefits");
    expect(incomeKindOf(income("INCOME_TAX_REFUND"))).toBe("tax-refund");
    expect(incomeKindOf(income("INCOME_SOMETHING_NEW"))).toBe("other");
    expect(incomeKindOf({ primary: "TRANSFER_IN", detailed: "TRANSFER_IN_DEPOSIT" })).toBeUndefined();
    expect(incomeKindOf(null)).toBeUndefined();
  });

  it("is kept on an income transaction, and on nothing else", () => {
    const pay = mapTransaction(ptx({ amount: -2_450, name: "ACME PAYROLL", merchant_name: null, personal_finance_category: income("INCOME_WAGES") }));
    expect(pay).toMatchObject({ category: "income", incomeKind: "pay", amount: 245_000 });
    expect("incomeKind" in mapTransaction(ptx({}))).toBe(false);
  });
});

describe("taxHintOf", () => {
  const PRIMARY = ["GOVERNMENT_AND_NON_PROFIT", "GENERAL_SERVICES", "LOAN_PAYMENTS", "PERSONAL_CARE", "MEDICAL"];
  const pfc = (detailed: string) => ({ primary: PRIMARY.find((p) => detailed.startsWith(`${p}_`))!, detailed });

  it("names what a tax return asks about, from the bank's detailed category", () => {
    expect(taxHintOf(pfc("GOVERNMENT_AND_NON_PROFIT_DONATIONS"))).toBe("donation");
    expect(taxHintOf(pfc("GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT"))).toBe("tax-payment");
    for (const d of ["DENTAL_CARE", "EYE_CARE", "NURSING_CARE", "PHARMACIES_AND_SUPPLEMENTS", "PRIMARY_CARE", "OTHER_MEDICAL"]) expect(taxHintOf(pfc(`MEDICAL_${d}`))).toBe("medical");
    expect(taxHintOf(pfc("GENERAL_SERVICES_CHILDCARE"))).toBe("childcare");
    expect(taxHintOf(pfc("GENERAL_SERVICES_EDUCATION"))).toBe("education");
    expect(taxHintOf(pfc("LOAN_PAYMENTS_MORTGAGE_PAYMENT"))).toBe("mortgage");
    expect(taxHintOf(pfc("LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT"))).toBe("student-loan");
  });

  it("says nothing of a vet, a government fee, anything else or nothing", () => {
    expect(taxHintOf(pfc("MEDICAL_VETERINARY_SERVICES"))).toBeUndefined();
    expect(taxHintOf(pfc("GOVERNMENT_AND_NON_PROFIT_GOVERNMENT_DEPARTMENTS_AND_AGENCIES"))).toBeUndefined();
    expect(taxHintOf(pfc("PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS"))).toBeUndefined();
    expect(taxHintOf(null)).toBeUndefined();
  });

  it("is kept on the transaction only when there is one", () => {
    expect(mapTransaction(ptx({ amount: 120, name: "ST JUDE", merchant_name: null, personal_finance_category: pfc("GOVERNMENT_AND_NON_PROFIT_DONATIONS") }))).toMatchObject({ amount: -12_000, category: "other", taxHint: "donation" });
    expect("taxHint" in mapTransaction(ptx({}))).toBe(false);
  });
});

describe("mapCategory", () => {
  it("treats a credit card payment as a transfer, not spending", () => {
    expect(mapCategory({ primary: "LOAN_PAYMENTS", detailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" })).toBe("transfer");
  });

  it("splits rent from utilities", () => {
    expect(mapCategory({ primary: "RENT_AND_UTILITIES", detailed: "RENT_AND_UTILITIES_RENT" })).toBe("housing");
    expect(mapCategory({ primary: "RENT_AND_UTILITIES", detailed: "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY" })).toBe("bills");
  });

  it("maps the rest and falls back to other", () => {
    expect(mapCategory({ primary: "INCOME", detailed: "INCOME_WAGES" })).toBe("income");
    expect(mapCategory({ primary: "LOAN_PAYMENTS", detailed: "LOAN_PAYMENTS_MORTGAGE_PAYMENT" })).toBe("housing");
    expect(mapCategory({ primary: "PERSONAL_CARE", detailed: "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS" })).toBe("health");
    expect(mapCategory({ primary: "SOMETHING_NEW", detailed: "X" })).toBe("other");
    expect(mapCategory(null)).toBe("other");
  });
});

describe("accounts", () => {
  it("classifies account kinds", () => {
    expect(accountKind({ type: "depository", subtype: "savings" })).toBe("savings");
    expect(accountKind({ type: "investment", subtype: "401k" })).toBe("retirement");
    expect(accountKind({ type: "investment", subtype: "roth" })).toBe("retirement");
    expect(accountKind({ type: "investment", subtype: "crypto exchange" })).toBe("crypto");
    expect(accountKind({ type: "investment", subtype: "brokerage" })).toBe("investment");
  });

  it("makes debts negative for net worth", () => {
    expect(signedBalance(acct({ type: "credit", subtype: "credit card", balances: { available: null, current: 410.25, iso_currency_code: "USD" } }))).toBe(-41_025);
    expect(signedBalance(acct({ type: "loan", subtype: "student", balances: { available: null, current: 14_720, iso_currency_code: "USD" } }))).toBe(-1_472_000);
    expect(signedBalance(acct({}))).toBe(10_050);
  });

  it("rebuilds month-end history backwards from today's balance", () => {
    const txns = [mapTransaction(ptx({ amount: 50, date: "2026-09-05" })), mapTransaction(ptx({ transaction_id: "t2", amount: -200, date: "2026-08-15" }))];
    const history = reconstructHistory(100_000, txns, "2026-09-27", 3);
    // Sep had −$50, Aug had +$200: end-Aug = 1000 + 50, end-Jul = 1050 − 200.
    expect(history).toEqual([85_000, 105_000, 100_000]);
    expect(mapAccount(acct({}), "item", txns, "2026-09-27").history).toHaveLength(13);
  });
});

describe("holdings and budgets", () => {
  it("joins holdings to their securities", () => {
    const [h] = mapHoldings(
      [{ account_id: "a1", security_id: "s1", institution_value: 1234.5, cost_basis: 1000, quantity: 3 }],
      [{ security_id: "s1", ticker_symbol: "VTI", name: "Total Market", type: "etf" }],
    );
    expect(h).toMatchObject({ symbol: "VTI", value: 123_450, costBasis: 100_000, assetClass: "US stocks" });
  });

  it("drafts a budget rounded up to $25", () => {
    expect(suggestedLimit(90_000)).toBe(30_000);
    expect(suggestedLimit(91_000)).toBe(32_500);
    expect(suggestedLimit(0)).toBe(2_500);
  });
});

describe("the Plaid client", () => {
  it("is off without both keys, and sandbox unless told otherwise", () => {
    expect(plaidConfig({})).toBeNull();
    expect(plaidConfig({ PLAID_CLIENT_ID: "id", PLAID_SECRET: "" })).toBeNull();
    expect(plaidConfig({ PLAID_CLIENT_ID: "id", PLAID_SECRET: "s" })).toMatchObject({ env: "sandbox", host: "https://sandbox.plaid.com" });
    expect(plaidConfig({ PLAID_CLIENT_ID: "id", PLAID_SECRET: "s", PLAID_ENV: "production" })!.host).toBe("https://production.plaid.com");
    // A test's fake Plaid stands in for the sandbox only — never for production.
    expect(plaidConfig({ PLAID_CLIENT_ID: "id", PLAID_SECRET: "s", PLAID_API_URL: "http://localhost:4010/" })!.host).toBe("http://localhost:4010");
    expect(plaidConfig({ PLAID_CLIENT_ID: "id", PLAID_SECRET: "s", PLAID_ENV: "production", PLAID_API_URL: "http://localhost:4010" })!.host).toBe("https://production.plaid.com");
  });

  it("surfaces Plaid's error code and user-safe message", async () => {
    const config = plaidConfig({ PLAID_CLIENT_ID: "id", PLAID_SECRET: "s" })!;
    const fake = (async () =>
      new Response(JSON.stringify({ error_code: "ITEM_LOGIN_REQUIRED", error_message: "login", display_message: "Sign in again" }), {
        status: 400,
      })) as typeof fetch;
    const err = await plaidRequest(config, "/accounts/get", {}, fake).catch((e) => e);
    expect(err).toBeInstanceOf(PlaidError);
    expect(err).toMatchObject({ code: "ITEM_LOGIN_REQUIRED", displayMessage: "Sign in again", status: 400 });
  });

  it("pages /transactions/sync to the end and applies removals", async () => {
    const config = plaidConfig({ PLAID_CLIENT_ID: "id", PLAID_SECRET: "s" })!;
    const pages = [
      { added: [ptx({ transaction_id: "a" }), ptx({ transaction_id: "b" })], modified: [], removed: [], next_cursor: "c1", has_more: true },
      { added: [ptx({ transaction_id: "c" })], modified: [ptx({ transaction_id: "a", amount: 99 })], removed: [{ transaction_id: "b" }], next_cursor: "c2", has_more: false },
    ];
    const bodies: unknown[] = [];
    const fake = (async (_: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(pages[bodies.length - 1]), { status: 200 });
    }) as typeof fetch;
    const { transactions, ready } = await syncTransactions(config, "access-sandbox-x", null, { today: "2026-09-28", fetchImpl: fake });
    expect(transactions.map((t) => [t.transaction_id, t.amount])).toEqual([
      ["a", 99],
      ["c", 12.34],
    ]);
    expect(ready).toBe(true);
    expect((bodies[1] as { cursor: string }).cursor).toBe("c1");
  });
});
