// src/lib/server/export-response.ts
//
// The shared half of "Download your data" (src/app/account/export/*): only
// for a signed-in person (a connected app's token is signed OUT here, as
// everywhere), only their OWN money (getPersonalFinance never follows the
// household switch), never the demo household dressed up as theirs, and
// never cached anywhere but the person's own download.

import "server-only";
import { BRAND } from "@/lib/brand";
import { currentAccount } from "@/lib/supabase/server";
import { getPersonalFinance, type Loaded } from "./finance";

export type Own = { data: Loaded; email: string | null };

/** Their own money, or the response to send instead: sign in first, or nothing of theirs to download yet. */
export async function ownMoneyOrRefusal(req: Request): Promise<Own | Response> {
  const account = await currentAccount();
  if (!account) return Response.redirect(new URL("/sign-in?next=/account", req.url), 303);
  const data = await getPersonalFinance();
  if (data.source === "demo") {
    return new Response(`Nothing of yours to download yet. Link a bank or import your history in ${BRAND.product}, then come back.\n`, {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store" },
    });
  }
  return { data, email: account.email };
}

const slug = BRAND.product.toLowerCase().replace(/[^a-z0-9]+/g, "-");

/** A file to save, never to show in the page or keep in a cache. */
export function download(body: string | Uint8Array, contentType: string, name: string): Response {
  return new Response(typeof body === "string" ? body : new Uint8Array(body), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${slug}-${name}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
