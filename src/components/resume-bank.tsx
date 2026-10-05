"use client";

// src/components/resume-bank.tsx
//
// Back from a bank's own sign-in page: reopen Link with the SAME Link token
// and this page's full address (Plaid's oauth_state_id included), so Link
// picks up exactly where it left off. Then save the bank as usual (or, when
// they were signing in to an already-linked bank again, nothing to save: the
// same connection carries on) and take the person back to where they
// started. A full page load, so every screen, the layout included, redraws.

import { bankSignedInAgain } from "@/lib/server/bank-actions";
import { useEffect, useRef, useState } from "react";
import { Landmark } from "lucide-react";
import { ConnectBank } from "@/components/connect-bank";
import { ButtonLink, Card, StatusPill } from "@/components/ui";
import { signInToConnect } from "@/lib/linking";
import { loadLink, saveBank, type PlaidHandler } from "@/lib/plaid/link";
import { useT } from "@/components/locale";
import { msg, type T } from "@/lib/i18n/t";

/** `name`: the bank's own name, or null when Plaid didn't say, and the words say "your bank" instead. */
type State =
  | { kind: "resuming" }
  | { kind: "saving"; name: string | null }
  | { kind: "done"; name: string | null; reconnected: boolean }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

const TITLE: Record<State["kind"], string> = {
  resuming: msg("Finishing your bank connection"),
  saving: msg("Finishing your bank connection"),
  done: msg("Your bank is connected"),
  cancelled: msg("Your bank isn't connected"),
  error: msg("We couldn't finish connecting"),
};

/** `reconnect`: the linked bank being signed in to again, if that's what this was. */
export function ResumeBank({ linkToken, back, reconnect = null }: { linkToken: string; back: string; reconnect?: string | null }) {
  const t = useT();
  const [state, setState] = useState<State>({ kind: "resuming" });
  // Link resumes a bank sign-in once. React's development double-run of effects must not start it twice.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let handler: PlaidHandler | null = null;
    loadLink()
      .then((Plaid) => {
        handler = Plaid.create({
          token: linkToken,
          receivedRedirectUri: window.location.href,
          onSuccess: async (publicToken, metadata) => {
            const name = metadata.institution?.name ?? null;
            if (reconnect) {
              // Update mode: the connection Prism already holds works again; there's nothing to exchange.
              handler?.destroy();
              setState({ kind: "done", name, reconnected: true });
              // Whatever Plaid warned about this bank is over now.
              await bankSignedInAgain(reconnect);
              window.location.replace(back);
              return;
            }
            setState({ kind: "saving", name });
            const saved = await saveBank(publicToken);
            handler?.destroy();
            if (!saved.ok && saved.signIn) {
              window.location.assign(signInToConnect("bank", back));
              return;
            }
            if (!saved.ok) {
              setState({ kind: "error", message: saved.message });
              return;
            }
            setState({ kind: "done", name: saved.institutionName ?? name, reconnected: false });
            window.location.replace(back);
          },
          onExit: (err) => {
            handler?.destroy();
            setState(err ? { kind: "error", message: err.display_message ?? t("Your bank didn't finish the connection. Nothing was shared.") } : { kind: "cancelled" });
          },
        });
        handler.open();
      })
      .catch(() => setState({ kind: "error", message: t("The secure connection window didn't load. Check your connection, then try again.") }));
  }, [linkToken, back, reconnect, t]);

  const settled = state.kind === "cancelled" || state.kind === "error";
  return (
    <div className="mx-auto max-w-md pt-2 sm:pt-8">
      <Card className="p-6 sm:p-8">
        <div className="grid size-12 place-items-center rounded-card bg-accent-soft text-accent">
          <Landmark aria-hidden className="size-6" />
        </div>
        <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-ink-1">{t(TITLE[state.kind])}</h1>
        <div role="status" aria-live="polite" className="mt-3">
          {state.kind === "resuming" ? (
            <div aria-busy="true">
              <p className="text-sm text-ink-2">{t("Your bank sent you back. Finish the last step in the secure window and you're done.")}</p>
              <div className="skeleton mt-4 h-6 w-44 rounded-pill" />
            </div>
          ) : state.kind === "saving" ? (
            <StatusPill status="syncing">{state.name === null ? t("Saving your bank…") : t("Saving {bank}…", { bank: state.name })}</StatusPill>
          ) : state.kind === "done" ? (
            <div>
              <StatusPill status="good">{doneLabel(state.name, state.reconnected, t)}</StatusPill>
              <p className="mt-2 text-sm text-ink-2">
                {state.reconnected ? t("Taking you back and bringing it up to date…") : t("Taking you back and pulling in your transactions…")}
              </p>
            </div>
          ) : state.kind === "cancelled" ? (
            // The heading says it in words; a status pill here would wear the kit's neutral check mark, which reads as success.
            <p className="text-sm text-ink-2">
              {reconnect
                ? t("You closed the window before finishing, so your bank still needs you to sign in. You can try again any time.")
                : t("You closed the window before finishing, so nothing was shared. You can start again any time.")}
            </p>
          ) : (
            <div>
              <StatusPill status="warn">{t("Not connected")}</StatusPill>
              <p className="mt-2 text-sm text-ink-2">{state.message}</p>
            </div>
          )}
        </div>
        {settled ? (
          <div className="mt-6 flex flex-wrap items-start gap-3">
            <ConnectBank variant="primary" label={t("Try again")} landOn={back} reconnect={reconnect ?? undefined} />
            <ButtonLink href={back}>{t("Go back")}</ButtonLink>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

/** "Chase is connected", or "Your bank is connected" when Plaid didn't say which. */
function doneLabel(name: string | null, reconnected: boolean, t: T): string {
  if (name === null) return reconnected ? t("Your bank is reconnected") : t("Your bank is connected");
  return reconnected ? t("{bank} is reconnected", { bank: name }) : t("{bank} is connected", { bank: name });
}
