"use client";

// src/components/remove-import.tsx — take an import out of Prism, whole. The
// file on the person's computer isn't touched, so importing again is always
// possible; still, the transactions leave every screen, so it asks first. An
// import Prism can no longer open has no name or count to show (null).

import { useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { buttonGhost, buttonPrimary, Dialog } from "@/components/dialog";
import { removeImport } from "@/lib/server/import-actions";
import { useT } from "@/components/locale";

export function RemoveImport({ id, name, rows }: { id: string; name: string | null; rows: number | null }) {
  const t = useT();
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
        {t("Remove")}
      </button>
      <Dialog
        dialogRef={dialog}
        title={name === null ? t("Remove this import?") : t("Remove {name}?", { name })}
        icon={Trash2}
        description={
          rows === null
            ? t("Prism can't open it, so none of it is on screen. Removing it deletes it from your account.")
            : rows === 1
              ? t("Its imported transaction leaves every screen in Prism.")
              : t("Its {n} imported transactions leave every screen in Prism.", { n: rows.toLocaleString("en-US") })
        }
      >
        <p className="text-sm text-ink-2">{t("The file on your computer isn't touched, so you can import it again any time.")}</p>
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
            {state.busy ? t("Removing…") : t("Remove it")}
          </button>
          <button type="button" className={buttonGhost} onClick={() => dialog.current?.close()}>
            {t("Keep it")}
          </button>
        </div>
      </Dialog>
    </>
  );
}
