// src/lib/finance/integrations.ts
//
// What Prism can connect to, and honestly how. Each entry records the real
// access path as researched in September 2026 (docs/research-2026-09-27.md),
// so the Connections screen never promises an integration that has no API
// behind it.

export type IntegrationStatus = "live" | "planned" | "partner" | "limited";

export type Integration = {
  id: string;
  name: string;
  adds: string;
  how: string;
  status: IntegrationStatus;
};

export type IntegrationGroup = { title: string; icon: string; items: Integration[] };

export const INTEGRATIONS: IntegrationGroup[] = [
  {
    title: "Banks & cards",
    icon: "landmark",
    items: [
      {
        id: "plaid",
        name: "12,000+ US banks and card issuers",
        adds: "Checking, savings, credit cards and loans, with up to two years of transactions.",
        how: "Plaid Link — you sign in on your bank's own screen; Prism never sees your password.",
        status: "live",
      },
      {
        id: "due-dates",
        name: "Card and loan due dates",
        adds: "When each card and loan is due, its minimum and statement balance, on Future, Net worth and your calendar.",
        how: "Plaid Liabilities, from the same bank link: the lender's own terms, read at most once a day.",
        status: "planned",
      },
      {
        id: "fallback",
        name: "A backup connection for every bank",
        adds: "When one connection breaks, a second takes over, so your numbers don't go stale.",
        how: "Finicity or MX as a fallback aggregator — the same pattern Monarch and Copilot use.",
        status: "planned",
      },
      {
        id: "apple",
        name: "Apple Card, Apple Cash & Savings",
        adds: "The accounts that other aggregators can't reach.",
        how: "Apple FinanceKit in the iPhone app (US only, requires Apple's approval).",
        status: "planned",
      },
    ],
  },
  {
    title: "Investing",
    icon: "trending-up",
    items: [
      {
        id: "plaid-investments",
        name: "Brokerage & retirement accounts",
        adds: "Holdings, balances and what they're made of — the treemap on Net worth.",
        how: "Plaid Investments, requested in the same bank link when your institution supports it.",
        status: "live",
      },
      {
        id: "snaptrade",
        name: "Robinhood, Fidelity and app-first brokers",
        adds: "Read-only positions from brokers that aggregators cover poorly.",
        how: "SnapTrade's read-only brokerage API.",
        status: "planned",
      },
      {
        id: "coinbase",
        name: "Coinbase",
        adds: "Crypto balances alongside everything else.",
        how: "Sign in on Coinbase and approve read-only access to balances (nothing that can send, buy or sell).",
        status: "planned",
      },
      {
        id: "wallets",
        name: "Crypto wallets you hold yourself",
        adds: "Bitcoin, Ethereum and Solana in your net worth, by public address, and whole Bitcoin wallets.",
        how: "Add a wallet's public address, or a Bitcoin wallet's extended public key (xpub) to see every address in it: Prism reads what it holds (Bitcoin through mempool.space, Ethereum and Solana through Alchemy) and can never move it. Nothing to sign, and no recovery phrase, ever.",
        status: "live",
      },
    ],
  },
  {
    title: "What you own",
    icon: "house",
    items: [
      {
        id: "home",
        name: "Your home's value",
        adds: "An automatic estimate so net worth includes your biggest asset.",
        how: "RentCast's automated valuation, about once a month, for a home you add on Net worth with its address.",
        status: "planned",
      },
      {
        id: "vehicle",
        name: "Your car's value",
        adds: "A market value from the VIN, refreshed monthly.",
        how: "VIN-based valuation (VinAudit).",
        status: "planned",
      },
    ],
  },
  {
    title: "Credit & income",
    icon: "gauge",
    items: [
      {
        id: "credit",
        name: "Credit score and what moves it",
        adds: "Your score, its history and the five factors behind it.",
        how: "A bureau partner such as Experian Connect or SavvyMoney. Credit Karma has no third-party data API.",
        status: "partner",
      },
      {
        id: "payroll",
        name: "Paycheck details",
        adds: "Forecasts that know your exact payday and take-home pay.",
        how: "Found from the deposits in your linked accounts: who pays you, how often, what lands and your next payday, moved before weekends and bank holidays. No payroll login.",
        status: "live",
      },
      {
        id: "p2p",
        name: "Venmo, PayPal and Cash App",
        adds: "Who a transfer was really for, not just \"Venmo\".",
        how: "None offer a public consumer-data API. Transfers appear through your linked bank today.",
        status: "limited",
      },
    ],
  },
  {
    title: "Everyday tools",
    icon: "sparkles",
    items: [
      {
        id: "calendar",
        name: "Bill reminders in your calendar",
        adds: "Paydays and bills on Google Calendar, Apple Calendar or Outlook, with an alert before each one.",
        how: "Add to calendar on the Future screen: every bill becomes one repeating event. Download again to refresh the amounts.",
        status: "live",
      },
      {
        id: "csv",
        name: "Import history from Mint, Monarch or a spreadsheet",
        adds: "Years of history on day one.",
        how: "Choose the CSV file, match its columns and say which account each part belongs to. The file is read in your browser and never uploaded.",
        status: "live",
      },
      {
        id: "mcp",
        name: "Ask your AI assistant about your money",
        adds: "\"How much did we spend on takeout this summer?\" — answered with the transactions cited.",
        how: "Connect Claude or ChatGPT from your Account page and approve it on Prism's own screen. It can only read, and you can disconnect it at any time.",
        status: "live",
      },
    ],
  },
];
