// src/lib/agent/mcp.ts
//
// Prism as an MCP server: nine read-only tools over the person's money, for
// Claude, ChatGPT or any MCP client they connect. The data is loaded lazily,
// once per request, by the loader the endpoint passes in — a tool list or a
// handshake never touches a bank.

import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { BRAND } from "@/lib/brand";
import {
  budgets,
  cashFlow,
  CATEGORY_IDS,
  goals,
  listAccounts,
  netWorth,
  overview,
  searchTransactions,
  SEARCH_LIMIT_MAX,
  SPEND_CATEGORY_HELP,
  spendingBreakdown,
  upcomingBills,
  type AgentData,
} from "./tools";

export const MCP_VERSION = "1.0.0";

export const INSTRUCTIONS = `${BRAND.product} is the user's personal finance app. These tools are READ-ONLY: they show balances, transactions, spending, budgets, savings goals, upcoming bills and net worth, and they cannot move money or change anything in ${BRAND.product}.

- Amounts are US dollars. In transactions, money out is negative and money in is positive.
- Dates are the user's own calendar; each result says which day "today" is (as_of) and in which time zone.
- For a broad question ("how am I doing?") start with get_overview; reach for the other tools for detail.
- When an answer rests on particular transactions, cite them — merchant, date and amount. Their ids are stable.
- If a result says demo: true, the money is ${BRAND.product}'s example household, NOT the user's. Say so plainly, and suggest linking a bank in ${BRAND.product}.
- If a result carries a notice (a bank needing attention, say), pass it on; the figures may be incomplete.
- Offer observations and options, not instructions: ${BRAND.product} is not a financial adviser.`;

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), "Not a real date.");

/** Answer with the result as JSON text (every client reads it) and as structured content (clients that prefer it). */
function reply(result: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
}

function failed(): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: `${BRAND.product} couldn't load the user's accounts just now. Try again in a minute; if it keeps happening, the user can open ${BRAND.product} to check their connections.` }],
  };
}

/**
 * One server per request (the SDK's stateless serving): tools are declared
 * up front, and `load` runs at most once, on the first tool call.
 */
export function prismMcpServer(load: () => Promise<AgentData>): McpServer {
  let loading: Promise<AgentData> | null = null;
  const data = () => (loading ??= load());
  const run = (fn: (d: AgentData) => Record<string, unknown>) => async (): Promise<CallToolResult> => {
    try {
      return reply(fn(await data()));
    } catch {
      return failed();
    }
  };
  const runWith =
    <A,>(fn: (d: AgentData, args: A) => Record<string, unknown>) =>
    async (args: A): Promise<CallToolResult> => {
      try {
        return reply(fn(await data(), args));
      } catch {
        return failed();
      }
    };

  const server = new McpServer(
    {
      name: "prism",
      title: `${BRAND.product} by ${BRAND.companyShort}`,
      version: MCP_VERSION,
      websiteUrl: "https://prism.bis-rgv.com",
      icons: [{ src: "https://prism.bis-rgv.com/icon.svg", mimeType: "image/svg+xml" }],
    },
    {
      instructions: INSTRUCTIONS,
      // The tool list never changes, so say so. The SDK otherwise claims it can, and a
      // 2026-era client (Claude's) answers that by holding a subscriptions/listen stream
      // open for news that never comes — one serverless function pinned for its whole
      // time limit, reopened every minute the client is connected.
      capabilities: { tools: { listChanged: false } },
    },
  );

  server.registerTool(
    "get_overview",
    {
      title: "Money at a glance",
      description:
        "The user's financial picture today: net worth and its change this month, cash on hand, spending so far this month against the same point last month, income so far, safe-to-spend until the next paycheck, budgets over or at risk, the next 14 days of bills and paydays, and a few insights with the transactions behind them. Start here for broad questions.",
      annotations: { title: "Money at a glance", ...READ_ONLY },
    },
    run(overview),
  );

  server.registerTool(
    "list_accounts",
    {
      title: "Accounts and balances",
      description: "Every linked account with its current balance, grouped as cash, investments, property, credit cards and loans. Debts are negative. Cards and loans whose lender reports them carry lender_terms: next due date, minimum payment, statement balance and interest rate. Account ids here can filter search_transactions.",
      annotations: { title: "Accounts and balances", ...READ_ONLY },
    },
    run(listAccounts),
  );

  server.registerTool(
    "search_transactions",
    {
      title: "Search transactions",
      description: `Find transactions by date range, merchant text, category, account, size or direction. Newest first; totals cover every match, not just those returned. Defaults to the last 30 days. Categories: ${SPEND_CATEGORY_HELP}, income, transfer.`,
      inputSchema: z.object({
        from: day.optional().describe("First day to include, YYYY-MM-DD. Defaults to 30 days before `to`."),
        to: day.optional().describe("Last day to include, YYYY-MM-DD. Defaults to today; later dates are treated as today."),
        query: z.string().max(80).optional().describe("Text to match in the merchant name, e.g. 'costco' or 'uber'."),
        category: z.enum(CATEGORY_IDS as [string, ...string[]]).optional().describe("Only this category."),
        account_id: z.string().max(200).optional().describe("Only this account (an id from list_accounts)."),
        min_amount: z.number().min(0).optional().describe("Smallest size in dollars, ignoring sign."),
        max_amount: z.number().min(0).optional().describe("Largest size in dollars, ignoring sign."),
        direction: z.enum(["out", "in", "any"]).optional().describe("'out' for spending and payments, 'in' for money received."),
        limit: z.number().int().min(1).max(SEARCH_LIMIT_MAX).optional().describe(`How many to return, up to ${SEARCH_LIMIT_MAX}. Default 25.`),
      }),
      annotations: { title: "Search transactions", ...READ_ONLY },
    },
    runWith((d, args) => searchTransactions(d, args as Parameters<typeof searchTransactions>[1])),
  );

  server.registerTool(
    "spending_breakdown",
    {
      title: "Where the money went",
      description:
        "Spending by category for a period, compared with the period just before it, with each category's largest charges and the top merchants. With no dates: this month so far against the same days of last month.",
      inputSchema: z.object({
        from: day.optional().describe("First day, YYYY-MM-DD."),
        to: day.optional().describe("Last day, YYYY-MM-DD. Defaults to today."),
      }),
      annotations: { title: "Where the money went", ...READ_ONLY },
    },
    runWith(spendingBreakdown),
  );

  server.registerTool(
    "get_cash_flow",
    {
      title: "Income and spending by month",
      description: "Income, spending, net and savings rate for each of the last N months (the current month is marked partial).",
      inputSchema: z.object({ months: z.number().int().min(1).max(13).optional().describe("How many months, 1–13. Default 6.") }),
      annotations: { title: "Income and spending by month", ...READ_ONLY },
    },
    runWith(cashFlow),
  );

  server.registerTool(
    "get_budgets",
    {
      title: "This month's budgets",
      description: "Each monthly budget: limit, spent so far, remaining, projected month-end and status (on_track, at_risk, over), and whether the user set them or they are suggestions.",
      annotations: { title: "This month's budgets", ...READ_ONLY },
    },
    run(budgets),
  );

  server.registerTool(
    "get_goals",
    {
      title: "Savings goals",
      description: "Each savings goal: target, saved so far, monthly contribution, target date, projected finish, whether it is on track, and the monthly amount that would hit the target date.",
      annotations: { title: "Savings goals", ...READ_ONLY },
    },
    run(goals),
  );

  server.registerTool(
    "upcoming_bills",
    {
      title: "Upcoming bills and paydays",
      description:
        "Bills, subscriptions and paychecks expected over the next N days, detected from repeating charges (each cites the charges it is based on), card and loan payments due as their lenders report them (due date, minimum, statement balance, rate), the monthly cost of all subscriptions, and the lowest the checking balance is expected to reach.",
      inputSchema: z.object({ days: z.number().int().min(1).max(90).optional().describe("How far ahead, 1–90 days. Default 30.") }),
      annotations: { title: "Upcoming bills and paydays", ...READ_ONLY },
    },
    runWith(upcomingBills),
  );

  server.registerTool(
    "get_net_worth",
    {
      title: "Net worth",
      description: "Net worth, assets and debts at each month end for the past year, totals by account group, and investment allocation with the largest holdings.",
      annotations: { title: "Net worth", ...READ_ONLY },
    },
    run(netWorth),
  );

  return server;
}
