// GET /api/health — is Prism up, which release is live, and did the daily
// alert job run (src/lib/server/health.ts)? Nothing about anyone.

import { health } from "@/lib/server/health";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const h = await health();
  return Response.json(h, { status: h.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
