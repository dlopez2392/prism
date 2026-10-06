// src/lib/finance/categories.ts
//
// The category taxonomy and its colour assignment. A category's colour slot is
// FIXED here — colour follows the entity, never its rank — so "Food & dining"
// is pink on the donut, the Sankey, the stacked bars and the budget ring alike,
// and filtering a category out never repaints the survivors (DESIGN.md §Colour).

import { EN, msg, type T } from "@/lib/i18n/t";
import type { CategoryId, SpendCategoryId } from "./types";

export type CategoryMeta = {
  id: CategoryId;
  label: string;
  /** 1–8 → --c-N; 0 → --c-other. */
  slot: number;
  /** lucide-react icon name, resolved in components/category-icon.tsx. */
  icon: string;
};

export const CATEGORIES: Record<CategoryId, CategoryMeta> = {
  housing: { id: "housing", label: msg("Housing"), slot: 1, icon: "house" },
  food: { id: "food", label: msg("Food & dining"), slot: 2, icon: "utensils" },
  transport: { id: "transport", label: msg("Transport"), slot: 3, icon: "car" },
  shopping: { id: "shopping", label: msg("Shopping"), slot: 4, icon: "shopping-bag" },
  fun: { id: "fun", label: msg("Fun"), slot: 5, icon: "party-popper" },
  health: { id: "health", label: msg("Health"), slot: 6, icon: "heart-pulse" },
  travel: { id: "travel", label: msg("Travel"), slot: 7, icon: "plane" },
  bills: { id: "bills", label: msg("Bills"), slot: 8, icon: "receipt" },
  other: { id: "other", label: msg("Other"), slot: 0, icon: "shapes" },
  income: { id: "income", label: msg("Income"), slot: 0, icon: "banknote" },
  transfer: { id: "transfer", label: msg("Transfer"), slot: 0, icon: "arrow-left-right" },
};

/** Spending categories in slot order — the order every chart stacks them in. */
export const SPEND_CATEGORIES: SpendCategoryId[] = [
  "housing",
  "food",
  "transport",
  "shopping",
  "fun",
  "health",
  "travel",
  "bills",
  "other",
];

export function isSpendCategory(c: CategoryId): c is SpendCategoryId {
  return c !== "income" && c !== "transfer";
}

/** The CSS colour for a series slot. Slot 0 is the neutral "Other". */
export function slotColor(slot: number): string {
  return slot >= 1 && slot <= 8 ? `var(--c-${slot})` : "var(--c-other)";
}

export function categoryColor(id: CategoryId): string {
  return slotColor(CATEGORIES[id].slot);
}

/** A category's name, in the language of `t`. */
export function categoryLabel(id: CategoryId, t: T = EN): string {
  return t(CATEGORIES[id].label);
}
