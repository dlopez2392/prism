"use client";

// src/components/disconnect-button.tsx
//
// Removing a connection is destructive (its accounts leave the app and the
// link is revoked at the source), so it confirms by typing the name — never a
// reflexive "Are you sure?". Banks go to the Plaid route; Coinbase to its own.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Unplug } from "lucide-react";
import { useT } from "@/components/locale";

export function DisconnectButton({ itemId, name, endpoint = "/api/plaid/disconnect" }: { itemId: string; name: string; endpoint?: string }) {
  const router = useRouter();
  const t = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = typed.trim().toLowerCase() === name.trim().toLowerCase();

  async function disconnect() {
    setBusy(true);
    setError(null);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId }),
    });
    setBusy(false);
    if (!res.ok) {
      setError(t("That didn't work. Try again in a minute."));
      return;
    }
    dialog.current?.close();
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        className="inline-flex h-8 items-center gap-1.5 rounded-ctl border border-line px-2.5 text-xs font-semibold text-ink-2 hover:bg-surface-3"
      >
        <Unplug aria-hidden className="size-3.5" />
        {t("Disconnect")}
      </button>
      <dialog ref={dialog} className="m-auto w-[min(92vw,420px)] rounded-card border border-line bg-surface-1 p-6 text-ink-1 shadow-pop backdrop:bg-[var(--surface-0)]/70">
        <h2 className="text-lg font-bold">{t("Disconnect {name}?", { name })}</h2>
        <p className="mt-2 text-sm text-ink-2">{t("Its accounts leave Prism, and the link is revoked at {name} itself, not just here. Type the name to confirm.", { name })}</p>
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          aria-label={t("Type {name} to confirm", { name })}
          placeholder={name}
          className="mt-4 h-10 w-full rounded-ctl border border-line bg-surface-2 px-3 text-sm focus:border-[var(--focus)]"
        />
        {error ? <p className="mt-2 text-xs font-semibold text-crit-ink">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={() => dialog.current?.close()} className="h-9 rounded-ctl border border-line px-3.5 text-sm font-semibold hover:bg-surface-3">
            {t("Keep it")}
          </button>
          <button
            type="button"
            disabled={!matches || busy}
            onClick={disconnect}
            className="h-9 rounded-ctl bg-crit px-3.5 text-sm font-semibold text-ink-on-accent disabled:opacity-40"
          >
            {busy ? t("Disconnecting…") : t("Disconnect")}
          </button>
        </div>
      </dialog>
    </>
  );
}
