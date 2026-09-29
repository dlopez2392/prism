// src/lib/finance/types.ts
//
// The provider-neutral domain model. Every data source — the demo household,
// Plaid, and any future aggregator (Finicity, MX) or direct link (Coinbase,
// Apple FinanceKit) — maps onto these shapes, and every screen reads only
// these shapes. That seam is what lets a second aggregator be added as a
// fallback without touching a chart.
//
// Money is ALWAYS integer cents. Dates are ALWAYS ISO calendar dates
// ("YYYY-MM-DD") in the account holder's own calendar; nothing here carries a
// time or a zone, so a server in UTC and a phone in Honolulu agree on which
// day a coffee was bought.

export type ISODate = string;
export type Cents = number;

export type CategoryId =
  | "housing"
  | "food"
  | "transport"
  | "shopping"
  | "fun"
  | "health"
  | "travel"
  | "bills"
  | "other"
  | "income"
  | "transfer";

/** Categories that count as spending. Income and transfers never do. */
export type SpendCategoryId = Exclude<CategoryId, "income" | "transfer">;

export type AccountKind =
  | "checking"
  | "savings"
  | "credit"
  | "investment"
  | "retirement"
  | "crypto"
  | "loan"
  | "property";

export type DataSource = "demo" | "plaid" | "coinbase" | "manual";

export type Institution = {
  id: string;
  name: string;
  /** Status of the live connection; drives the Connections health screen. */
  health: "healthy" | "syncing" | "needs_attention";
  lastSyncedAt: string | null;
  source: DataSource;
};

export type Account = {
  id: string;
  institutionId: string;
  name: string;
  mask: string | null;
  kind: AccountKind;
  /** Signed: assets positive, debts negative. */
  balance: Cents;
  /** Month-end balances, oldest first, ending with the current balance. */
  history: Cents[];
  source: DataSource;
};

export type Transaction = {
  id: string;
  accountId: string;
  date: ISODate;
  /** Signed: money in is positive, money out is negative. */
  amount: Cents;
  merchant: string;
  category: CategoryId;
  /** The bank's own category, kept when the person fixed it to `category` (finance/category-rules.ts). */
  bankCategory?: CategoryId;
  pending: boolean;
};

export type Budget = {
  category: SpendCategoryId;
  /** Monthly limit in cents. */
  limit: Cents;
};

export type Goal = {
  id: string;
  name: string;
  emoji: string;
  target: Cents;
  saved: Cents;
  monthlyContribution: Cents;
  targetDate: ISODate;
  /** Month-end saved amounts, oldest first, ending with `saved`. */
  history: Cents[];
  colorSlot: number;
};

export type AssetClass = "US stocks" | "International" | "Bonds" | "Cash" | "Crypto" | "Real estate";

export type Holding = {
  symbol: string;
  name: string;
  assetClass: AssetClass;
  value: Cents;
  costBasis: Cents;
  accountId: string;
};

export type CreditScore = {
  score: number;
  /** Monthly scores, oldest first. */
  history: number[];
  factors: { name: string; rating: "excellent" | "good" | "fair" | "poor"; detail: string }[];
  provider: string;
};

export type Household = {
  name: string;
  firstName: string;
};

/** Everything a screen can ask for, from whichever source is live. */
export type FinanceData = {
  source: DataSource;
  today: ISODate;
  household: Household;
  institutions: Institution[];
  accounts: Account[];
  transactions: Transaction[];
  budgets: Budget[];
  goals: Goal[];
  holdings: Holding[];
  credit: CreditScore | null;
};
