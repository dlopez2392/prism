// Prism's MCP server, spoken to over HTTP exactly as a client would: the
// 2025-era stateless JSON-RPC exchange, and the 2026-07-28 one Claude speaks.

import { createMcpHandler } from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";
import { buildDemoData } from "@/lib/finance/demo";
import { prismMcpServer } from "./mcp";
import type { AgentData } from "./tools";

const data: AgentData = { ...buildDemoData("2026-09-18"), demo: true, notice: null, timeZone: "America/Chicago", budgetsSetByPerson: false };

type Rpc = { jsonrpc: "2.0"; id?: number; result?: Record<string, unknown> & { tools?: Tool[]; content?: { type: string; text: string }[]; isError?: boolean; structuredContent?: Record<string, unknown> }; error?: { code: number; message: string } };
type Tool = { name: string; inputSchema: { properties?: Record<string, unknown> }; annotations?: Record<string, unknown> };

function serve(load: () => Promise<AgentData>) {
  const handler = createMcpHandler(() => prismMcpServer(load), { legacy: "stateless" });
  let id = 0;
  return async (method: string, params: Record<string, unknown> = {}): Promise<Rpc> => {
    const res = await handler.fetch(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
      }),
    );
    const text = await res.text();
    // A JSON body, or a one-message event stream.
    const json = res.headers.get("content-type")?.includes("text/event-stream")
      ? text
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim())
          .at(-1)!
      : text;
    return JSON.parse(json) as Rpc;
  };
}

const HANDSHAKE = { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } };

/** A 2026-07-28 request, shaped as the SDK's own client sends it: the method and version in headers, the client in `_meta`. */
function modern(method: string, params: Record<string, unknown> = {}): Request {
  return new Request("http://localhost/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-method": method, "mcp-protocol-version": "2026-07-28" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: method,
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    }),
  });
}

/** The first message of a reply — a JSON body, or the first event of a stream, without waiting for the stream to end. */
async function firstEvent(res: Response): Promise<Record<string, unknown>> {
  if (!res.headers.get("content-type")?.includes("text/event-stream")) return (await res.json()) as Record<string, unknown>;
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (!text.includes("\n\n")) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel();
  }
  const data = text.split("\n").find((l) => l.startsWith("data:"));
  return JSON.parse(data!.slice(5).trim()) as Record<string, unknown>;
}

describe("the MCP endpoint", () => {
  it("introduces itself with read-only instructions and never loads money for a handshake or a tool list", async () => {
    const load = vi.fn(async () => data);
    const call = serve(load);
    const init = await call("initialize", HANDSHAKE);
    expect(init.result?.serverInfo).toMatchObject({ name: "prism", version: "1.0.0" });
    expect(String(init.result?.instructions)).toMatch(/READ-ONLY/);
    const list = await call("tools/list");
    expect(list.result?.tools?.map((t) => t.name).sort()).toEqual([
      "get_budgets",
      "get_cash_flow",
      "get_goals",
      "get_income",
      "get_net_worth",
      "get_overview",
      "list_accounts",
      "search_transactions",
      "spending_breakdown",
      "upcoming_bills",
    ]);
    expect(load).not.toHaveBeenCalled();
  });

  it("tells a 2026-era client its tools never change, so the client has nothing to hold a listen stream open for", async () => {
    const handler = createMcpHandler(() => prismMcpServer(async () => data), { legacy: "stateless" });
    const discover = await firstEvent(await handler.fetch(modern("server/discover")));
    const result = discover.result as { capabilities?: { tools?: { listChanged?: boolean } } };
    expect(result.capabilities?.tools).toEqual({ listChanged: false });

    // A client that listens anyway is told, in the acknowledgement, that none of what it asked for will come.
    const listen = await handler.fetch(modern("subscriptions/listen", { notifications: { toolsListChanged: true } }));
    const ack = await firstEvent(listen);
    expect(ack).toMatchObject({ method: "notifications/subscriptions/acknowledged", params: { notifications: {} } });
    await handler.close();
  });

  it("marks every tool read-only and closed-world", async () => {
    const list = await serve(async () => data)("tools/list");
    for (const t of list.result!.tools!) expect(t.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
  });

  it("answers a tool call with JSON text and the same structured content", async () => {
    const r = await serve(async () => data)("tools/call", { name: "get_overview", arguments: {} });
    expect(r.result?.isError).toBeFalsy();
    const parsed = JSON.parse(r.result!.content![0]!.text);
    expect(parsed).toMatchObject({ as_of: "2026-09-18", demo: true });
    expect(r.result?.structuredContent).toEqual(parsed);
  });

  it("passes arguments through, and refuses ones that aren't real dates", async () => {
    const call = serve(async () => data);
    const ok = await call("tools/call", { name: "search_transactions", arguments: { category: "food", limit: 3 } });
    expect(JSON.parse(ok.result!.content![0]!.text).transactions).toHaveLength(3);
    const bad = await call("tools/call", { name: "search_transactions", arguments: { from: "2026-02-30" } });
    expect(bad.error ?? bad.result?.isError).toBeTruthy();
  });

  it("says plainly when the accounts can't be loaded, without leaking why", async () => {
    const r = await serve(async () => {
      throw new Error("PLAID_SECRET=abc123 rejected");
    })("tools/call", { name: "get_budgets", arguments: {} });
    expect(r.result?.isError).toBe(true);
    expect(r.result!.content![0]!.text).toMatch(/couldn't load/);
    expect(JSON.stringify(r)).not.toContain("abc123");
  });
});
