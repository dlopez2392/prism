"use client";

// src/components/connected-apps.tsx
//
// "Ask AI about your money": the address to paste into Claude or ChatGPT,
// how to do it, and every app the person has let in — each one a click from
// being cut off. Disconnecting is reversible (connect again from the app),
// so it runs at once, with no "Are you sure?".

import { useActionState, useState } from "react";
import { Check, Copy, Unplug } from "lucide-react";
import { buttonSmall } from "@/components/dialog";
import { disconnectApp, type DisconnectState } from "@/lib/server/connected-apps-actions";

export type ConnectedApp = { clientId: string; name: string; host: string | null; grantedAt: string };

const IDLE: DisconnectState = { status: "idle" };

function CopyAddress({ endpoint }: { endpoint: string }) {
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
        Connector address
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
        {copied ? "Copied" : "Copy"}
      </button>
      <span role="status" className="sr-only">
        {copied ? "Address copied" : ""}
      </span>
    </div>
  );
}

function AppRow({ app }: { app: ConnectedApp }) {
  const [state, action, pending] = useActionState(disconnectApp, IDLE);
  const since = new Date(app.grantedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <div aria-hidden className="grid size-9 shrink-0 place-items-center rounded-ctl bg-surface-3 text-sm font-bold text-ink-1">
        {app.name.slice(0, 1).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-ink-1">{app.name}</div>
        <div className="truncate text-xs text-ink-3">
          {app.host ? `${app.host} · ` : ""}connected {since}
        </div>
        {state.status !== "idle" ? (
          <p role="status" className={`mt-1 text-xs font-medium ${state.status === "error" ? "text-crit-ink" : "text-ink-2"}`}>
            {state.message}
          </p>
        ) : null}
      </div>
      <form action={action}>
        <input type="hidden" name="client_id" value={app.clientId} />
        <input type="hidden" name="name" value={app.name} />
        <button type="submit" disabled={pending} className={buttonSmall}>
          <Unplug aria-hidden className="size-4" />
          {pending ? "Disconnecting…" : "Disconnect"}
        </button>
      </form>
    </li>
  );
}

export function ConnectedApps({ endpoint, enabled, apps }: { endpoint: string; enabled: boolean; apps: ConnectedApp[] | null }) {
  if (!enabled) {
    return <p className="mt-3 text-sm text-ink-2">Connecting AI apps is almost ready — it switches on once Prism&apos;s sign-in server is set up. Check back soon.</p>;
  }
  return (
    <>
      <CopyAddress endpoint={endpoint} />
      <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-sm text-ink-2 marker:font-semibold marker:text-ink-3">
        <li>
          <span className="font-semibold text-ink-1">Claude:</span> Customize → Connectors → + → Add custom connector. Paste the address and choose Connect.
        </li>
        <li>
          <span className="font-semibold text-ink-1">ChatGPT</span> (Plus or higher, on the web): turn on Developer mode in Settings, add a custom connector with this address, and pick OAuth.
        </li>
        <li>Sign in to Prism when asked, check the app is the one you started from, and choose Allow.</li>
      </ol>

      <h3 className="mt-5 text-[13px] font-semibold text-ink-2">Connected apps</h3>
      {apps === null ? (
        <p className="mt-2 text-sm text-ink-2">We couldn&apos;t load your connected apps just now. Refresh the page to try again.</p>
      ) : apps.length === 0 ? (
        <p className="mt-2 text-sm text-ink-2">None yet. Once you connect Claude or ChatGPT, it shows up here, and you can disconnect it any time.</p>
      ) : (
        <ul className="divide-y divide-[var(--line)]">
          {apps.map((app) => (
            <AppRow key={app.clientId} app={app} />
          ))}
        </ul>
      )}
    </>
  );
}
