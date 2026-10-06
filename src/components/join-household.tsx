"use client";

// src/components/join-household.tsx
//
// The invitation, from the invitee's side. The link's secret is read from
// after "#", kept for this tab only while they sign in (sessionStorage), and
// wiped from the address bar at once. Joining shares nothing: the next step
// is choosing what to share, on Connections.

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleAlert, House, LogIn } from "lucide-react";
import { buttonGhost, buttonPrimary } from "@/components/dialog";
import { useT } from "@/components/locale";
import { Card, EmptyState } from "@/components/ui";
import { msg } from "@/lib/i18n/t";
import { checkHouseholdInvite, declineHousehold, joinHousehold, setHouseholdView } from "@/lib/server/household-actions";

const INVITE_KEY = "prism-household-invite";

type Status = Awaited<ReturnType<typeof checkHouseholdInvite>>["status"] | "loading" | "missing" | "declined";

/** What the page says for each answer, translated where it's shown. */
const SAYS: Partial<Record<Status, { title: string; body: string }>> = {
  missing: { title: msg("No invitation here"), body: msg("Open the link you were sent. It ends with a long code after a # sign.") },
  not_found: { title: msg("This link doesn't work any more"), body: msg("It may have been used already, or cancelled. Ask for a new one.") },
  wrong_email: { title: msg("This invitation is for someone else"), body: msg("Sign in with the email address it was sent to, then open the link again.") },
  expired: { title: msg("This link has expired"), body: msg("Invitations last seven days. Ask for a new one.") },
  already_member: { title: msg("You're already in this household"), body: msg("Choose what you share on Connections.") },
  in_another: { title: msg("You're already in a household"), body: msg("Leave it from your Account page first, then open this link again.") },
  full: { title: msg("This household is full"), body: msg("A household has room for four people.") },
  error: { title: msg("We couldn't check this link just now"), body: msg("Try again in a minute.") },
  declined: { title: msg("Invitation declined"), body: msg("Nothing was shared, and the link won't work again.") },
};

function readToken(): string | null {
  const fromLink = window.location.hash.slice(1);
  try {
    if (fromLink) {
      sessionStorage.setItem(INVITE_KEY, fromLink);
      window.history.replaceState(null, "", window.location.pathname);
      return fromLink;
    }
    return sessionStorage.getItem(INVITE_KEY);
  } catch {
    return fromLink || null;
  }
}

function forget() {
  try {
    sessionStorage.removeItem(INVITE_KEY);
  } catch {
    // Nothing kept, nothing to forget.
  }
}

export function JoinHousehold() {
  const t = useT();
  const router = useRouter();
  // A ref, not state: it's read by the buttons, never drawn.
  const tokenRef = useRef<string | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [invitedBy, setInvitedBy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    const token = readToken();
    tokenRef.current = token;
    (token ? checkHouseholdInvite(token) : Promise.resolve({ status: "missing" as const, invitedBy: null })).then((r) => {
      setStatus(r.status);
      setInvitedBy(r.invitedBy);
    });
  }, []);

  if (status === "loading") {
    return (
      <Card className="p-5 sm:p-6" as="div">
        <div aria-busy="true" aria-label={t("Checking the invitation")} className="space-y-3">
          <div className="skeleton h-6 w-2/3" />
          <div className="skeleton h-4 w-full" />
          <div className="skeleton h-10 w-40" />
        </div>
      </Card>
    );
  }

  if (status === "signed_out") {
    return (
      <Card className="p-5 sm:p-6" as="div">
        <EmptyState
          icon={LogIn}
          title={t("Sign in to see your invitation")}
          body={t("Use the email address the invitation was sent to. New to Prism? The same code creates your account.")}
          action={
            <Link href="/sign-in?next=%2Fhousehold%2Fjoin" className={buttonPrimary}>
              {t("Sign in")}
            </Link>
          }
        />
      </Card>
    );
  }

  if (status === "ok") {
    return (
      <Card className="p-5 sm:p-6" as="div">
        <div className="flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-ctl bg-accent-soft text-accent">
            <House aria-hidden className="size-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-ink-1">{invitedBy ? t("{name} invited you to share a household", { name: invitedBy }) : t("You're invited to share a household")}</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-2">
              <li>{t("You keep your own login. Nothing of yours is shared when you join.")}</li>
              <li>{t("You choose, account by account, what the household sees. They see balances and transactions, never a way into your bank.")}</li>
              <li>{t("You'll see what they share, and you can leave any time.")}</li>
            </ul>
          </div>
        </div>
        {problem ? (
          <p role="alert" className="mt-4 rounded-ctl bg-surface-2 px-3 py-2 text-sm font-medium text-crit-ink">
            {problem}
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = tokenRef.current ? await declineHousehold(tokenRef.current) : { ok: false };
                if (!res.ok) {
                  setProblem(t("That didn't go through, so the invitation still stands. Try again in a moment."));
                  return;
                }
                forget();
                setStatus("declined");
              })
            }
            className={buttonGhost}
          >
            {t("No thanks")}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = tokenRef.current ? await joinHousehold(tokenRef.current) : { ok: false, message: t("No invitation here.") };
                if (!res.ok) {
                  setProblem(res.message ?? t("That didn't work. Try again in a moment."));
                  return;
                }
                forget();
                await setHouseholdView("me");
                router.push("/connections?joined=1#share");
              })
            }
            className={buttonPrimary}
          >
            {pending ? t("Joining…") : t("Join the household")}
          </button>
        </div>
      </Card>
    );
  }

  const says = SAYS[status] ?? SAYS.error!;
  return (
    <Card className="p-5 sm:p-6" as="div">
      <EmptyState
        icon={status === "declined" ? House : CircleAlert}
        title={t(says.title)}
        body={t(says.body)}
        action={
          status === "already_member" ? (
            <Link href="/connections#share" className={buttonPrimary}>
              {t("Choose what to share")}
            </Link>
          ) : status === "in_another" ? (
            <Link href="/account#household" className={buttonGhost}>
              {t("Go to Account")}
            </Link>
          ) : undefined
        }
      />
    </Card>
  );
}
