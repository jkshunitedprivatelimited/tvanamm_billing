'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function SessionControls() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function call(path: string) {
    setBusy(true);
    try {
      await fetch(path, { method: 'POST' });
      router.replace('/login');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', gap: 12, marginTop: 24, maxWidth: 380 }}>
      <button className="ghost" disabled={busy} onClick={() => void call('/api/session/lock')}>
        Lock terminal
      </button>
      <button disabled={busy} onClick={() => void call('/api/session/logout')}>
        Sign out
      </button>
    </div>
  );
}
