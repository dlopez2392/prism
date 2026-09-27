// src/lib/finance/networth.ts
//
// Net worth, its history, and what it is made of. Account histories are
// month-end balances (oldest first), so every series here has one point per
// month and the last point is "now".

import type { Account, AccountKind, AssetClass, Cents, Goal, Holding, ISODate } from "./types";
import { addMonths, lastMonths } from "./dates";

export type NetWorthPoint = { month: string; assets: Cents; debts: Cents; net: Cents };

export function netWorthSeries(accounts: Account[], today: ISODate): NetWorthPoint[] {
  const len = Math.max(0, ...accounts.map((a) => a.history.length));
  const months = lastMonths(today, len);
  return months.map((month, i) => {
    let assets = 0;
    let debts = 0;
    for (const a of accounts) {
      // Shorter histories (an account linked recently) align to the right.
      const v = a.history[i - (len - a.history.length)];
      if (v === undefined) continue;
      if (v >= 0) assets += v;
      else debts -= v;
    }
    return { month, assets, debts, net: assets - debts };
  });
}

export const KIND_GROUPS: { label: string; kinds: AccountKind[] }[] = [
  { label: "Cash", kinds: ["checking", "savings"] },
  { label: "Investments", kinds: ["investment", "retirement", "crypto"] },
  { label: "Property", kinds: ["property"] },
  { label: "Credit cards", kinds: ["credit"] },
  { label: "Loans", kinds: ["loan"] },
];

export function groupAccounts(accounts: Account[]) {
  return KIND_GROUPS.map((g) => {
    const list = accounts.filter((a) => g.kinds.includes(a.kind));
    return { label: g.label, accounts: list, total: list.reduce((s, a) => s + a.balance, 0) };
  }).filter((g) => g.accounts.length > 0);
}

export const ASSET_CLASS_SLOT: Record<AssetClass, number> = {
  "US stocks": 1,
  International: 2,
  Bonds: 3,
  Cash: 4,
  Crypto: 5,
  "Real estate": 6,
};

export function allocation(holdings: Holding[]) {
  const total = holdings.reduce((s, h) => s + h.value, 0);
  const by = new Map<AssetClass, Cents>();
  for (const h of holdings) by.set(h.assetClass, (by.get(h.assetClass) ?? 0) + h.value);
  return [...by]
    .map(([assetClass, value]) => ({ assetClass, value, share: total > 0 ? value / total : 0 }))
    .sort((a, b) => ASSET_CLASS_SLOT[a.assetClass] - ASSET_CLASS_SLOT[b.assetClass]);
}

export type GoalProjection = {
  progress: number;
  remaining: Cents;
  /** Months to go at the current contribution; null if it never gets there. */
  monthsToGo: number | null;
  projectedDate: ISODate | null;
  onTrack: boolean;
  /** Monthly contribution that would land exactly on the target date. */
  neededMonthly: Cents;
};

export function projectGoal(goal: Goal, today: ISODate, monthly = goal.monthlyContribution): GoalProjection {
  const remaining = Math.max(0, goal.target - goal.saved);
  const monthsToGo = remaining === 0 ? 0 : monthly > 0 ? Math.ceil(remaining / monthly) : null;
  const projectedDate = monthsToGo === null ? null : addMonths(today, monthsToGo);
  const monthsLeft = Math.max(1, monthsUntil(today, goal.targetDate));
  return {
    progress: goal.target > 0 ? Math.min(1, goal.saved / goal.target) : 1,
    remaining,
    monthsToGo,
    projectedDate,
    onTrack: projectedDate !== null && projectedDate <= goal.targetDate,
    neededMonthly: Math.ceil(remaining / monthsLeft),
  };
}

export function monthsUntil(from: ISODate, to: ISODate): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty! - fy!) * 12 + (tm! - fm!);
}
