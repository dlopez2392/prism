"use client";

// src/components/wallets.tsx
//
// "Add a wallet" on Connections: a self-custody crypto wallet by its public
// address (or, for Bitcoin, the whole wallet by its extended public key),
// told first exactly what that lets Prism do (see what it holds, never move
// it), where the addresses go to be read, and that it stays the person's own.
// Anything that can spend is stopped here, before it is sent (secrets.ts).
// And "Remove", which asks once.

import { startTransition, useActionState, useRef, useState, type FormEvent } from "react";
import { CircleCheck, Plus, Trash2, Wallet as WalletIcon } from "lucide-react";
import clsx from "clsx";
import { buttonGhost, buttonPrimary, buttonSmall, Dialog, FormMessage, TextInput } from "@/components/dialog";
import { secretKind, secretWarning } from "@/lib/crypto/secrets";
import { CHAINS, WALLET_NAME_MAX, type Chain } from "@/lib/crypto/wallets";
import { IDLE, type PlanFormState } from "@/lib/finance/plan";
import { addWallet, removeWallet } from "@/lib/server/wallet-actions";

const ORDER: Chain[] = ["bitcoin", "ethereum", "solana"];

/** What the address field asks for, per network: Bitcoin also takes a whole wallet. */
const FIELD: Record<Chain, { label: string; hint: string; readBy: string }> = {
  bitcoin: {
    label: "Bitcoin address or extended public key",
    hint: "An address (bc1q…, 1… or 3…) shows that one address. Your wallet's extended public key (xpub, ypub or zpub) shows everything in it.",
    readBy:
      "Prism sends the address, and nothing else about you, to mempool.space to read its balance while you use Prism. For an extended public key, Prism works out the wallet's addresses itself and sends mempool.space only those, never the key.",
  },
  ethereum: {
    label: "Ethereum address",
    hint: `Copy it from your wallet app: ${CHAINS.ethereum.placeholder}`,
    readBy: "Prism sends the address, and nothing else about you, to Alchemy to read its balance, about every 15 minutes while you use Prism.",
  },
  solana: {
    label: "Solana address",
    hint: `Copy it from your wallet app: ${CHAINS.solana.placeholder}`,
    readBy: "Prism sends the address, and nothing else about you, to Alchemy to read its balance, about every 15 minutes while you use Prism.",
  },
};

/** The "Add a wallet" button, its dialog, and the line that says what was added. */
export function AddWallet({ enabled, full }: { enabled: Record<Chain, boolean>; full: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [session, setSession] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center justify-end gap-y-1">
      <p role="status" className={clsx("flex items-center gap-1 text-xs font-semibold text-good-ink", notice && "mr-3")}>
        {notice ? (
          <>
            <CircleCheck aria-hidden className="size-3.5" />
            {notice}
          </>
        ) : null}
      </p>
      <button
        type="button"
        disabled={full}
        onClick={() => {
          setSession((s) => s + 1);
          setNotice(null);
          dialog.current?.showModal();
        }}
        className={clsx(buttonSmall, "disabled:opacity-60")}
      >
        <Plus aria-hidden className="size-4" />
        Add a wallet
      </button>
      <Dialog
        dialogRef={dialog}
        title="Add a wallet"
        icon={WalletIcon}
        description="By its public address: the one you'd give someone to pay you. Prism can see what it holds and can never move it."
      >
        <WalletForm
          key={session}
          enabled={enabled}
          onDone={(message) => {
            setNotice(message);
            dialog.current?.close();
          }}
          onCancel={() => dialog.current?.close()}
        />
      </Dialog>
    </div>
  );
}

function WalletForm({ enabled, onDone, onCancel }: { enabled: Record<Chain, boolean>; onDone: (message: string) => void; onCancel: () => void }) {
  const [state, action, pending] = useActionState(async (prev: PlanFormState, form: FormData) => {
    const next = await addWallet(prev, form);
    if (next.status === "saved") onDone(next.message);
    return next;
  }, IDLE);
  const [chain, setChain] = useState<Chain>("bitcoin");
  // A secret stopped here, before it was sent: shown instead of the server's word until the next try.
  const [stopped, setStopped] = useState<string | null>(null);
  const errors = stopped ? { address: stopped } : state.status === "error" ? (state.fields ?? {}) : {};

  // By hand, not <form action>: React resets a form after its action, which would clear a pasted address that needs a fix.
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const secret = secretKind(form.get("address"));
    if (secret) {
      // Never sent, and not left sitting in the field either.
      const field = e.currentTarget.elements.namedItem("address");
      if (field instanceof HTMLInputElement) field.value = "";
      setStopped(secretWarning(secret, false));
      return;
    }
    setStopped(null);
    startTransition(() => action(form));
  }

  return (
    <form onSubmit={submit} noValidate>
      <div className="grid gap-4">
        <fieldset>
          <legend className="mb-2 text-[13px] font-semibold text-ink-2">Network</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {ORDER.map((c) => (
              <label key={c} className={clsx("relative", !enabled[c] && "opacity-60")}>
                <input type="radio" name="chain" value={c} checked={chain === c} disabled={!enabled[c]} onChange={() => setChain(c)} className="peer sr-only" />
                <span className="flex min-h-12 cursor-pointer flex-col justify-center rounded-ctl border border-line bg-surface-2 px-3 py-2 text-sm font-semibold text-ink-1 transition-colors duration-150 hover:bg-surface-3 peer-checked:border-accent peer-checked:bg-accent-soft peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--focus)] peer-disabled:cursor-not-allowed">
                  {CHAINS[c].label}
                  {!enabled[c] ? <span className="text-xs font-normal text-ink-3">Coming soon</span> : null}
                </span>
              </label>
            ))}
          </div>
          {errors.chain ? <p className="mt-1 text-xs font-medium text-crit-ink">{errors.chain}</p> : null}
        </fieldset>
        <TextInput key={chain} name="address" label={FIELD[chain].label} defaultValue="" maxLength={400} error={errors.address} hint={FIELD[chain].hint} />
        <TextInput name="name" label="Name (optional)" defaultValue="" maxLength={WALLET_NAME_MAX} error={errors.name} hint={`For example, “Cold storage”. Blank is “${CHAINS[chain].label} wallet”.`} />
        <p className="rounded-ctl border border-line bg-surface-2 p-3 text-xs text-ink-2">
          {FIELD[chain].readBy} It&apos;s kept encrypted in your account and never shared with your household. Never enter a recovery phrase or private key: Prism will
          never ask for one.
        </p>
      </div>

      <FormMessage state={state} />

      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={buttonGhost}>
          Cancel
        </button>
        <button type="submit" disabled={pending} className={clsx(buttonPrimary, "min-w-24")}>
          {pending ? "Reading…" : "Add"}
        </button>
      </div>
    </form>
  );
}

/** Remove a wallet: asks once, then its address (or a whole wallet's key) is gone from the account. */
export function RemoveWallet({ id, name, whole = false }: { id: string; name: string; whole?: boolean }) {
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
      <Dialog dialogRef={dialog} title={`Remove ${name}?`} icon={Trash2} description={`It leaves every screen in Prism, and its ${whole ? "extended public key" : "address"} is deleted from your account.`}>
        <p className="text-sm text-ink-2">The wallet itself isn&apos;t touched. You can add it again any time.</p>
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
              const form = new FormData();
              form.set("id", id);
              const r = await removeWallet(IDLE, form);
              if (r.status === "saved") dialog.current?.close();
              setState({ busy: false, error: r.status === "error" ? r.message : null });
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
