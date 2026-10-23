"use server";

// src/lib/server/notice-actions.ts — Got it on a change notice (legal-notice.ts): a cookie on this
// device holding the id of the notice read, set by the server so the page is drawn again without the
// bar at once. A newer notice has another id, so it shows. Next checks the action's Origin (CSRF).

import { refresh } from "next/cache";
import { cookies } from "next/headers";
import { NOTICE_COOKIE, noticeById } from "@/lib/legal-notice";

export async function dismissNotice(form: FormData): Promise<void> {
  const notice = noticeById(form.get("notice"));
  if (!notice) return;
  (await cookies()).set(NOTICE_COOKIE, notice.id, { path: "/", maxAge: 31_536_000, sameSite: "lax" });
  refresh();
}
