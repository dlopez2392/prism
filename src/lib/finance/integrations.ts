// apps/finance/src/lib/finance/integrations.ts
//
// What Prism can connect to, and honestly how. Each entry records the real
// access path as researched in September 2026 (docs/research/
// 2026-09-27-personal-finance-app-research.md), so the Connections screen
// never promises an integration that has no API behind it.

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
        name: "Coinbase and crypto wallets",
        adds: "Crypto balances alongside everything else.",
        how: "Coinbase sign-in with read-only access; self-custody wallets by public address — nothing to sign.",
        status: "planned",
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
        how: "A property-data provider (ATTOM or Estated). Zillow closed its public API in 2021.",
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
        how: "A payroll-data provider (Plaid Income, Argyle or Pinwheel), with your permission.",
        status: "partner",
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
        adds: "Paydays and bills on Google Calendar, Apple Calendar or Outlook.",
        how: "A private calendar feed (ICS), or the Google Calendar API.",
        status: "planned",
      },
      {
        id: "csv",
        name: "Import history from Mint, Monarch or a spreadsheet",
        adds: "Years of history on day one.",
        how: "CSV import, parsed in your browser.",
        status: "planned",
      },
      {
        id: "mcp",
        name: "Ask your AI assistant about your money",
        adds: "\"How much did we spend on takeout this summer?\" — answered with the transactions cited.",
        how: "A read-only MCP server you can connect to Claude or any MCP-compatible assistant.",
        status: "planned",
      },
    ],
  },
];
