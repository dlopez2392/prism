// apps/finance/src/lib/server/request-guard.ts
//
// The Plaid routes change what bank data this browser can see, so they accept
// only same-origin JSON POSTs. SameSite=Lax already keeps the vault cookie off
// cross-site POSTs; requiring JSON (which a cross-site <form> cannot send
// without a CORS preflight) and a matching Origin are the belt and braces.

export function sameOriginJson(req: Request): string | null {
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return "Expected a JSON request.";
  }
  const origin = req.headers.get("origin");
  if (origin) {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    try {
      if (!host || new URL(origin).host !== host) return "Cross-origin requests are not allowed.";
    } catch {
      return "Cross-origin requests are not allowed.";
    }
  }
  return null;
}
