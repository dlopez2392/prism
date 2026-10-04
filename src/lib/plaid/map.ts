// src/lib/plaid/map.ts
//
// Plaid → the domain model. Three conventions differ and each is a classic bug:
//   1. Sign. Plaid amounts are POSITIVE when money leaves the account; ours are
//      negative. Flip once, here, and nowhere else.
//   2. Debt balances. Plaid reports a card or loan balance as a positive
//      amount owed; net worth needs it negative.
//   3. Card payments. LOAN_PAYMENTS_CREDIT_CARD_PAYMENT is money moving between
//      your own accounts. Counting it as spending counts every card purchase
//      twice — once when you buy, once when you pay the card.

import { lastMonths, monthKey } from "@/lib/finance/dates";
import type { Account, AccountKind, AssetClass, CategoryId, Cents, Holding, IncomeKind, ISODate, TaxHint, Transaction } from "@/lib/finance/types";
import type { PlaidAccount, PlaidHolding, PlaidSecurity, PlaidTransaction } from "./client";

export const toCents = (dollars: number | null | undefined): Cents => Math.round((dollars ?? 0) * 100);

export function accountKind(a: Pick<PlaidAccount, "type" | "subtype">): AccountKind {
  const sub = (a.subtype ?? "").toLowerCase();
  switch (a.type) {
    case "depository":
      return sub === "checking" || sub === "prepaid" || sub === "paypal" || sub === "cash management" ? "checking" : "savings";
    case "credit":
      return "credit";
    case "loan":
      return "loan";
    case "investment":
    case "brokerage":
      if (sub.includes("crypto")) return "crypto";
      if (/401|403|457|ira|roth|pension|retirement|keogh|sep|simple|tsp/.test(sub)) return "retirement";
      return "investment";
    default:
      return "savings";
  }
}

export function signedBalance(a: PlaidAccount): Cents {
  const kind = accountKind(a);
  const value = kind === "checking" || kind === "savings" ? (a.balances.available ?? a.balances.current) : a.balances.current;
  const cents = toCents(value);
  return kind === "credit" || kind === "loan" ? -Math.abs(cents) : cents;
}

/** Plaid's personal_finance_category → our nine spending categories (+ income, transfer). */
export function mapCategory(pfc: { primary: string; detailed: string } | null | undefined): CategoryId {
  if (!pfc) return "other";
  const { primary, detailed } = pfc;
  switch (primary) {
    case "INCOME":
      return "income";
    case "TRANSFER_IN":
    case "TRANSFER_OUT":
      return "transfer";
    case "LOAN_PAYMENTS":
      if (detailed === "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT") return "transfer";
      if (detailed === "LOAN_PAYMENTS_MORTGAGE_PAYMENT") return "housing";
      if (detailed === "LOAN_PAYMENTS_CAR_PAYMENT") return "transport";
      return "bills";
    case "RENT_AND_UTILITIES":
      return detailed === "RENT_AND_UTILITIES_RENT" ? "housing" : "bills";
    case "HOME_IMPROVEMENT":
      return "housing";
    case "FOOD_AND_DRINK":
      return "food";
    case "TRANSPORTATION":
      return "transport";
    case "GENERAL_MERCHANDISE":
      return "shopping";
    case "ENTERTAINMENT":
      return "fun";
    case "MEDICAL":
    case "PERSONAL_CARE":
      return "health";
    case "TRAVEL":
      return "travel";
    case "GENERAL_SERVICES":
      return detailed === "GENERAL_SERVICES_AUTOMOTIVE" ? "transport" : "bills";
    default:
      return "other";
  }
}

/** Plaid's detailed INCOME category → what kind of income it is (both of Plaid's category versions). */
export function incomeKindOf(pfc: { primary: string; detailed: string } | null | undefined): IncomeKind | undefined {
  if (pfc?.primary !== "INCOME") return undefined;
  switch (pfc.detailed) {
    case "INCOME_WAGES":
    case "INCOME_SALARY":
    case "INCOME_MILITARY":
    case "INCOME_GIG_ECONOMY":
      return "pay";
    case "INCOME_INTEREST_EARNED":
      return "interest";
    case "INCOME_DIVIDENDS":
      return "dividends";
    case "INCOME_RETIREMENT_PENSION":
      return "retirement";
    case "INCOME_UNEMPLOYMENT":
    case "INCOME_LONG_TERM_DISABILITY":
      return "benefits";
    case "INCOME_TAX_REFUND":
      return "tax-refund";
    default:
      return "other";
  }
}

/**
 * Plaid's detailed category → what a tax return might ask about the payment
 * (the same names in both of Plaid's category versions). A vet is not a
 * doctor, so MEDICAL_VETERINARY_SERVICES says nothing; a political gift is
 * left to finance/taxes.ts, which reads the name.
 */
export function taxHintOf(pfc: { primary: string; detailed: string } | null | undefined): TaxHint | undefined {
  switch (pfc?.detailed) {
    case "GOVERNMENT_AND_NON_PROFIT_DONATIONS":
      return "donation";
    case "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT":
      return "tax-payment";
    case "MEDICAL_DENTAL_CARE":
    case "MEDICAL_EYE_CARE":
    case "MEDICAL_NURSING_CARE":
    case "MEDICAL_PHARMACIES_AND_SUPPLEMENTS":
    case "MEDICAL_PRIMARY_CARE":
    case "MEDICAL_OTHER_MEDICAL":
      return "medical";
    case "GENERAL_SERVICES_CHILDCARE":
      return "childcare";
    case "GENERAL_SERVICES_EDUCATION":
      return "education";
    case "LOAN_PAYMENTS_MORTGAGE_PAYMENT":
      return "mortgage";
    case "LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT":
      return "student-loan";
    default:
      return undefined;
  }
}

export function mapTransaction(t: PlaidTransaction): Transaction {
  const incomeKind = incomeKindOf(t.personal_finance_category);
  const taxHint = taxHintOf(t.personal_finance_category);
  return {
    id: t.transaction_id,
    accountId: t.account_id,
    date: t.date,
    amount: -toCents(t.amount),
    merchant: (t.merchant_name || t.name || "Unknown").trim(),
    category: mapCategory(t.personal_finance_category),
    ...(incomeKind ? { incomeKind } : {}),
    ...(taxHint ? { taxHint } : {}),
    pending: t.pending,
  };
}

/**
 * Month-end balance history for a cash or card account, reconstructed by
 * walking its transactions BACKWARDS from today's balance. Plaid gives no
 * historical balances; this is exact for the months the transactions cover.
 * Other account kinds get a flat line at today's value — the UI says so.
 */
export function reconstructHistory(balance: Cents, txns: Transaction[], today: ISODate, months = 13): Cents[] {
  const keys = lastMonths(today, months);
  const flowByMonth = new Map<string, Cents>();
  for (const t of txns) flowByMonth.set(monthKey(t.date), (flowByMonth.get(monthKey(t.date)) ?? 0) + t.amount);
  const out = new Array<Cents>(months);
  out[months - 1] = balance;
  for (let i = months - 2; i >= 0; i--) out[i] = out[i + 1]! - (flowByMonth.get(keys[i + 1]!) ?? 0);
  return out;
}

export function mapAccount(a: PlaidAccount, institutionId: string, txns: Transaction[], today: ISODate): Account {
  const kind = accountKind(a);
  const balance = signedBalance(a);
  const own = txns.filter((t) => t.accountId === a.account_id && !t.pending);
  const history =
    kind === "checking" || kind === "savings" || kind === "credit"
      ? reconstructHistory(balance, own, today)
      : new Array<Cents>(13).fill(balance);
  return {
    id: a.account_id,
    institutionId,
    name: a.name || a.official_name || "Account",
    mask: a.mask,
    kind,
    balance,
    history,
    source: "plaid",
  };
}

export function assetClass(type: string | null | undefined): AssetClass {
  switch ((type ?? "").toLowerCase()) {
    case "fixed income":
      return "Bonds";
    case "cash":
      return "Cash";
    case "cryptocurrency":
      return "Crypto";
    default:
      return "US stocks";
  }
}

export function mapHoldings(holdings: PlaidHolding[], securities: PlaidSecurity[]): Holding[] {
  const bySecurity = new Map(securities.map((s) => [s.security_id, s]));
  return holdings.map((h) => {
    const s = bySecurity.get(h.security_id);
    return {
      symbol: s?.ticker_symbol ?? (s?.name ?? "—").slice(0, 6).toUpperCase(),
      name: s?.name ?? "Holding",
      assetClass: assetClass(s?.type),
      value: toCents(h.institution_value),
      costBasis: toCents(h.cost_basis ?? h.institution_value),
      accountId: h.account_id,
    };
  });
}

// Drafting budgets from history lives with the budgets; kept importable here for the bank mapping's tests.
export { suggestedLimit } from "@/lib/finance/budgets";

