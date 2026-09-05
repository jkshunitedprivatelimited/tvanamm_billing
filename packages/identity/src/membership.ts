import type { MembershipRole, WorkspaceCard } from '@jksh/contracts';

export interface MembershipRow {
  id: string;
  role: MembershipRole;
  status: 'active' | 'suspended' | 'revoked';
  organizationId: string;
  brandId: string | null;
  franchiseId: string | null;
}

export type AdminRouting =
  | { outcome: 'single_workspace'; membershipId: string; redirectTo: string }
  | { outcome: 'select_workspace'; membershipIds: string[] }
  | { outcome: 'no_admin_access' };

function redirectFor(role: MembershipRole): string {
  return role === 'accountant' ? '/reports' : '/';
}

/** Where an admin login lands. Single active membership routes straight through;
 *  more than one shows the workspace selector. */
export function resolveAdminRouting(memberships: readonly MembershipRow[]): AdminRouting {
  const usable = memberships.filter((m) => m.status === 'active');
  const only = usable[0];
  if (!only) return { outcome: 'no_admin_access' };
  if (usable.length === 1) {
    return {
      outcome: 'single_workspace',
      membershipId: only.id,
      redirectTo: redirectFor(only.role),
    };
  }
  return { outcome: 'select_workspace', membershipIds: usable.map((m) => m.id) };
}

export function sortWorkspaceCards(cards: WorkspaceCard[]): WorkspaceCard[] {
  const rank: Record<MembershipRole, number> = {
    central_admin: 0,
    accountant: 1,
    franchise_owner: 2,
  };
  return [...cards].sort((a, b) => {
    if (rank[a.role] !== rank[b.role]) return rank[a.role] - rank[b.role];
    return (a.franchiseName ?? a.organizationName).localeCompare(
      b.franchiseName ?? b.organizationName,
    );
  });
}

// --- Store-local business date -----------------------------------------

export interface BusinessDate {
  year: number;
  month: number;
  day: number;
}

/** The store-local calendar date for an instant, using the outlet IANA zone.
 *  Server-only; never the browser clock. */
export function businessDate(now: Date, timeZone: string): BusinessDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return { year: get('year'), month: get('month'), day: get('day') };
}

export function businessDateEquals(a: BusinessDate, b: BusinessDate): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

/** `businessDate` formatted as `YYYY-MM-DD` for a `date` column / API string. */
export function businessDateString(now: Date, timeZone: string): string {
  const d = businessDate(now, timeZone);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${String(d.year)}-${pad(d.month)}-${pad(d.day)}`;
}
