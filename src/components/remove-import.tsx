"use client";

// src/components/remove-import.tsx — take an import out of Prism, whole. The
// file on the person's computer isn't touched, so importing again is always
// possible; still, the transactions leave every screen, so it asks first.

import { useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { buttonGhost, buttonPrimary, Dialog } from "@/components/dialog";
import { removeImport } from "@/lib/server/import-actions";

export function RemoveImport({ id, name, rows }: { id: string; name: string; rows: number }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-ctl border border-line px-2.5 text-xs font-semibold text-ink-2 hover:bg-surface-3"
      >
        <Trash2 aria-hidden className="size-3.5" />
        Remove
      </button>
      <Dialog dialogRef={dialog} title={`Remove ${name}?`} icon={Trash2} description={rows === 1 ? "Its imported transaction leaves every screen in Prism." : `Its ${rows.toLocaleString("en-US")} imported transactions leave every screen in Prism.`}>
        <p className="text-sm text-ink-2">The file on your computer isn&apos;t touched, so you can import it again any time.</p>
        {state.error ? (
          <p role="alert" className="mt-3 text-sm font-medium text-crit-ink">
            {state.error}
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            className={buttonPrimary}
            disabled={state.busy}
            onClick={async () => {
              setState({ busy: true, error: null });
              const r = await removeImport(id);
              if (r.ok) dialog.current?.close();
              setState({ busy: false, error: r.ok ? null : r.message });
            }}
          >
            {state.busy ? "Removing…" : "Remove it"}
          </button>
          <button type="button" className={buttonGhost} onClick={() => dialog.current?.close()}>
            Keep it
          </button>
        </div>
      </Dialog>
    </>
  );
}
