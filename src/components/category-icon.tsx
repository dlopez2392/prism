// src/components/category-icon.tsx
//
// A category's icon in a tinted chip of its own colour — identity from the
// mark beside the text, never from coloured text.

import {
  ArrowLeftRight,
  Banknote,
  Car,
  HeartPulse,
  House,
  PartyPopper,
  Plane,
  Receipt,
  Shapes,
  ShoppingBag,
  Utensils,
  type LucideIcon,
} from "lucide-react";
import clsx from "clsx";
import { CATEGORIES, categoryColor } from "@/lib/finance/categories";
import type { CategoryId } from "@/lib/finance/types";

const ICONS: Record<string, LucideIcon> = {
  house: House,
  utensils: Utensils,
  car: Car,
  "shopping-bag": ShoppingBag,
  "party-popper": PartyPopper,
  "heart-pulse": HeartPulse,
  plane: Plane,
  receipt: Receipt,
  shapes: Shapes,
  banknote: Banknote,
  "arrow-left-right": ArrowLeftRight,
};

export function CategoryIcon({ category, size = "md" }: { category: CategoryId; size?: "sm" | "md" | "lg" }) {
  const meta = CATEGORIES[category];
  const Icon = ICONS[meta.icon] ?? Shapes;
  const color = category === "income" ? "var(--flow-in)" : categoryColor(category);
  return (
    <span
      aria-hidden
      className={clsx(
        "grid shrink-0 place-items-center rounded-ctl",
        size === "sm" && "size-7",
        size === "md" && "size-9",
        size === "lg" && "size-11",
      )}
      style={{ background: `color-mix(in srgb, ${color} 16%, transparent)`, color }}
    >
      <Icon className={size === "lg" ? "size-5" : size === "sm" ? "size-3.5" : "size-4"} strokeWidth={2.25} />
    </span>
  );
}
