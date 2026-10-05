"use client";

// src/components/halfway-banner.tsx
//
// Shown on every page to someone who entered their email code but not yet
// their authenticator code. Until they do, the database keeps their account
// closed, so pages show them what a signed-out visitor sees. Hidden on the
// page where they finish, where it would only repeat itself.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { KeyRound } from "lucide-react";
import { useT } from "@/components/locale";

export function HalfwayBanner() {
  const t = useT();
  if (usePathname().startsWith("/sign-in/two-step")) return null;
  return (
    <div role="status" className="mx-4 mt-4 flex flex-wrap items-center gap-2 rounded-ctl border border-line bg-surface-1 px-4 py-3 text-sm text-ink-1 sm:mx-6 lg:mx-8">
      <KeyRound aria-hidden className="size-4 shrink-0 text-accent" />
      {t("You're halfway signed in. Enter the code from your authenticator app to see your money.")}{" "}
      <Link href="/sign-in/two-step" className="font-semibold text-accent-ink underline-offset-2 hover:underline">
        {t("Enter code")}
      </Link>
    </div>
  );
}
