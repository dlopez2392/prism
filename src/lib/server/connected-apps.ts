// src/lib/server/connected-apps.ts
//
// Who is asking the MCP endpoint, and what they are given. A connected app
// (Claude, ChatGPT…) sends a bearer token that Supabase's OAuth 2.1 server
// issued to it on the person's behalf. Only those are accepted — a token
// with a client_id, never a person's own browser session — and Supabase Auth
// is asked about every one, so an app the person disconnects is cut off at
// once rather than when its token lapses. The data is then read AS the
// person, through row-level security, which lets a connected app read and
// refuses it every write.

import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { OAuthError, OAuthErrorCode, type AuthInfo, type OAuthTokenVerifier } from "@modelcontextprotocol/server";
import type { AgentData } from "@/lib/agent/tools";
import type { SupabaseEnv } from "@/lib/supabase/config";
import type { Account } from "@/lib/supabase/server";
import { agentFinance } from "./finance";

export const MCP_PATH = "/mcp";

/** Supabase Auth, as the OAuth authorization server connected apps sign in with. */
export const authorizationServer = (env: SupabaseEnv) => `${env.url}/auth/v1`;

/** Where Supabase publishes that server's metadata (RFC 8414, path-aware). */
export const authorizationServerMetadataUrl = (env: SupabaseEnv) => `${env.url}/.well-known/oauth-authorization-server/auth/v1`;

function client(env: SupabaseEnv, token?: string, fetchImpl?: typeof fetch): SupabaseClient {
  return createClient(env.url, env.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}), ...(fetchImpl ? { fetch: fetchImpl } : {}) },
  });
}

/** A token's claims — read only AFTER Supabase Auth has vouched for the token. */
function claimsOf(token: string): Record<string, unknown> {
  try {
    const claims: unknown = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
    return claims && typeof claims === "object" ? (claims as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const refused = (why: string) => new OAuthError(OAuthErrorCode.InvalidToken, why);

export function connectedAppVerifier(env: SupabaseEnv, fetchImpl?: typeof fetch): OAuthTokenVerifier {
  return {
    async verifyAccessToken(token) {
      // Asked of Supabase Auth, not checked locally: this also catches a
      // token whose app the person has since disconnected.
      const { data, error } = await client(env, undefined, fetchImpl).auth.getUser(token);
      // An outage is not a bad token: answering 401 would send the app back
      // through sign-in for nothing. 5xx says "try again" instead.
      const status = (error as { status?: number } | null)?.status;
      if (error && (!status || status >= 500)) throw new OAuthError(OAuthErrorCode.ServerError, "Prism couldn't check this token just now. Try again in a minute.");
      if (error || !data.user) throw refused("This token has expired or been revoked. Connect Prism again from your app.");
      const claims = claimsOf(token);
      if (typeof claims.client_id !== "string" || !claims.client_id) {
        throw refused("Prism's MCP endpoint takes a token issued to a connected app. Add Prism as a connector in your AI app to get one.");
      }
      if (typeof claims.exp !== "number") throw refused("This token has no expiry.");
      return {
        token,
        clientId: claims.client_id,
        scopes: typeof claims.scope === "string" ? claims.scope.split(" ").filter(Boolean) : [],
        expiresAt: claims.exp,
        extra: { userId: data.user.id, email: data.user.email ?? null },
      };
    },
  };
}

/** The person behind a verified token, with a database client that carries THAT token — so row-level security sees the connected app. */
export function accountFor(env: SupabaseEnv, auth: AuthInfo): Account {
  const userId = auth.extra?.userId;
  if (typeof userId !== "string") throw refused("Unverified token.");
  const email = auth.extra?.email;
  return { supabase: client(env, auth.token), userId, email: typeof email === "string" ? email : null };
}

// A conversation asks several questions in a row; each would otherwise
// re-fetch every bank. Kept briefly, per person, in this server instance only.
const FRESH_MS = 60_000;
const MAX_PEOPLE = 200;
const recent = new Map<string, { at: number; data: Promise<AgentData> }>();

export function agentDataFor(env: SupabaseEnv, auth: AuthInfo, now = Date.now()): Promise<AgentData> {
  const account = accountFor(env, auth);
  const hit = recent.get(account.userId);
  if (hit && now - hit.at < FRESH_MS) return hit.data;
  const data = agentFinance(account);
  const entry = { at: now, data };
  recent.set(account.userId, entry);
  // A failed load is never served again — and only this load is dropped, never a newer one.
  data.catch(() => {
    if (recent.get(account.userId) === entry) recent.delete(account.userId);
  });
  if (recent.size > MAX_PEOPLE) recent.delete(recent.keys().next().value!);
  return data;
}

/**
 * Is Supabase's OAuth server switched on for this project? It publishes its
 * metadata only when it is. Checked at most every five minutes.
 */
export async function connectingEnabled(env: SupabaseEnv): Promise<boolean> {
  try {
    const res = await fetch(authorizationServerMetadataUrl(env), { next: { revalidate: 300 } });
    return res.ok;
  } catch {
    return false;
  }
}
