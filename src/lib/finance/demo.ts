// src/lib/finance/demo.ts
//
// The demo household: thirteen months of one believable person's money,
// generated from a fixed seed relative to `today`. It exists so every chart has
// something true-to-life to draw before a bank is connected, and so the unit
// suite has a realistic fixture. The same `today` always yields the same data.
//
// Every institution and merchant name is fictional.
//
// The story the data tells (so the insights have something to find):
//   - Alex is paid every other Friday, and got a raise four months ago.
//   - Rent is due on the 1st; most daily spending goes on the credit card, which
//     is paid in full from checking on the 18th.
//   - Streamflix raised its price two months ago.
//   - There were two trips this year, eight and three months ago.
//   - $900 a month moves to savings and $450 to the brokerage account.

import { addDays, addMonths, daysInMonth, dayOfWeek, monthKey, startOfMonth } from "./dates";
import type {
  Account,
  Budget,
  CategoryId,
  Cents,
  CreditScore,
  FinanceData,
  Goal,
  Holding,
  Institution,
  ISODate,
  Transaction,
} from "./types";

const SEED = 0x5eed_2026;

/** mulberry32 — tiny, fast, and deterministic across engines. */
function makeRng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    chance: (p: number) => next() < p,
    /** Whole cents in [lo, hi] dollars. */
    cents: (lo: number, hi: number) => Math.round((lo + next() * (hi - lo)) * 100),
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T,>(items: readonly T[]) => items[Math.floor(next() * items.length)]!,
  };
}

const RESTAURANTS = [
  "Taqueria Luna",
  "Pho Real",
  "Sakura Sushi Bar",
  "The Burger Joint",
  "Bella Pasta",
  "Thai Orchid",
  "Olive & Ember Grill",
] as const;

const ACCOUNT_IDS = {
  checking: "demo-chk",
  savings: "demo-sav",
  card: "demo-card",
  brokerage: "demo-brk",
  retirement: "demo-ret",
  crypto: "demo-crypto",
  car: "demo-car",
  autoLoan: "demo-auto",
  studentLoan: "demo-student",
} as const;

export function buildDemoData(today: ISODate): FinanceData {
  const rng = makeRng(SEED);
  const txns: Transaction[] = [];
  let seq = 0;
  const add = (
    accountId: string,
    date: ISODate,
    amount: Cents,
    merchant: string,
    category: CategoryId,
  ) => {
    txns.push({
      id: `demo-${++seq}`,
      accountId,
      date,
      amount,
      merchant,
      category,
      pending: accountId === ACCOUNT_IDS.card && date > addDays(today, -2),
    });
  };

  const thisMonth = startOfMonth(today);
  const first = addMonths(thisMonth, -12);
  const cardSpendByMonth = new Map<string, Cents>();
  const { checking: chk, savings: sav, card, brokerage: brk } = ACCOUNT_IDS;
  const onCard = (date: ISODate, amount: Cents, merchant: string, category: CategoryId) => {
    add(card, date, amount, merchant, category);
    const key = monthKey(date);
    cardSpendByMonth.set(key, (cardSpendByMonth.get(key) ?? 0) + amount);
  };

  // Paydays: every other Friday, anchored on the first Friday of the range.
  let payday = first;
  while (dayOfWeek(payday) !== 5) payday = addDays(payday, 1);
  const paydays = new Set<ISODate>();
  for (let d = payday; d <= today; d = addDays(d, 14)) paydays.add(d);

  for (let offset = -12; offset <= 0; offset++) {
    const month = addMonths(thisMonth, offset);
    const days = daysInMonth(month);
    const monthNum = Number(month.slice(5, 7));
    const freelanceDays = new Set(
      Array.from({ length: rng.int(0, 2) }, () => rng.int(3, days - 2)),
    );
    const tripMonth = offset === -8 || offset === -3;

    for (let dom = 1; dom <= days; dom++) {
      const date = addDays(month, dom - 1);
      if (date > today) break;
      const dow = dayOfWeek(date);
      const weekend = dow === 0 || dow === 6;

      // ── Income ──────────────────────────────────────────────────────────
      if (paydays.has(date)) {
        add(chk, date, offset >= -4 ? 298_140 : 286_418, "Lumen Design Co. payroll", "income");
      }
      if (freelanceDays.has(dom)) {
        add(chk, date, rng.cents(240, 880), "Studio Kiln — client payment", "income");
      }
      if (dom === days) add(sav, date, rng.cents(54, 71), "Interest earned", "income");

      // ── Fixed monthly obligations (checking) ────────────────────────────
      if (dom === 1) add(chk, date, -195_000, "Maple Court Apartments", "housing");
      if (dom === 5) add(chk, date, -1_800, "Nestwell Renters Insurance", "housing");
      if (dom === 8) add(chk, date, -12_800, "Guardline Auto Insurance", "transport");
      if (dom === 12) {
        const seasonal = monthNum >= 6 && monthNum <= 8 ? 58 : monthNum <= 2 || monthNum === 12 ? 26 : 0;
        add(chk, date, -rng.cents(68 + seasonal, 84 + seasonal), "Bright Power & Light", "bills");
      }
      if (dom === 14) add(chk, date, -38_900, "Harbor Auto Finance payment", "transport");
      if (dom === 25) add(chk, date, -21_000, "Federal student loan payment", "bills");

      // ── Moving money between Alex's own accounts (transfers) ────────────
      if (dom === 2) {
        add(chk, date, -90_000, "Transfer to High-Yield Savings", "transfer");
        add(sav, date, 90_000, "Transfer from Everyday Checking", "transfer");
      }
      if (dom === 16) {
        add(chk, date, -45_000, "Transfer to Evergreen Brokerage", "transfer");
        add(brk, date, 45_000, "Transfer from Everyday Checking", "transfer");
      }
      if (dom === 18) {
        const statement = offset === -12 ? -182_400 : cardSpendByMonth.get(monthKey(addMonths(month, -1))) ?? 0;
        if (statement < 0) {
          add(chk, date, statement, "Summit Card payment", "transfer");
          add(card, date, -statement, "Payment — thank you", "transfer");
        }
      }

      // ── Subscriptions (card) ────────────────────────────────────────────
      if (dom === 1) onCard(date, -4_500, "FitClub Gym", "health");
      if (dom === 3) onCard(date, -1_199, "Tunely Music", "fun");
      if (dom === 9) onCard(date, -299, "CloudBox Storage", "bills");
      if (dom === 15) onCard(date, -7_000, "Fiberly Internet", "bills");
      if (dom === 20) onCard(date, -5_500, "Pulse Mobile", "bills");
      if (dom === 22) onCard(date, offset >= -1 ? -1_799 : -1_549, "Streamflix", "fun");

      // ── Everyday spending (card) ────────────────────────────────────────
      if (weekend && rng.chance(0.55)) onCard(date, -rng.cents(58, 146), "Green Basket Market", "food");
      if (rng.chance(0.12)) onCard(date, -rng.cents(7, 26), "Corner Grocer", "food");
      if (!weekend && rng.chance(0.42)) onCard(date, -rng.cents(4.5, 7.8), "Bean There Café", "food");
      const dineOdds = dow === 5 || dow === 6 ? 0.55 : 0.2;
      if (rng.chance(dineOdds)) onCard(date, -rng.cents(14, 64), rng.pick(RESTAURANTS), "food");
      if (rng.chance(0.09)) onCard(date, -rng.cents(22, 48), "QuickEats delivery", "food");

      if (rng.chance(0.12)) onCard(date, -rng.cents(36, 62), "Fuel Stop", "transport");
      if (!weekend && rng.chance(0.3)) onCard(date, -275, "Metro Transit", "transport");
      if (rng.chance(0.08)) onCard(date, -rng.cents(12, 34), "Hopr Rides", "transport");
      if (rng.chance(0.03)) onCard(date, -rng.cents(8, 22), "CityPark Garage", "transport");

      if (rng.chance(0.15)) onCard(date, -rng.cents(12, 118), "Everything Store", "shopping");
      if (rng.chance(0.04)) onCard(date, -rng.cents(35, 120), "Threadline Apparel", "shopping");
      if (rng.chance(0.03)) onCard(date, -rng.cents(20, 90), "Home Nest", "shopping");
      if (rng.chance(0.008)) onCard(date, -rng.cents(90, 420), "Tech Hub", "shopping");

      if (rng.chance(0.05)) onCard(date, -rng.cents(14, 32), "Cinema 8", "fun");
      if ((dow === 5 || dow === 6) && rng.chance(0.22)) onCard(date, -rng.cents(18, 56), "The Copper Tap", "fun");
      if (rng.chance(0.02)) onCard(date, -rng.cents(60, 180), "Ticketburst", "fun");
      if (rng.chance(0.02)) onCard(date, -rng.cents(20, 70), "Game Vault", "fun");

      if (rng.chance(0.05)) onCard(date, -rng.cents(10, 45), "Wellcare Pharmacy", "health");
      if (dom === 11 && (offset === -10 || offset === -4)) onCard(date, -rng.cents(40, 120), "Brightside Dental", "health");

      if (dom === 19 && rng.chance(0.9)) add(chk, date, -2_500, "Riverside Food Bank", "other");
      if (rng.chance(0.012)) add(chk, date, -6_000, "ATM withdrawal", "other");

      // ── Trips ───────────────────────────────────────────────────────────
      if (tripMonth) {
        if (dom === 3) onCard(date, offset === -8 ? -41_200 : -28_600, "SkyJet Airlines", "travel");
        if (dom === 12) onCard(date, offset === -8 ? -63_800 : -54_000, offset === -8 ? "Harborview Hotel" : "StayNest rentals", "travel");
        if (dom >= 10 && dom <= 14) onCard(date, -rng.cents(24, 78), "Local eats (travel)", "travel");
      }
    }
  }

  txns.sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date < b.date ? -1 : 1));

  // ── Balances ─────────────────────────────────────────────────────────────
  // Cash accounts are DERIVED from their transactions, so the forecast, the
  // cash-flow chart and the balance agree to the cent.
  const monthEnds = Array.from({ length: 13 }, (_, i) => {
    const m = addMonths(first, i);
    const end = addDays(addMonths(m, 1), -1);
    return end > today ? today : end;
  });
  const derived = (accountId: string, opening: Cents) =>
    monthEnds.map((end) =>
      txns.reduce((sum, t) => (t.accountId === accountId && t.date <= end ? sum + t.amount : sum), opening),
    );

  const walk = (start: number, end: number, vol: number, seed: number) => {
    const r = makeRng(SEED ^ seed);
    const out: Cents[] = [];
    for (let i = 0; i < 13; i++) {
      const base = start + ((end - start) * i) / 12;
      const noise = i === 0 || i === 12 ? 0 : (r.next() - 0.5) * 2 * vol * base;
      out.push(Math.round(base + noise));
    }
    return out;
  };

  const synced = `${today}T08:14:00Z`;
  const institutions: Institution[] = [
    { id: "northwind", name: "Northwind Bank", health: "healthy", lastSyncedAt: synced, source: "demo" },
    { id: "summit", name: "Summit Card", health: "healthy", lastSyncedAt: synced, source: "demo" },
    { id: "evergreen", name: "Evergreen Investments", health: "healthy", lastSyncedAt: synced, source: "demo" },
    { id: "beacon", name: "Beacon Crypto", health: "needs_attention", lastSyncedAt: `${addDays(today, -6)}T19:02:00Z`, source: "demo" },
    { id: "harbor", name: "Harbor Auto Finance", health: "syncing", lastSyncedAt: `${addDays(today, -1)}T22:40:00Z`, source: "demo" },
    { id: "manual", name: "Added by you", health: "healthy", lastSyncedAt: null, source: "manual" },
  ];

  const acct = (
    id: string,
    institutionId: string,
    name: string,
    mask: string | null,
    kind: Account["kind"],
    history: Cents[],
    source: Account["source"] = "demo",
  ): Account => ({ id, institutionId, name, mask, kind, history, balance: history.at(-1)!, source });

  const accounts: Account[] = [
    acct(chk, "northwind", "Everyday Checking", "4821", "checking", derived(chk, 150_000)),
    acct(sav, "northwind", "High-Yield Savings", "9310", "savings", derived(sav, 820_000)),
    acct(card, "summit", "Summit Rewards Visa", "1107", "credit", derived(card, -182_400)),
    acct(ACCOUNT_IDS.brokerage, "evergreen", "Individual Brokerage", "5520", "investment", walk(3_780_000, 4_412_000, 0.035, 11)),
    acct(ACCOUNT_IDS.retirement, "evergreen", "401(k)", "7781", "retirement", walk(5_420_000, 6_186_000, 0.03, 23)),
    acct(ACCOUNT_IDS.crypto, "beacon", "Crypto wallet", "0x9f…c21", "crypto", walk(240_000, 391_000, 0.22, 37)),
    acct(ACCOUNT_IDS.car, "manual", "2021 Crossover SUV", null, "property", walk(2_180_000, 1_942_000, 0.004, 41), "manual"),
    acct(ACCOUNT_IDS.autoLoan, "harbor", "Auto loan", "3302", "loan", walk(-1_530_000, -1_118_000, 0, 53)),
    acct(ACCOUNT_IDS.studentLoan, "northwind", "Student loan", "6614", "loan", walk(-1_690_000, -1_472_000, 0, 59)),
  ];

  const balanceOf = (id: string) => accounts.find((a) => a.id === id)!.balance;
  const split = (accountId: string, parts: [string, string, Holding["assetClass"], number][]): Holding[] => {
    const total = balanceOf(accountId);
    const weight = parts.reduce((s, p) => s + p[3], 0);
    let allotted = 0;
    return parts.map(([symbol, name, assetClass, w], i) => {
      const value = i === parts.length - 1 ? total - allotted : Math.round((total * w) / weight);
      allotted += value;
      return { symbol, name, assetClass, value, costBasis: Math.round(value * (0.78 + (i % 3) * 0.08)), accountId };
    });
  };

  const holdings: Holding[] = [
    ...split(ACCOUNT_IDS.brokerage, [
      ["VTI", "Total US Stock Market ETF", "US stocks", 48],
      ["VXUS", "Total International Stock ETF", "International", 19],
      ["BND", "Total Bond Market ETF", "Bonds", 12],
      ["AAPL", "Apple Inc.", "US stocks", 9],
      ["MSFT", "Microsoft Corp.", "US stocks", 8],
      ["CASH", "Cash sweep", "Cash", 4],
    ]),
    ...split(ACCOUNT_IDS.retirement, [
      ["FXAIX", "S&P 500 Index Fund", "US stocks", 61],
      ["FTIHX", "International Index Fund", "International", 24],
      ["FXNAX", "US Bond Index Fund", "Bonds", 15],
    ]),
    ...split(ACCOUNT_IDS.crypto, [
      ["BTC", "Bitcoin", "Crypto", 69],
      ["ETH", "Ethereum", "Crypto", 31],
    ]),
  ];

  const budgets: Budget[] = [
    { category: "housing", limit: 200_000 },
    { category: "food", limit: 105_000 },
    { category: "transport", limit: 75_000 },
    { category: "shopping", limit: 32_500 },
    { category: "fun", limit: 30_000 },
    { category: "health", limit: 12_000 },
    { category: "travel", limit: 20_000 },
    { category: "bills", limit: 45_000 },
    { category: "other", limit: 8_000 },
  ];

  const goal = (
    id: string,
    name: string,
    emoji: string,
    target: Cents,
    saved: Cents,
    monthly: Cents,
    monthsOut: number,
    colorSlot: number,
  ): Goal => ({
    id,
    name,
    emoji,
    target,
    saved,
    monthlyContribution: monthly,
    // The last day of the target month: "by March" means by March 31.
    targetDate: addDays(addMonths(thisMonth, monthsOut + 1), -1),
    colorSlot,
    history: Array.from({ length: 13 }, (_, i) => Math.max(0, saved - monthly * (12 - i))),
  });

  const goals: Goal[] = [
    goal("emergency", "Emergency fund", "🛟", 1_800_000, 980_000, 45_000, 20, 4),
    goal("japan", "Japan trip", "🗾", 650_000, 312_000, 35_000, 7, 2),
    goal("laptop", "New laptop", "💻", 240_000, 198_000, 15_000, 3, 3),
    goal("home", "Home down payment", "🏡", 6_000_000, 1_140_000, 60_000, 60, 1),
  ];

  const credit: CreditScore = {
    score: 742,
    history: [708, 711, 709, 716, 719, 722, 726, 725, 731, 734, 738, 742],
    provider: "Demo credit report",
    factors: [
      { name: "Payment history", rating: "excellent", detail: "100% on-time across 9 accounts" },
      { name: "Card utilisation", rating: "good", detail: "14% of your limits in use" },
      { name: "Credit age", rating: "fair", detail: "Average account age 5 years, 8 months" },
      { name: "Credit mix", rating: "good", detail: "Cards, an auto loan and a student loan" },
      { name: "New credit", rating: "excellent", detail: "No hard inquiries in two years" },
    ],
  };

  return {
    source: "demo",
    today,
    household: { name: "Alex Rivera", firstName: "Alex" },
    institutions,
    accounts,
    transactions: txns,
    budgets,
    goals,
    holdings,
    credit,
  };
}
