// src/app/household/join/page.tsx — where a household invitation link lands.
// The secret rides after "#", so it never reaches a server or its logs; the
// page reads it in the browser and asks the server what it may say about it.

import type { Metadata } from "next";
import { JoinHousehold } from "@/components/join-household";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Join a household" };

export default function JoinHouseholdPage() {
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Join a household" subtitle="Share chosen accounts with the people you live with. Each of you keeps your own login." />
      <JoinHousehold />
    </div>
  );
}
