// /.well-known/oauth-authorization-server — for MCP clients that predate
// protected-resource metadata and look for the authorization server on the
// MCP server's own origin: Supabase Auth's metadata, passed through as is.

import { authorizationServerMetadataUrl } from "@/lib/server/connected-apps";
import { preflight, withCors } from "@/lib/server/mcp-http";
import { supabaseEnv } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const env = supabaseEnv();
  const upstream = env ? await fetch(authorizationServerMetadataUrl(env), { next: { revalidate: 3600 } }).catch(() => null) : null;
  if (!upstream?.ok) return withCors(Response.json({ error: "not_found" }, { status: 404 }));
  return withCors(Response.json(await upstream.json()), { "Cache-Control": "public, max-age=3600" });
}

export const OPTIONS = preflight;
