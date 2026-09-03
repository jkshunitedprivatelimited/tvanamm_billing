'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { TerminalSummary } from '@jksh/contracts';

export function TerminalManager({
  outletId,
  initialTerminals,
}: {
  outletId: string;
  initialTerminals: TerminalSummary[];
}) {
  const router = useRouter();
  const [label, setLabel] = useState('Front counter');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ code: string; expiresAt: string } | null>(null);

  async function issue(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setIssued(null);
    try {
      const res = await fetch(`/api/outlets/${outletId}/activation-codes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, expiresInMinutes: 60 }),
      });
      const body = (await res.json()) as { code?: string; expiresAt?: string; message?: string };
      if (!res.ok || !body.code) {
        setError(body.message ?? 'Could not issue an activation code.');
        return;
      }
      setIssued({ code: body.code, expiresAt: body.expiresAt ?? '' });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function revoke(terminalId: string) {
    if (!confirm('Revoke this terminal? It can no longer create bills.')) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/terminals/${terminalId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'revoked from admin console' }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        setError(body.message ?? 'Could not revoke.');
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="card">
        <h2>Issue an activation code</h2>
        <form onSubmit={issue}>
          <label htmlFor="label">Device label</label>
          <input id="label" value={label} onChange={(e) => setLabel(e.target.value)} />
          <button type="submit" disabled={busy || label.trim().length === 0}>
            {busy ? 'Working…' : 'Generate code'}
          </button>
        </form>
        {issued ? (
          <p className="ok">
            Enter on the device within 60 minutes:{' '}
            <span className="mono" style={{ fontSize: 18 }}>
              {issued.code}
            </span>
          </p>
        ) : null}
        {error ? <p className="error">{error}</p> : null}
      </div>

      <div className="card">
        <h2>Terminals</h2>
        <table>
          <thead>
            <tr>
              <th>Label</th>
              <th>Prefix</th>
              <th>State</th>
              <th>Last seen</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {initialTerminals.map((t) => (
              <tr key={t.id}>
                <td>{t.label}</td>
                <td className="mono">{t.receiptPrefix}</td>
                <td>
                  <span className="pill">{t.state}</span>
                </td>
                <td className="muted">
                  {t.lastSeenAt ? new Date(t.lastSeenAt).toLocaleString() : '—'}
                </td>
                <td>
                  {t.state !== 'revoked' ? (
                    <button className="secondary" disabled={busy} onClick={() => void revoke(t.id)}>
                      Revoke
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
            {initialTerminals.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  No terminal registered yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
