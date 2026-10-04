// src/lib/finance/merchant.ts
//
// One shop under its many bank spellings: "COSTCO #482", "Costco 1093" and
// "costco" are the same place. What repeats (recurring.ts) groups by it, and
// a split that follows a shop (details.ts) is kept by it.

export function normalizeMerchant(merchant: string): string {
  return merchant
    .toLowerCase()
    .replace(/[#*]\s*\d+/g, "")
    .replace(/\s+\d{3,}$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
