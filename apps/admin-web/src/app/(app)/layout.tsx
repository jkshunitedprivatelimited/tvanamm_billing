import type { ReactNode } from 'react';
import Link from 'next/link';
import { requireAdminActor } from '@/server/auth';
import { BrandMark } from '@/components/BrandMark';
import { AppNav, type NavItem } from './AppNav';
import { LogoutButton } from './LogoutButton';

const ROLE_LABEL: Record<string, string> = {
  central_admin: 'Central Admin',
  accountant: 'Accountant',
  franchise_owner: 'Franchise Owner',
};

export default async function AppLayout({ children }: { children: ReactNode }) {
  const actor = await requireAdminActor();

  const items: NavItem[] =
    actor.role === 'accountant'
      ? [{ href: '/reports', label: 'Reports' }]
      : [
          { href: '/', label: 'Outlets' },
          ...(actor.role === 'central_admin' || actor.role === 'franchise_owner'
            ? [
                { href: '/menu', label: 'Menu' },
                { href: '/stock', label: 'Stock' },
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
    </>
  );
}
