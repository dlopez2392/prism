// src/app/privacy/switches.ts — what the operator has switched on that the
// privacy policy's words follow, read once per page so its English and its
// Spanish are always handed the same answers.

import { alertsConfig } from "@/lib/alerts/send";
import { chainEnabled } from "@/lib/crypto/balances";
import { homeValuesEnabled } from "@/lib/homevalue/rentcast";
import { liabilitiesEnabled } from "@/lib/plaid/liabilities";
import type { PrivacySwitches } from "@/lib/privacy";

export function privacySwitches(): PrivacySwitches {
  return { liabilities: liabilitiesEnabled(), homeValues: homeValuesEnabled(), alchemy: chainEnabled("ethereum"), alerts: alertsConfig() !== null };
}
