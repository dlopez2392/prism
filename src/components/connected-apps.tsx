"use client";

// src/components/connected-apps.tsx
//
// "Ask AI about your money": the address to paste into Claude or ChatGPT,
// how to do it, and every app the person has let in — each one a click from
// being cut off. Disconnecting is reversible (connect again from the app),
// so it runs at once, with no "Are you sure?". Its confirmation lives on the
// list, not the row: the row is gone the moment the app is.

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { CircleCheck, Check, Copy, Unplug } from "lucide-react";
import { buttonSmall } from "@/components/dialog";
import { useT } from "@/components/locale";
import { shortDate } from "@/lib/finance/format";
import type { Locale } from "@/lib/i18n/locale";
import { disconnectApp, type DisconnectState } from "@/lib/server/connected-apps-actions";

export type ConnectedApp = { clientId: string; name: string; host: string | null; grantedAt: string };

const IDLE: DisconnectState = { status: "idle" };

/** The day an app was let in, on this browser's clock: "Oct 5, 2026"; in Spanish "5 oct 2026", as format.ts writes a day. */
function sinceDate(at: string, locale: Locale): string {
  const d = new Date(at);
  if (locale === "en") return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `${shortDate(day, locale)} ${d.getFullYear()}`;
}

function CopyAddress({ endpoint }: { endpoint: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(endpoint);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard (an old browser, or permission refused): the address stays selectable.
    }
  }
  return (
    <div className="mt-4 flex gap-2">
      <label htmlFor="mcp-address" className="sr-only">
        {t("Connector address")}
      </label>
      <input
        id="mcp-address"
        readOnly
        value={endpoint}
        onFocus={(e) => e.currentTarget.select()}
        className="num h-10 min-w-0 flex-1 rounded-ctl border border-line-strong bg-surface-2 px-3 text-sm text-ink-1"
      />
      <button type="button" onClick={copy} className={`${buttonSmall} h-10`}>
        {copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
        {copied ? t("Copied") : t("Copy")}
      </button>
      <span role="status" className="sr-only">
        {copied ? t("Address copied") : ""}
      </span>
    </div>
  );
}

function DisconnectButton() {
  const t = useT();
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonSmall}>
      <Unplug aria-hidden className="size-4" />
      {pending ? t("Disconnecting…") : t("Disconnect")}
    </button>
  );
}

function AppRow({ app, action }: { app: ConnectedApp; action: (form: FormData) => void }) {
  const t = useT();
  const date = sinceDate(app.grantedAt, t.locale);
  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <div aria-hidden className="grid size-9 shrink-0 place-items-center rounded-ctl bg-surface-3 text-sm font-bold text-ink-1">
        {app.name.slice(0, 1).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-ink-1">{app.name}</div>
        <div className="truncate text-xs text-ink-3">
          {app.host ? t("{host} · connected {date}", { host: app.host, date }) : t("connected {date}", { date })}
        </div>
      </div>
      <form action={action}>
        <input type="hidden" name="client_id" value={app.clientId} />
        <input type="hidden" name="name" value={app.name} />
        <DisconnectButton />
      </form>
    </li>
  );
}

export function ConnectedApps({ endpoint, enabled, apps }: { endpoint: string; enabled: boolean; apps: ConnectedApp[] | null }) {
  const t = useT();
  const [state, action] = useActionState(disconnectApp, IDLE);
  if (!enabled) {
    return <p className="mt-3 text-sm text-ink-2">{t("Connecting AI apps is almost ready — it switches on once Prism's sign-in server is set up. Check back soon.")}</p>;
  }
  return (
    <>
      <CopyAddress endpoint={endpoint} />
      <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-sm text-ink-2 marker:font-semibold marker:text-ink-3">
        <li>
          <span className="font-semibold text-ink-1">Claude:</span> {t("Customize → Connectors → + → Add custom connector. Paste the address and choose Connect.")}
        </li>
        <li>
          <span className="font-semibold text-ink-1">ChatGPT</span>{" "}
          {t(
            "(Plus or higher, on the web): in Settings → Security and login, turn on Developer mode. Then open Plugins, choose +, paste the address and pick OAuth. It works in chats and in deep research, and its reports link to the Prism pages they read.",
          )}
        </li>
        <li>{t("Sign in to Prism when asked, check the app is the one you started from, and choose Allow.")}</li>
      </ol>

      <h3 className="mt-5 text-[13px] font-semibold text-ink-2">{t("Connected apps")}</h3>
      {/* Always in the DOM so screen readers announce it. */}
      <p role="status" className={`flex items-center gap-1 text-xs font-semibold ${state.status === "error" ? "text-crit-ink" : "text-good-ink"} ${state.status === "idle" ? "" : "mt-2"}`}>
        {state.status === "done" ? <CircleCheck aria-hidden className="size-3.5" /> : null}
        {state.status === "idle" ? null : state.message}
      </p>
      {apps === null ? (
        <p className="mt-2 text-sm text-ink-2">{t("We couldn't load your connected apps just now. Refresh the page to try again.")}</p>
      ) : apps.length === 0 ? (
        <p className="mt-2 text-sm text-ink-2">{t("None yet. Once you connect Claude or ChatGPT, it shows up here, and you can disconnect it any time.")}</p>
      ) : (
        <ul className="divide-y divide-[var(--line)]">
          {apps.map((app) => (
            <AppRow key={app.clientId} app={app} action={action} />
          ))}
        </ul>
      )}
    </>
  );
}
