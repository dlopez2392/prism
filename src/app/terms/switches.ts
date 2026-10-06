// src/app/terms/switches.ts — what the operator has switched on that the
// Terms' words follow, read once per page so their English and their Spanish
// are always handed the same answers: while Prism Plus can be bought, the
// Terms say what it costs and how it renews; until then, that Prism is free.

import { billingConfig } from "@/lib/billing/plus";
import type { TermsSwitches } from "@/lib/terms";

export function termsSwitches(): TermsSwitches {
  return { billing: billingConfig() !== null };
}
