// src/lib/finance/categories.ts
//
// The category taxonomy and its colour assignment. A category's colour slot is
// FIXED here — colour follows the entity, never its rank — so "Food & dining"
// is pink on the donut, the Sankey, the stacked bars and the budget ring alike,
// and filtering a category out never repaints the survivors (DESIGN.md §Colour).

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
  housing: { id: "housing", label: "Housing", slot: 1, icon: "house" },
  food: { id: "food", label: "Food & dining", slot: 2, icon: "utensils" },
  transport: { id: "transport", label: "Transport", slot: 3, icon: "car" },
  shopping: { id: "shopping", label: "Shopping", slot: 4, icon: "shopping-bag" },
  fun: { id: "fun", label: "Fun", slot: 5, icon: "party-popper" },
  health: { id: "health", label: "Health", slot: 6, icon: "heart-pulse" },
  travel: { id: "travel", label: "Travel", slot: 7, icon: "plane" },
  bills: { id: "bills", label: "Bills", slot: 8, icon: "receipt" },
  other: { id: "other", label: "Other", slot: 0, icon: "shapes" },
  income: { id: "income", label: "Income", slot: 0, icon: "banknote" },
  transfer: { id: "transfer", label: "Transfer", slot: 0, icon: "arrow-left-right" },
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

export function categoryLabel(id: CategoryId): string {
  return CATEGORIES[id].label;
}
