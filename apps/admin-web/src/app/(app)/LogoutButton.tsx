'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="ghost sm"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void fetch('/api/v1/auth/logout', { method: 'POST' }).then(() => {
          router.replace('/login');
          router.refresh();
        });
      }}
    >
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
