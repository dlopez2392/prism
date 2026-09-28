// /mcp — Prism's MCP server, for Claude, ChatGPT and other MCP clients.
//
// Every request needs a bearer token Supabase's OAuth server issued to a
// connected app; without one the answer is a 401 whose WWW-Authenticate
// header points at /.well-known/oauth-protected-resource/mcp, which is how a
// client discovers where to send the person to sign in and approve it. The
// SDK serves both protocol eras: 2026-07-28 and, statelessly, 2025.

import { createMcpHandler, getOAuthProtectedResourceMetadataUrl, requireBearerAuth, type McpHttpHandler } from "@modelcontextprotocol/server";
import { prismMcpServer } from "@/lib/agent/mcp";
import { agentDataFor, connectedAppVerifier, MCP_PATH } from "@/lib/server/connected-apps";
import { preflight, withCors } from "@/lib/server/mcp-http";
import { supabaseEnv, type SupabaseEnv } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";
// Loading every linked bank can take a while on a cold start.
export const maxDuration = 60;

let handler: McpHttpHandler | null = null;
function mcp(env: SupabaseEnv): McpHttpHandler {
  return (handler ??= createMcpHandler(
    (ctx) => prismMcpServer(() => {
      if (!ctx.authInfo) throw new Error("unauthenticated");
      return agentDataFor(env, ctx.authInfo);
    }),
    { legacy: "stateless" },
  ));
}

async function serve(req: Request): Promise<Response> {
  const env = supabaseEnv();
  if (!env) return withCors(Response.json({ error: "Accounts aren't switched on for this version of Prism." }, { status: 404 }));
  const gate = requireBearerAuth({
    verifier: connectedAppVerifier(env),
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(new URL(MCP_PATH, req.url)),
  });
  const auth = await gate(req);
  if (auth instanceof Response) return withCors(auth, { "Cache-Control": "no-store" });
  return withCors(await mcp(env).fetch(req, { authInfo: auth }), { "Cache-Control": "no-store" });
}

export const GET = serve;
export const POST = serve;
export const DELETE = serve;
export const OPTIONS = preflight;
