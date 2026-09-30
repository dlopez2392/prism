// src/lib/finance/household.ts
//
// The Household view: what each member chose to share, and nothing else,
// as one set of money. Mine is narrowed here to my shared accounts; each
// other member's arrives already opened and narrowed to theirs (see
// server/finance.ts). Every account and institution says whose it is, and
// every id is namespaced by its owner (see householdData). Nobody's own
// budgets or goals come along: the household's own plan is applied on top
// by the loader (server/finance.ts).

import type { Account, FinanceData, Institution, Transaction } from "./types";

/** One member's shared money, ready to show. */
export type MemberMoney = { userId: string; name: string; institutions: Institution[]; accounts: Account[]; transactions: Transaction[] };

/** Only what `shared` names: those accounts, their transactions, and the institutions they belong to. */
export function narrowTo<T extends Pick<FinanceData, "institutions" | "accounts" | "transactions">>(money: T, shared: ReadonlySet<string>): Pick<FinanceData, "institutions" | "accounts" | "transactions"> {
  const accounts = money.accounts.filter((a) => shared.has(a.id));
  const ids = new Set(accounts.map((a) => a.id));
  const institutionIds = new Set(accounts.map((a) => a.institutionId));
  return {
    accounts,
    transactions: money.transactions.filter((t) => ids.has(t.accountId)),
    institutions: money.institutions.filter((i) => institutionIds.has(i.id)),
  };
}

/** "<owner>:<id>": the same for every member, so a household goal's account means one account to all of them. */
export const householdId = (owner: string, id: string) => `${owner}:${id}`;

function owned(m: MemberMoney): Pick<FinanceData, "institutions" | "accounts" | "transactions"> {
  const ns = (id: string) => householdId(m.userId, id);
  return {
    institutions: m.institutions.map((i) => ({ ...i, id: ns(i.id), name: `${i.name} · ${m.name}` })),
    accounts: m.accounts.map((a) => ({ ...a, id: ns(a.id), institutionId: ns(a.institutionId) })),
    transactions: m.transactions.map((t) => ({ ...t, id: ns(t.id), accountId: ns(t.accountId) })),
  };
}

/**
 * Everyone's shared money as one set. Every id — mine included — is
 * namespaced by its owner, so an id means the same account whoever is
 * looking, and two people's "Our house" never collide.
 */
export function householdData(mine: FinanceData, myShares: ReadonlySet<string>, me: { userId: string; name: string }, others: MemberMoney[]): FinanceData {
  const my = { ...me, ...narrowTo(mine, myShares) };
  const parts = [owned(my), ...others.map((m) => owned(m))];
  const shared = new Set(my.accounts.map((a) => a.id));
  return {
    source: "plaid",
    today: mine.today,
    household: { name: "Your household", firstName: mine.household.firstName },
    institutions: parts.flatMap((p) => p.institutions),
    accounts: parts.flatMap((p) => p.accounts),
    transactions: parts.flatMap((p) => p.transactions).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
    budgets: [],
    goals: [],
    // Only my own shared accounts' holdings are known here; another member's investments load live, as them.
    holdings: mine.holdings.filter((h) => shared.has(h.accountId)).map((h) => ({ ...h, accountId: householdId(me.userId, h.accountId) })),
    credit: null,
  };
}
