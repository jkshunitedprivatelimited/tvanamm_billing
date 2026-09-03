import type { ReactNode } from 'react';
import Link from 'next/link';
import { requireActor } from '@/server/auth';
import { LogoutButton } from './LogoutButton';

const ROLE_LABEL: Record<string, string> = {
  central_admin: 'Central Admin',
  accountant: 'Accountant',
  franchise_owner: 'Franchise Owner',
  store_employee: 'Store Employee',
};

export default async function AuthedLayout({ children }: { children: ReactNode }) {
  const actor = await requireActor();
  return (
    <>
      <div className="topbar">
        <strong>
          JKSH Admin ·{' '}
          <span className="pill">{ROLE_LABEL[actor.membership.role] ?? actor.membership.role}</span>
        </strong>
        <nav>
          <Link href="/">Home</Link>
          <Link href="/sessions">Sessions</Link>
          <LogoutButton />
        </nav>
      </div>
      {children}
    </>
  );
}
