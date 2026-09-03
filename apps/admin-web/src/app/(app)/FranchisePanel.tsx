'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { FranchiseSummary } from '@jksh/contracts';

const TVANAMM_BRAND = '01000000-0000-4000-8000-000000000010';

export function FranchisePanel({ franchises }: { franchises: FranchiseSummary[] }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteFor, setInviteFor] = useState<string | null>(null);
  const [invite, setInvite] = useState({ fullName: '', phone: '+91' });
  const [issuedToken, setIssuedToken] = useState<string | null>(null);

  async function createFranchise(e: React.SyntheticEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/franchises', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandId: TVANAMM_BRAND, name }),
      });
      if (!res.ok) {
        setError(((await res.json()) as { message?: string }).message ?? 'Could not create.');
        return;
      }
      setName('');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function sendInvite(franchiseId: string, e: React.SyntheticEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setIssuedToken(null);
    try {
      const res = await fetch('/api/v1/invitations/franchise-owners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ franchiseId, fullName: invite.fullName, phone: invite.phone }),
      });
      const body = (await res.json()) as { token?: string; message?: string };
      if (!res.ok || !body.token) {
        setError(body.message ?? 'Could not create the invitation.');
        return;
      }
      setIssuedToken(body.token);
      setInvite({ fullName: '', phone: '+91' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>Franchises</h2>
      <form onSubmit={createFranchise} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <label htmlFor="fn">New franchise name</label>
          <input id="fn" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <button type="submit" disabled={busy || name.trim().length < 2}>
          Create
        </button>
      </form>
      {error ? <p className="error">{error}</p> : null}

      <table style={{ marginTop: 12 }}>
        <thead>
          <tr>
            <th>Name</th>
            <th>Brand</th>
            <th>Outlets</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {franchises.map((f) => (
            <tr key={f.id}>
              <td>{f.name}</td>
              <td>{f.brandName}</td>
              <td>{f.outletCount}</td>
              <td>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => {
                    setInviteFor(inviteFor === f.id ? null : f.id);
                    setIssuedToken(null);
                    setError(null);
                  }}
                >
                  Invite owner
                </button>
              </td>
            </tr>
          ))}
          {franchises.length === 0 ? (
            <tr>
              <td colSpan={4} className="muted">
                No franchises yet.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      {inviteFor ? (
        <form className="card" style={{ marginTop: 12 }} onSubmit={(e) => sendInvite(inviteFor, e)}>
          <h2>Invite Franchise Owner</h2>
          <label htmlFor="ifn">Owner full name</label>
          <input
            id="ifn"
            value={invite.fullName}
            onChange={(e) => setInvite((v) => ({ ...v, fullName: e.target.value }))}
            required
          />
          <label htmlFor="iph">Owner mobile</label>
          <input
            id="iph"
            value={invite.phone}
            onChange={(e) => setInvite((v) => ({ ...v, phone: e.target.value.trim() }))}
          />
          <button type="submit" disabled={busy || invite.fullName.trim().length < 2}>
            Create invitation
          </button>
          {issuedToken ? (
            <p className="ok">
              Share this single-use link (expires in 72h):
              <br />
              <span className="mono">/accept-invitation?token={issuedToken}</span>
            </p>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
