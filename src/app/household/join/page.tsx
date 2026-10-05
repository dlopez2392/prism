// src/app/household/join/page.tsx — where a household invitation link lands.
// The secret rides after "#", so it never reaches a server or its logs; the
// page reads it in the browser and asks the server what it may say about it.

import type { Metadata } from "next";
import { JoinHousehold } from "@/components/join-household";
import { PageHeader } from "@/components/ui";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Join a household") };
}

export default async function JoinHouseholdPage() {
  const t = await getT();
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title={t("Join a household")} subtitle={t("Share chosen accounts with the people you live with. Each of you keeps your own login.")} />
      <JoinHousehold />
    </div>
  );
}
