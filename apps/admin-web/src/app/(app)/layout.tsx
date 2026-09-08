import type { ReactNode } from 'react';
import Link from 'next/link';
import { requireAdminActor } from '@/server/auth';
import { LogoutButton } from './LogoutButton';

const ROLE_LABEL: Record<string, string> = {
  central_admin: 'Central Admin',
  accountant: 'Accountant',
  franchise_owner: 'Franchise Owner',
};

export default async function AppLayout({ children }: { children: ReactNode }) {
  const actor = await requireAdminActor();
  return (
    <>
      <div className="topbar">
        <strong>
          JKSH Admin · <span className="pill">{ROLE_LABEL[actor.role] ?? actor.role}</span>
        </strong>
        <nav>
          {actor.role === 'accountant' ? (
            <Link href="/reports">Reports</Link>
          ) : (
            <>
              <Link href="/">Outlets</Link>
              {(actor.role === 'central_admin' || actor.role === 'franchise_owner') && (
                <Link href="/menu">Menu</Link>
              )}
              {(actor.role === 'central_admin' || actor.role === 'franchise_owner') && (
                <Link href="/stock">Stock</Link>
              )}
              {actor.role === 'central_admin' && <Link href="/stock/ops">Stock ops</Link>}
            </>
          )}
          <LogoutButton />
        </nav>
      </div>
      {children}
    </>
  );
}
