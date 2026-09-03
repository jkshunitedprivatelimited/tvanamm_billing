'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SessionSummary } from '@jksh/contracts';

export function SessionList({ sessions }: { sessions: SessionSummary[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function revoke(id: string) {
    setBusy(id);
    try {
      await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card">
      <table>
        <thead>
          <tr>
            <th>Device</th>
            <th>Kind</th>
            <th>State</th>
            <th>Last seen</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.id}>
              <td>
                {s.device.label ?? s.device.userAgent ?? 'Unknown device'}
                {s.current ? <span className="pill" style={{ marginLeft: 8 }}>this device</span> : null}
              </td>
              <td>{s.kind}</td>
              <td>
                <span className="pill">{s.state}</span>
              </td>
              <td className="muted">{new Date(s.lastSeenAt).toLocaleString()}</td>
              <td>
                {s.state === 'active' && !s.current ? (
                  <button className="secondary" disabled={busy !== null} onClick={() => void revoke(s.id)}>
                    Sign out
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
