"use client";

// src/components/household.tsx
//
// The household, from the person's side: who's in it, the invitations still
// open, inviting someone (a link they send themselves, shown once), leaving,
// and choosing which of their own accounts to share. Nothing is shared until
// they turn it on, account by account; turning it off takes effect at once.

import { startTransition, useActionState, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, House, Link2, LogOut, Share2, UserPlus, X } from "lucide-react";
import clsx from "clsx";
import { buttonGhost, buttonPrimary, buttonSmall, Dialog, TextInput } from "@/components/dialog";
import { StatusPill } from "@/components/ui";
import { cancelHouseholdInvite, inviteToHousehold, leaveTheHousehold, setAccountShared, setHouseholdView, type InviteState } from "@/lib/server/household-actions";
import type { Household } from "@/lib/server/household-store";
import { useT } from "@/components/locale";

const MAX = 4;

export function HouseholdCard({ household }: { household: Household | null }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [session, setSession] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [pending, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const seats = household ? household.people.length + household.invites.length : 1;

  function openInvite() {
    setSession((s) => s + 1);
    dialog.current?.showModal();
  }

  return (
    <div className="mt-4 space-y-4">
      {household ? (
        <ul className="divide-y divide-[var(--line)]">
          {household.people.map((p) => (
            <li key={p.userId} className="flex items-center gap-3 py-2.5">
              <div className="grid size-9 shrink-0 place-items-center rounded-pill bg-accent-soft text-sm font-bold text-accent" aria-hidden>
                {(p.firstName ?? p.email).slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-ink-1 [overflow-wrap:anywhere]">
                  {p.firstName ?? p.email}
                  {p.me ? <span className="font-normal text-ink-3"> (you)</span> : null}
                </div>
                <div className="text-xs text-ink-3 [overflow-wrap:anywhere]">{p.email}</div>
              </div>
            </li>
          ))}
          {household.invites.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <div className="grid size-9 shrink-0 place-items-center rounded-pill border border-dashed border-line-strong text-ink-3" aria-hidden>
                <Link2 className="size-4" />
              </div>
              {/* A basis, so on a phone the button drops below rather than squeezing the email letter by letter. */}
              <div className="min-w-0 flex-1 basis-44">
                <div className="text-sm font-semibold text-ink-1 [overflow-wrap:anywhere]">{i.email}</div>
                <div className="text-xs text-ink-3">Invited · link works until {new Date(i.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
              </div>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const res = await cancelHouseholdInvite(i.id);
                    setProblem(res.ok ? null : "That didn't cancel. Try again in a moment.");
                    router.refresh();
                  })
                }
                className={buttonSmall}
              >
                <X aria-hidden className="size-4" />
                Cancel invitation
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {problem ? (
        <p role="alert" className="text-sm font-medium text-crit-ink">
          {problem}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        {seats < MAX ? (
          <button type="button" onClick={openInvite} className={clsx(household ? buttonGhost : buttonPrimary)}>
            <UserPlus aria-hidden className="size-4" />
            Invite someone
          </button>
        ) : (
          <span className="text-sm text-ink-3">Your household is full: four people, invitations included.</span>
        )}
        {household && !leaving ? (
          <button type="button" onClick={() => setLeaving(true)} className="inline-flex items-center gap-1.5 text-sm font-semibold text-crit-ink hover:underline">
            <LogOut aria-hidden className="size-4" />
            Leave household
          </button>
        ) : null}
      </div>

      {leaving ? (
        <div role="alert" className="rounded-ctl border border-line-strong bg-surface-2 p-3">
          <p className="text-sm font-semibold text-ink-1">Leave your household? Everything you share stops at once, and you&apos;ll no longer see theirs.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await leaveTheHousehold();
                  setProblem(res.ok ? null : "That didn't work. Try again in a moment.");
                  setLeaving(false);
                  router.refresh();
                })
              }
              className="inline-flex h-9 items-center gap-1.5 rounded-ctl border border-crit bg-surface-1 px-3.5 text-sm font-semibold text-crit-ink transition-colors duration-150 hover:bg-surface-3 disabled:opacity-60"
            >
              <LogOut aria-hidden className="size-4" />
              {pending ? "Leaving…" : "Leave"}
            </button>
            <button type="button" onClick={() => setLeaving(false)} className={buttonSmall}>
              Stay
            </button>
          </div>
        </div>
      ) : null}

      <Dialog dialogRef={dialog} title="Invite someone" description="They'll see only the accounts you choose to share, and you'll see only theirs." icon={UserPlus}>
        <InviteForm key={session} onClose={() => dialog.current?.close()} />
      </Dialog>
    </div>
  );
}

function InviteForm({ onClose }: { onClose: () => void }) {
  const [state, action, pending] = useActionState(inviteToHousehold, { status: "idle" } as InviteState);
  const [copied, setCopied] = useState(false);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    startTransition(() => action(form));
  }

  if (state.status === "invited") {
    return (
      <div className="space-y-4">
        <p className="text-sm text-ink-2">
          Send this link to <span className="font-semibold text-ink-1">{state.email}</span> by text or email. It works once, for 7 days, and only when
          they&apos;re signed in to Prism with that address. Prism shows it only now.
        </p>
        <div className="flex gap-2">
          <label className="min-w-0 flex-1">
            <span className="sr-only">Invitation link</span>
            <input readOnly value={state.link} onFocus={(e) => e.currentTarget.select()} className="h-10 w-full rounded-ctl border border-line bg-surface-2 px-3 font-mono text-xs text-ink-1" />
          </label>
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(state.link);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
            className={buttonGhost}
          >
            {copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <p role="status" className="sr-only">
          {copied ? "Link copied." : ""}
        </p>
        <div className="flex justify-end">
          <button type="button" onClick={onClose} className={buttonPrimary}>
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate>
      <TextInput name="email" label="Their email" defaultValue="" autoComplete="email" hint="The address they sign in to Prism with. They'll need to be 18 or older." error={state.status === "error" ? state.message : undefined} />
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} className={buttonGhost}>
          Cancel
        </button>
        <button type="submit" disabled={pending} className={clsx(buttonPrimary, "min-w-28")}>
          {pending ? "Making link…" : "Make the link"}
        </button>
      </div>
    </form>
  );
}

export type ShareableAccount = { id: string; name: string; detail: string; itemId: string | null; shareable: boolean; why?: string };

/** One row per account the person owns: shared with the household, or private (the default). */
export function ShareAccounts({ accounts, shared }: { accounts: ShareableAccount[]; shared: string[] }) {
  const router = useRouter();
  const [on, setOn] = useState(() => new Set(shared));
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (accounts.length === 0) {
    return <p className="mt-3 text-sm text-ink-3">Connect a bank, or add something on Net worth, and you can choose to share it here.</p>;
  }
  return (
    <div className="mt-3">
      <ul className="divide-y divide-[var(--line)]">
        {accounts.map((a) => {
          const isOn = on.has(a.id);
          return (
            <li key={a.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1 basis-44">
                <div className="text-sm font-semibold text-ink-1 [overflow-wrap:anywhere]">{a.name}</div>
                <div className="text-xs text-ink-3 [overflow-wrap:anywhere]">{a.shareable ? a.detail : a.why}</div>
              </div>
              {a.shareable ? (
                <button
                  type="button"
                  aria-pressed={isOn}
                  aria-label={`Share ${a.name} with your household`}
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const next = new Set(on);
                      if (isOn) next.delete(a.id);
                      else next.add(a.id);
                      setOn(next);
                      const res = await setAccountShared(a.id, a.itemId, !isOn);
                      if (!res.ok) {
                        setOn(on);
                        setProblem("That didn't change. Try again in a moment.");
                      } else setProblem(null);
                      router.refresh();
                    })
                  }
                  className={clsx(
                    "inline-flex h-9 min-w-28 items-center justify-center gap-1.5 rounded-pill border px-3 text-sm font-semibold transition-colors duration-150 disabled:opacity-60",
                    isOn ? "border-accent bg-accent-soft text-accent-ink" : "border-line-strong text-ink-2 hover:bg-surface-3",
                  )}
                >
                  {isOn ? <Share2 aria-hidden className="size-4" /> : <House aria-hidden className="size-4" />}
                  {isOn ? "Shared" : "Private"}
                </button>
              ) : (
                <StatusPill status="neutral">Can&apos;t share yet</StatusPill>
              )}
            </li>
          );
        })}
      </ul>
      {problem ? (
        <p role="alert" className="mt-2 text-sm font-medium text-crit-ink">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

/** Me / Household, in the top bar, for someone in a household. */
export function ViewSwitch({ view }: { view: "me" | "household" }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const choose = (v: "me" | "household") =>
    start(async () => {
      await setHouseholdView(v);
      router.refresh();
    });
  return (
    <div role="group" aria-label={t("Whose money")} className="inline-flex h-9 items-center rounded-pill border border-line bg-surface-2 p-0.5 text-xs font-semibold">
      {(["me", "household"] as const).map((v) => (
        <button
          key={v}
          type="button"
          aria-pressed={view === v}
          disabled={pending}
          onClick={() => choose(v)}
          className={clsx("h-8 rounded-pill px-3 transition-colors duration-150", view === v ? "bg-surface-1 text-ink-1 shadow-card" : "text-ink-3 hover:text-ink-1")}
        >
          {v === "me" ? t("Me") : t("Household")}
        </button>
      ))}
    </div>
  );
}
