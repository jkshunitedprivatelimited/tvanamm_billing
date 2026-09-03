import type { Membership, Role, WorkspaceCard } from '@jksh/contracts';

const ADMIN_ROLES: readonly Role[] = ['central_admin', 'accountant', 'franchise_owner'];

export function isAdminRole(role: Role): boolean {
  return ADMIN_ROLES.includes(role);
}

export type AdminRouting =
  | { outcome: 'single_workspace'; membershipId: string; redirectTo: string }
  | { outcome: 'select_workspace'; membershipIds: string[] }
  | { outcome: 'no_admin_access' };

function redirectFor(role: Role): string {
  switch (role) {
    case 'accountant':
      return '/reports';
    case 'central_admin':
    case 'franchise_owner':
      return '/';
    case 'store_employee':
      return '/';
  }
}

/**
 * Decide where an admin login lands. Store-employee-only users cannot use the
 * admin surface. A single admin membership routes straight through; more than
 * one shows the workspace selector (`docs/checklists/billing-system.md` s1).
 */
export function resolveAdminRouting(memberships: readonly Membership[]): AdminRouting {
  const usable = memberships.filter(
    (m) => m.status === 'active' && isAdminRole(m.role),
  );
  const only = usable[0];
  if (!only) return { outcome: 'no_admin_access' };
  if (usable.length === 1) {
    return {
      outcome: 'single_workspace',
      membershipId: only.id,
      redirectTo: redirectFor(only.role),
    };
  }
  return {
    outcome: 'select_workspace',
    membershipIds: usable.map((m) => m.id),
  };
}

/** The single active store-employee membership for a resolved employee. */
export function resolveStoreMembership(
  memberships: readonly Membership[],
  outletId: string,
): Membership | null {
  return (
    memberships.find(
      (m) =>
        m.status === 'active' &&
        m.role === 'store_employee' &&
        m.scope.outletId === outletId,
    ) ?? null
  );
}

export function sortWorkspaceCards(cards: WorkspaceCard[]): WorkspaceCard[] {
  const rank: Record<Role, number> = {
    central_admin: 0,
    accountant: 1,
    franchise_owner: 2,
    store_employee: 3,
  };
  return [...cards].sort((a, b) => {
    if (rank[a.role] !== rank[b.role]) return rank[a.role] - rank[b.role];
    return (a.outletName ?? a.franchiseName ?? '').localeCompare(
      b.outletName ?? b.franchiseName ?? '',
    );
  });
}

// --- Store-local business date --------------------------------------------

export interface BusinessDate {
  year: number;
  month: number;
  day: number;
}

/** The store-local calendar date for an instant, using the outlet IANA zone.
 *  Server-only; the browser clock is never trusted for eligibility windows. */
export function businessDate(now: Date, timeZone: string): BusinessDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');
  return { year: get('year'), month: get('month'), day: get('day') };
}

export function businessDateEquals(a: BusinessDate, b: BusinessDate): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}
