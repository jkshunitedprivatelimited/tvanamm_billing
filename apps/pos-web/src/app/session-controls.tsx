'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { listOutboxBills } from '@/lib/offline-store';

export function SessionControls() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function lock() {
    setBusy(true);
    setError(null);
    try {
      const pending = (await listOutboxBills()).filter((b) => b.status !== 'synced');
      if (pending.length > 0) {
        setError('Wait for offline sales to sync before switching cashier.');
        return;
      }
      const res = await fetch('/api/v1/operator-sessions/lock', { method: 'POST' });
      if (!res.ok) throw new Error('Could not lock the terminal. Try again.');
      router.replace('/login');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connect to the internet and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 380 }}>
      <div style={{ display: 'flex', gap: 12 }}>
        <button className="ghost" disabled={busy} onClick={() => void lock()}>
          Switch cashier
        </button>
      </div>
      {error ? (
        <p className="error" style={{ fontSize: 12, marginTop: 8 }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
