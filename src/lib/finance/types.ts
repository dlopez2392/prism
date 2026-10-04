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

export type DataSource = "demo" | "plaid" | "coinbase" | "manual" | "import" | "wallet";

export type Institution = {
  id: string;
  name: string;
  /** Status of the live connection; drives the Connections health screen. */
  health: "healthy" | "syncing" | "needs_attention";
  /** Needs the person to sign in at the source again (a changed password, an expired consent); only they can fix it. */
  signInAgain?: true;
  /** When the bank stops updating unless its owner signs in again (Plaid's week-ahead warning), as an ISO time. */
  disconnectsAt?: string;
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
  /** A card's or a loan's own terms, from the lender (Plaid Liabilities), when Prism reads them. */
  liability?: Liability;
};

/** What a card or a loan asks for next. Amounts are what's owed, as positive cents. */
export type Liability = {
  /** The next payment's due date; null once it has passed or when the lender doesn't say. */
  dueDate: ISODate | null;
  minimumPayment: Cents | null;
  /** The last statement's balance: what pays the card off without interest. */
  statementBalance: Cents | null;
  /** The purchase APR on a card, the interest rate on a loan, as a percentage. */
  apr: number | null;
  overdue: boolean;
};

/** What kind of money an income transaction is, when the bank says (Plaid's detailed category). */
export type IncomeKind = "pay" | "interest" | "dividends" | "retirement" | "benefits" | "tax-refund" | "other";

/** What a tax return might ask about a payment, when the bank's own category says (finance/taxes.ts reads the name otherwise). */
export type TaxHint = "donation" | "tax-payment" | "medical" | "childcare" | "education" | "mortgage" | "student-loan";

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
  /** Income only, when the bank says what kind (finance/income.ts reads the name otherwise). */
  incomeKind?: IncomeKind;
  /** Money out a tax return might ask about, when the bank's category says so (finance/taxes.ts). */
  taxHint?: TaxHint;
  /** Who a Venmo, PayPal or Cash App payment was for, from the person's own file of that app (finance/p2p.ts). */
  p2p?: P2pNote;
  /** One part of a line the person split across categories: which line, which part, and the whole line's amount (finance/details.ts). */
  split?: { of: string; part: number; parts: number; total: Cents };
  /** The person's own tags ("Vacation 2026"). */
  tags?: string[];
  /** Someone owes the person for this, until they mark it paid back. */
  owed?: Owed;
  pending: boolean;
};

/** Who owes the person for a transaction, how much, and the day they marked it paid back (null while it's open). */
export type Owed = { who: string; amount: Cents; paid: ISODate | null };

export type P2pApp = "venmo" | "paypal" | "cashapp";
/** "To Alex", "From Alex", or money moved between the app and the bank. */
export type P2pDirection = "to" | "from" | "transfer";
/** What a bank line gains: which app, who it was for, what they wrote, and the day the app recorded it. */
export type P2pNote = { app: P2pApp; dir: P2pDirection; name: string; note: string | null; date: ISODate };

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
  /**
   * The account whose balance IS what's saved, when the goal follows one:
   * `saved` and `history` then come from it, and `saved` as stored is only
   * the last amount known, shown if the account goes away.
   */
  accountId?: string;
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
