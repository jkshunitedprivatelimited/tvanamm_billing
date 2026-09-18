import type { ReactNode } from 'react';
import { requireAdminActor } from '@/server/auth';
import { AskJksh } from '@/components/AskJksh';

import type { NavItem } from './AppNav';
import { AppHeader } from './AppHeader';

const AI_ROLES = new Set(['central_admin', 'accountant', 'franchise_owner']);

const ROLE_LABEL: Record<string, string> = {
  central_admin: 'Central Admin',
  accountant: 'Accountant',
  franchise_owner: 'Franchise Owner',
};

export default async function AppLayout({ children }: { children: ReactNode }) {
  const actor = await requireAdminActor();

  const items: NavItem[] =
    actor.role === 'accountant'
      ? [
          { href: '/reports', label: 'Reports' },
          { href: '/audit', label: 'Business overview' },
        ]
      : [
          { href: '/', label: actor.role === 'franchise_owner' ? 'Overview' : 'All outlets' },
          ...(actor.role === 'central_admin' || actor.role === 'franchise_owner'
            ? [
                { href: '/menu', label: 'Menu' },
                { href: '/reports', label: 'Reports' },
                {
                  href: '/stock',
                  label: actor.role === 'franchise_owner' ? 'Stock & orders' : 'Stock control',
                },
                {
                  href: '/audit',
                  label: actor.role === 'franchise_owner' ? 'Outlet overview' : 'Business overview',
                },
              ]
            : []),
          ...(actor.role === 'central_admin'
            ? [{ href: '/stock/ops', label: 'Supply operations' }]
            : []),
        ];

  if (AI_ROLES.has(actor.role)) items.push({ href: '/ai', label: 'JKSH AI' });

  return (
    <>
      <AppHeader items={items} role={ROLE_LABEL[actor.role] ?? actor.role} />
      {children}
      {AI_ROLES.has(actor.role) ? <AskJksh /> : null}
    </>
  );
}
