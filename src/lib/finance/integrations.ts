// src/lib/finance/integrations.ts
//
// What Prism can connect to, and honestly how. Each entry records the real
// access path as researched in September 2026 (docs/research-2026-09-27.md),
// so the Connections screen never promises an integration that has no API
// behind it.
//
// Every word here is English, marked with msg() where it's written and
// translated with t() where Connections shows it. A brand's own name
// ("Coinbase", "Apple Card, Apple Cash & Savings") stays as it is.

import { msg } from "@/lib/i18n/t";

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
    title: msg("Banks & cards"),
    icon: "landmark",
    items: [
      {
        id: "plaid",
        name: msg("12,000+ US banks and card issuers"),
        adds: msg("Checking, savings, credit cards and loans, with up to two years of transactions."),
        how: msg("Plaid Link — you sign in on your bank's own screen; Prism never sees your password."),
        status: "live",
      },
      {
        id: "due-dates",
        name: msg("Card and loan due dates"),
        adds: msg("When each card and loan is due, its minimum and statement balance, on Future, Net worth and your calendar."),
        how: msg("Plaid Liabilities, from the same bank link: the lender's own terms, read at most once a day."),
        status: "planned",
      },
      {
        id: "fallback",
        name: msg("A backup connection for every bank"),
        adds: msg("When one connection breaks, a second takes over, so your numbers don't go stale."),
        how: msg("Finicity or MX as a fallback aggregator — the same pattern Monarch and Copilot use."),
        status: "planned",
      },
      {
        id: "apple",
        name: "Apple Card, Apple Cash & Savings",
        adds: msg("The accounts that other aggregators can't reach."),
        how: msg("Apple FinanceKit in the iPhone app (US only, requires Apple's approval)."),
        status: "planned",
      },
    ],
  },
  {
    title: msg("Investing"),
    icon: "trending-up",
    items: [
      {
        id: "plaid-investments",
        name: msg("Brokerage & retirement accounts"),
        adds: msg("Holdings, balances and what they're made of — the treemap on Net worth."),
        how: msg("Plaid Investments: with your bank when it holds investments, or on its own with Connect an investment account, the way Robinhood, Webull, Vanguard, E*TRADE, Schwab and most US brokers connect."),
        status: "live",
      },
      {
        id: "snaptrade",
        name: msg("Brokers Plaid can't reach"),
        adds: msg("Read-only positions from a broker Plaid doesn't cover, if people ask for one."),
        how: msg("SnapTrade's read-only brokerage API, which reaches some brokers Plaid doesn't."),
        status: "planned",
      },
      {
        id: "coinbase",
        name: "Coinbase",
        adds: msg("Crypto balances alongside everything else."),
        how: msg("Sign in on Coinbase and approve read-only access to balances (nothing that can send, buy or sell)."),
        status: "planned",
      },
      {
        id: "wallets",
        name: msg("Crypto wallets you hold yourself"),
        adds: msg("Bitcoin, Ethereum and Solana in your net worth, by public address, and whole Bitcoin wallets."),
        how: msg("Add a wallet's public address, or a Bitcoin wallet's extended public key (xpub) to see every address in it: Prism reads what it holds (Bitcoin through mempool.space, Ethereum and Solana through Alchemy) and can never move it. Nothing to sign, and no recovery phrase, ever."),
        status: "live",
      },
    ],
  },
  {
    title: msg("What you own"),
    icon: "house",
    items: [
      {
        id: "home",
        name: msg("Your home's value"),
        adds: msg("An automatic estimate so net worth includes your biggest asset."),
        how: msg("RentCast's automated valuation, about once a month, for a home you add on Net worth with its address."),
        status: "planned",
      },
      {
        id: "vehicle",
        name: msg("Your car's value"),
        adds: msg("A market value from the VIN, refreshed monthly."),
        how: msg("VIN-based valuation (VinAudit). Until then, add your car on Net worth and update its value whenever you like."),
        status: "planned",
      },
    ],
  },
  {
    title: msg("Credit & income"),
    icon: "gauge",
    items: [
      {
        id: "credit",
        name: msg("Credit score and what moves it"),
        adds: msg("Your score, its history and the five factors behind it."),
        how: msg("A bureau partner such as Experian Connect or SavvyMoney. Credit Karma has no third-party data API."),
        status: "partner",
      },
      {
        id: "payroll",
        name: msg("Paycheck details"),
        adds: msg("Forecasts that know your exact payday and take-home pay."),
        how: msg("Found from the deposits in your linked accounts: who pays you, how often, what lands and your next payday, moved before weekends and bank holidays. No payroll login."),
        status: "live",
      },
      {
        id: "p2p",
        name: msg("Venmo, PayPal and Cash App"),
        adds: msg("Who each payment was really for, and its note, not just \"Venmo\"."),
        how: msg("None lets another app read your account, so you add each app's own activity file. Prism reads it in your browser, never uploads it, and puts each payment's name and note on the bank line it matches."),
        status: "live",
      },
      {
        id: "amazon",
        name: msg("Amazon orders"),
        adds: msg("What each Amazon charge paid for, item by item, not just \"AMZN Mktp\", and a split by its items."),
        how: msg("Amazon doesn't let another app read your orders, so you ask Amazon for your own order history and add the file. Prism reads it in your browser, never uploads it, and puts each shipment's items on the charge it matches, to the cent."),
        status: "live",
      },
    ],
  },
  {
    title: msg("Everyday tools"),
    icon: "sparkles",
    items: [
      {
        id: "calendar",
        name: msg("Bill reminders in your calendar"),
        adds: msg("Paydays and bills on Google Calendar, Apple Calendar or Outlook, with an alert before each one."),
        how: msg("Add to calendar on the Future screen: every bill becomes one repeating event. Download again to refresh the amounts."),
        status: "live",
      },
      {
        id: "csv",
        name: msg("Import history from Mint, Monarch or a spreadsheet"),
        adds: msg("Years of history on day one."),
        how: msg("Choose the CSV file, match its columns and say which account each part belongs to. The file is read in your browser and never uploaded."),
        status: "live",
      },
      {
        id: "mcp",
        name: msg("Ask your AI assistant about your money"),
        adds: msg("\"How much did we spend on takeout this summer?\" — answered with the transactions cited."),
        how: msg("Connect Claude or ChatGPT from your Account page and approve it on Prism's own screen. It can only read, and you can disconnect it at any time."),
        status: "live",
      },
    ],
  },
];
