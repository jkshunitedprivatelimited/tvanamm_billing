'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function SessionControls() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  function call(path: string) {
    setBusy(true);
    void fetch(path, { method: 'POST' }).then(() => {
      router.replace('/login');
      router.refresh();
    });
  }

  return (
    <div style={{ display: 'flex', gap: 12, marginTop: 24, maxWidth: 380 }}>
      <button
        className="ghost"
        disabled={busy}
        onClick={() => call('/api/v1/operator-sessions/lock')}
      >
        Lock terminal
      </button>
      <button disabled={busy} onClick={() => call('/api/v1/operator-sessions/logout')}>
        Sign out
      </button>
    </div>
  );
}
