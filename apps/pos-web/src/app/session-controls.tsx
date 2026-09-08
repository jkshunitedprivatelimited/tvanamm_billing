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
    <div style={{ maxWidth: 380 }}>
      <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
        <button
          className="ghost"
          disabled={busy}
          onClick={() => call('/api/v1/operator-sessions/lock')}
        >
          Lock terminal
        </button>
        <button disabled={busy} onClick={() => call('/api/v1/operator-sessions/logout')}>
          End shift &amp; sign out
        </button>
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
        Lock hides the till but keeps your shift open (unlock with your PIN). End shift closes your
        shift for the day and signs you out — the terminal stays registered, the next person just
        enters their PIN.
      </p>
    </div>
  );
}
