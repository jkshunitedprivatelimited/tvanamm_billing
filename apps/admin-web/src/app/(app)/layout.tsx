import type { ReactNode } from 'react';
import Link from 'next/link';
import { requireAdminActor } from '@/server/auth';
import { BrandMark } from '@/components/BrandMark';
import { AskJksh } from '@/components/AskJksh';
import { askJkshEnabled } from '@/server/gemini';
import { AppNav, type NavItem } from './AppNav';
import { LogoutButton } from './LogoutButton';

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
          { href: '/audit', label: 'Audit' },
        ]
      : [
          { href: '/', label: 'Outlets' },
          ...(actor.role === 'central_admin' || actor.role === 'franchise_owner'
            ? [
                { href: '/menu', label: 'Menu' },
                { href: '/reports', label: 'Reports' },
                { href: '/stock', label: 'Stock' },
                { href: '/audit', label: 'Audit' },
              ]
            : []),
          ...(actor.role === 'central_admin' ? [{ href: '/stock/ops', label: 'Stock ops' }] : []),
        ];

  return (
    <>
      <div className="topbar">
        <Link href="/" className="brand">
          <BrandMark />
          <span>
            T&nbsp;VANAMM <small>· JKSH</small>
          </span>
        </Link>
        <div className="row">
          <AppNav items={items} />
          <span className="badge">{ROLE_LABEL[actor.role] ?? actor.role}</span>
          <LogoutButton />
        </div>
      </div>
      {children}
      {askJkshEnabled() && AI_ROLES.has(actor.role) ? <AskJksh role={actor.role} /> : null}
    </>
  );
}
