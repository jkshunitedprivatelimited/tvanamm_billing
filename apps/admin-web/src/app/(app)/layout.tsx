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
          <Link href="/">Outlets</Link>
          <LogoutButton />
        </nav>
      </div>
      {children}
    </>
  );
}
