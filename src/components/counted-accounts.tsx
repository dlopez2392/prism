"use client";

// src/components/counted-accounts.tsx
//
// Which of a person's accounts count in their totals. An account left out
// (a business card, a closed or duplicate account) stays connected and listed
// here, but its balance leaves net worth and none of its lines count in
// spending, income or budgets (finance/details.ts). Each switch saves the
// moment it's flipped; flipping it back is the undo.

import { useRef, useState, useTransition } from "react";
import { CircleCheck, SlidersHorizontal } from "lucide-react";
import { buttonSmall, Dialog } from "@/components/dialog";
import { Switch } from "@/components/switch";
import { money0 } from "@/lib/finance/format";
import { countAccount } from "@/lib/server/details-actions";

export type CountedAccount = { id: string; name: string; where: string; balance: number; counted: boolean };

export function CountedAccounts({ accounts }: { accounts: CountedAccount[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const hidden = accounts.filter((a) => !a.counted);
  return (
    <div className="mt-5 border-t border-line pt-4">
      {hidden.length ? (
        <section aria-labelledby="left-out-heading" className="mb-3">
          <h3 id="left-out-heading" className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-3">
            Left out of your totals
          </h3>
          <ul className="mt-1.5 space-y-1">
            {hidden.map((a) => (
              <li key={a.id} className="flex items-baseline justify-between gap-3 text-sm text-ink-2">
                <span className="min-w-0 truncate">
                  {a.name} <span className="text-xs text-ink-3">{a.where}</span>
                </span>
                <span className="num shrink-0 text-ink-3">{money0(a.balance)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p role="status" className="flex items-center gap-1 text-xs font-semibold text-good-ink">
          {notice ? (
            <>
              <CircleCheck aria-hidden className="size-3.5" />
              {notice}
            </>
          ) : null}
        </p>
        <button
          type="button"
          className={buttonSmall}
          onClick={() => {
            setNotice(null);
            dialog.current?.showModal();
          }}
        >
          <SlidersHorizontal aria-hidden className="size-4" />
          Choose what counts
        </button>
      </div>
      <Dialog dialogRef={dialog} title="Choose what counts" description="Every account stays connected. One left out isn't added to your net worth, and none of its transactions count in spending, income or budgets." icon={SlidersHorizontal}>
        <ul className="divide-y divide-[var(--line)]">
          {accounts.map((a) => (
            <li key={a.id} className="py-3">
              <AccountSwitch account={a} onSaved={setNotice} />
            </li>
          ))}
        </ul>
        <div className="mt-4 flex justify-end">
          <button type="button" className={buttonSmall} onClick={() => dialog.current?.close()}>
            Done
          </button>
        </div>
      </Dialog>
    </div>
  );
}

function AccountSwitch({ account, onSaved }: { account: CountedAccount; onSaved: (message: string) => void }) {
  const [counted, setCounted] = useState(account.counted);
  const [error, setError] = useState<string | null>(null);
  const [saving, start] = useTransition();
  const flip = (next: boolean) => {
    setCounted(next);
    setError(null);
    start(async () => {
      const result = await countAccount(account.id, next);
      if (result.status === "saved") onSaved(result.message);
      else {
        setCounted(!next);
        setError(result.status === "error" ? result.message : null);
      }
    });
  };
  return (
    <>
      <Switch checked={counted} onChange={flip} disabled={saving} label={account.name} description={`${account.where} · ${money0(account.balance)} · ${counted ? "counted" : "left out"}`} />
      {error ? (
        <p role="alert" className="mt-2 text-sm font-medium text-crit-ink">
          {error}
        </p>
      ) : null}
    </>
  );
}
