"use client";

// src/components/disconnect-button.tsx
//
// Removing a bank is destructive (its history leaves the app), so it confirms
// by typing the bank's name — never a reflexive "Are you sure?".

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Unplug } from "lucide-react";

export function DisconnectButton({ itemId, name }: { itemId: string; name: string }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = typed.trim().toLowerCase() === name.trim().toLowerCase();

  async function disconnect() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/plaid/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId }),
    });
    setBusy(false);
    if (!res.ok) {
      setError("That didn't work. Try again in a minute.");
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
        Disconnect
      </button>
      <dialog ref={dialog} className="m-auto w-[min(92vw,420px)] rounded-card border border-line bg-surface-1 p-6 text-ink-1 shadow-pop backdrop:bg-[var(--surface-0)]/70">
        <h2 className="text-lg font-bold">Disconnect {name}?</h2>
        <p className="mt-2 text-sm text-ink-2">Its accounts and transactions leave Prism, and the bank link is revoked. Type the bank&apos;s name to confirm.</p>
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          aria-label={`Type ${name} to confirm`}
          placeholder={name}
          className="mt-4 h-10 w-full rounded-ctl border border-line bg-surface-2 px-3 text-sm focus:border-[var(--focus)]"
        />
        {error ? <p className="mt-2 text-xs font-semibold text-crit-ink">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={() => dialog.current?.close()} className="h-9 rounded-ctl border border-line px-3.5 text-sm font-semibold hover:bg-surface-3">
            Keep it
          </button>
          <button
            type="button"
            disabled={!matches || busy}
            onClick={disconnect}
            className="h-9 rounded-ctl bg-crit px-3.5 text-sm font-semibold text-ink-on-accent disabled:opacity-40"
          >
            {busy ? "Disconnecting…" : "Disconnect"}
          </button>
        </div>
      </dialog>
    </>
  );
}
