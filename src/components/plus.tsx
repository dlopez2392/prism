// src/components/plus.tsx
//
// Where someone on the free plan reaches a part of Prism Plus: one sentence
// of what it is, what it costs to start, and the way to it. The same card on
// every screen, so it reads as an offer, never as a wall. Server-safe; the
// caller passes `t` and whether a first subscription would start with the
// free days.

import { Sparkles } from "lucide-react";
import { ButtonLink, Card, EmptyState } from "@/components/ui";
import { plusNeeds, priceLabel, pricingFor, PRICES, TRIAL_DAYS, type PlusFeature } from "@/lib/billing/plans";
import { BRAND } from "@/lib/brand";
import type { T } from "@/lib/i18n/t";

/** What starting costs, in one line: the free days first when there are any. */
export function plusStartLine(trial: boolean, t: T): string {
  const price = priceLabel(PRICES.plus.month);
  return trial
    ? t("{n} days free, then {price} a month. Cancel any time.", { n: TRIAL_DAYS, price })
    : t("{price} a month, or less by the year. Cancel any time.", { price });
}

/**
 * The offer, inside a card the screen already has (an empty state's place).
 * `quiet` makes its button a ghost, for a screen whose one primary is
 * elsewhere (the Account page's own plan card).
 */
export function PlusNeeded({ feature, trial, t, action, quiet = false }: { feature: PlusFeature; trial: boolean; t: T; action?: string; quiet?: boolean }) {
  return (
    <EmptyState
      icon={Sparkles}
      title={plusNeeds(feature, t)}
      body={plusStartLine(trial, t)}
      action={
        <ButtonLink href={pricingFor(feature)} variant={quiet ? "ghost" : "primary"}>
          {action ?? t("See {plus}", { plus: BRAND.plus })}
        </ButtonLink>
      }
    />
  );
}

/** The offer as a card of its own, for a screen that has nothing else to show without it. */
export function PlusCard({ feature, trial, t, className }: { feature: PlusFeature; trial: boolean; t: T; className?: string }) {
  return (
    <Card className={className}>
      <PlusNeeded feature={feature} trial={trial} t={t} />
    </Card>
  );
}
