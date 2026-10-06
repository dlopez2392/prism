// src/app/connections/return/page.tsx — where a bank that signs people in on
// its own website (Chase, Bank of America…) sends them back to. Its address
// is the PLAID_REDIRECT_URI allow-listed with Plaid, so it must stay exactly
// this path (RETURN_PATH in src/lib/plaid/client.ts).
//
// Desktop browsers open the bank's site in a pop-up and never come here.
// Phones and in-app browsers, which block pop-ups, take the whole page to the
// bank, and this page picks the connection up again: the same Link token,
// kept in an httpOnly cookie while they were away (src/lib/plaid/return.ts).

import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Landmark } from "lucide-react";
import { ConnectBank } from "@/components/connect-bank";
import { ResumeBank } from "@/components/resume-bank";
import { ButtonLink, Card, EmptyState } from "@/components/ui";
import { RETURN_COOKIE, RETURN_FALLBACK, returnView } from "@/lib/plaid/return";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Finishing your connection"), robots: { index: false } };
}

export default async function BankReturnPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const view = returnView((await searchParams).oauth_state_id, (await cookies()).get(RETURN_COOKIE)?.value);

  if (view.kind === "resume") return <ResumeBank linkToken={view.linkToken} back={view.back} reconnect={view.reconnect} />;
  const t = await getT();

  if (view.kind === "unfinished") {
    // Back from the bank with nothing to resume. Often it's already done: pressing Back after connecting lands here.
    return (
      <div className="mx-auto max-w-md pt-2 sm:pt-8">
        <Card className="p-6 sm:p-8">
          <div className="grid size-12 place-items-center rounded-card bg-accent-soft text-accent">
            <Landmark aria-hidden className="size-6" />
          </div>
          <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-ink-1">{t("Nothing left to finish here")}</h1>
          <p className="mt-3 text-sm text-ink-2">
            {t(
              "If you already finished at your bank, you're all set: it's on Connections. If not, the sign-in took over an hour or finished in a different browser, so nothing was shared. Starting again takes a minute.",
            )}
          </p>
          <div className="mt-6 flex flex-wrap items-start gap-3">
            <ButtonLink href={RETURN_FALLBACK} variant="primary">
              {t("Go to Connections")}
            </ButtonLink>
            <ConnectBank label={t("Connect a bank")} landOn={RETURN_FALLBACK} />
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md pt-2 sm:pt-8">
      <Card>
        <EmptyState
          icon={Landmark}
          title={t("Nothing to finish here")}
          body={t("When your bank asks you to sign in on its own website, this is where it sends you back to finish connecting. Start a connection from Connections.")}
          action={<ButtonLink href={RETURN_FALLBACK}>{t("Go to Connections")}</ButtonLink>}
        />
      </Card>
    </div>
  );
}
