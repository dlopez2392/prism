"use client";

// src/components/counted-accounts.tsx
//
// Which of a person's accounts count in their totals. An account left out
// (a closed or duplicate account) stays connected and listed here, but its
// balance leaves net worth and none of its lines count in spending, income or
// budgets (finance/details.ts). An account marked as business is kept apart
// the same way, and summed on its own on Cash flow (finance/business.ts).
// Each switch saves the moment it's flipped; flipping it back is the undo.

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { CircleCheck, SlidersHorizontal } from "lucide-react";
import { buttonSmall, Dialog } from "@/components/dialog";
import { useT } from "@/components/locale";
import { Switch } from "@/components/switch";
import { money0 } from "@/lib/finance/format";
import { countAccount, markBusiness } from "@/lib/server/details-actions";

export type CountedAccount = { id: string; name: string; where: string; balance: number; counted: boolean; business: boolean };

export function CountedAccounts({ accounts }: { accounts: CountedAccount[] }) {
  const t = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const hidden = accounts.filter((a) => !a.counted && !a.business);
  const business = accounts.filter((a) => a.business);
  return (
    <div className="mt-5 border-t border-line pt-4">
      {business.length ? (
        <section aria-labelledby="business-heading" className="mb-3">
          <h3 id="business-heading" className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-3">
            {t("Business accounts")}
          </h3>
          <ul className="mt-1.5 space-y-1">
            {business.map((a) => (
              <li key={a.id} className="flex items-baseline justify-between gap-3 text-sm text-ink-2">
                <span className="min-w-0 truncate">
                  {a.name} <span className="text-xs text-ink-3">{a.where}</span>
                </span>
                <span className="num shrink-0 text-ink-3">{money0(a.balance)}</span>
              </li>
            ))}
          </ul>
          <Link href="/business" className="mt-1.5 inline-block text-xs font-semibold text-accent-ink underline-offset-2 hover:underline">
            {t("Sort their money for Schedule C")}
          </Link>
        </section>
      ) : null}
      {hidden.length ? (
        <section aria-labelledby="left-out-heading" className="mb-3">
          <h3 id="left-out-heading" className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-3">
            {t("Left out of your totals")}
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
          {t("Choose what counts")}
        </button>
      </div>
      <Dialog
        dialogRef={dialog}
        title={t("Choose what counts")}
        description={t("Every account stays connected. One left out isn't added to your net worth, and none of its transactions count in spending, income or budgets. A business account is kept apart the same way, and summed on its own on Cash flow.")}
        icon={SlidersHorizontal}
      >
        <ul className="divide-y divide-[var(--line)]">
          {accounts.map((a) => (
            <li key={a.id} className="py-3">
              <AccountSwitch account={a} onSaved={setNotice} />
            </li>
          ))}
        </ul>
        <div className="mt-4 flex justify-end">
          <button type="button" className={buttonSmall} onClick={() => dialog.current?.close()}>
            {t("Done")}
          </button>
        </div>
      </Dialog>
    </div>
  );
}

function AccountSwitch({ account, onSaved }: { account: CountedAccount; onSaved: (message: string) => void }) {
  const t = useT();
  const [counted, setCounted] = useState(account.counted);
  const [business, setBusiness] = useState(account.business);
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
  const flipBusiness = (next: boolean) => {
    setBusiness(next);
    setError(null);
    start(async () => {
      const result = await markBusiness(account.id, next);
      if (result.status === "saved") onSaved(result.message);
      else {
        setBusiness(!next);
        setError(result.status === "error" ? result.message : null);
      }
    });
  };
  // A business account is kept apart whatever the counted switch says, so that switch rests until it's personal again.
  const state = business ? t("business, kept apart") : counted ? t("counted") : t("left out");
  return (
    <>
      <Switch checked={counted && !business} onChange={flip} disabled={saving || business} label={account.name} description={`${account.where} · ${money0(account.balance)} · ${state}`} />
      <label className="mt-2 ml-1 flex cursor-pointer items-center gap-2 text-[13px] text-ink-2">
        <input type="checkbox" checked={business} disabled={saving} onChange={(e) => flipBusiness(e.target.checked)} className="size-4 shrink-0 accent-[var(--button)]" />
        {t("This is a business account")}
      </label>
      {error ? (
        <p role="alert" className="mt-2 text-sm font-medium text-crit-ink">
          {error}
        </p>
      ) : null}
    </>
  );
}
