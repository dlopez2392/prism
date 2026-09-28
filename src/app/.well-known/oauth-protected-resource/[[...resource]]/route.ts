// /.well-known/oauth-protected-resource[/mcp] — RFC 9728 metadata for the
// MCP endpoint: which URL is protected, and which authorization server (the
// Prism project's Supabase Auth) issues the tokens it accepts. MCP clients
// read it after the endpoint's first 401.

import { BRAND } from "@/lib/brand";
import { authorizationServer, MCP_PATH } from "@/lib/server/connected-apps";
import { preflight, withCors } from "@/lib/server/mcp-http";
import { supabaseEnv } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export function GET(req: Request): Response {
  const env = supabaseEnv();
  if (!env) return withCors(Response.json({ error: "not_found" }, { status: 404 }));
  return withCors(
    Response.json({
      resource: new URL(MCP_PATH, req.url).href,
      authorization_servers: [authorizationServer(env)],
      bearer_methods_supported: ["header"],
      resource_name: BRAND.product,
      resource_documentation: new URL("/account#ai", req.url).href,
    }),
    { "Cache-Control": "public, max-age=3600" },
  );
}

export const OPTIONS = preflight;
