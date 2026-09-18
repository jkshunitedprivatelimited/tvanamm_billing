'use client';

import { useState } from 'react';
import { invitationPhoneSchema } from '@jksh/contracts';
import { useRouter } from 'next/navigation';
import type { FranchiseSummary, OutletOnboardingView } from '@jksh/contracts';

import { OnboardingReview } from './OnboardingReview';

const TVANAMM_BRAND = '01000000-0000-4000-8000-000000000010';

export function FranchisePanel({
  franchises,
  onboarding,
}: {
  franchises: FranchiseSummary[];
  onboarding: OutletOnboardingView[];
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [owner, setOwner] = useState({ fullName: '', phone: '' });
  const [newInviteUrl, setNewInviteUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteFor, setInviteFor] = useState<string | null>(null);
  const [invite, setInvite] = useState({ fullName: '', phone: '+91' });
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [invitationUrl, setInvitationUrl] = useState('');
  const [copied, setCopied] = useState(false);
  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setError('Select the invitation link and copy it manually.');
    }
  }

  async function createFranchise(e: React.SyntheticEvent) {
    e.preventDefault();
    const phone = invitationPhoneSchema.safeParse(owner.phone);
    if (!phone.success) {
      setError('Enter a valid owner mobile number, for example 9000145659.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/onboarding/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brandId: TVANAMM_BRAND,
          name,
          fullName: owner.fullName,
          phone: phone.data,
        }),
      });
      if (!res.ok) {
        setError(((await res.json()) as { message?: string }).message ?? 'Could not create.');
        return;
      }
      const body = (await res.json()) as { token: string };
      setNewInviteUrl(
        new URL(
          `/accept-invitation?token=${encodeURIComponent(body.token)}`,
          window.location.origin,
        ).href,
      );
      setName('');
      setOwner({ fullName: '', phone: '' });
      router.refresh();
    } catch {
      setError('Could not connect. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function sendInvite(franchiseId: string, e: React.SyntheticEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setIssuedToken(null);
    setNewInviteUrl('');
    setCopied(false);
    try {
      const phone = invitationPhoneSchema.safeParse(invite.phone);
      if (!phone.success) {
        setError('Enter a valid owner mobile number, for example 9000145659.');
        return;
      }
      const res = await fetch('/api/v1/invitations/franchise-owners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ franchiseId, fullName: invite.fullName, phone: phone.data }),
      });
      const body = (await res.json()) as { token?: string; message?: string };
      if (!res.ok || !body.token) {
        setError(body.message ?? 'Could not create the invitation.');
        return;
      }
      setIssuedToken(body.token);
      setInvitationUrl(
        new URL(
          `/accept-invitation?token=${encodeURIComponent(body.token)}`,
          window.location.origin,
        ).href,
      );
      setInvite({ fullName: '', phone: '+91' });
    } catch {
      setError('Could not connect. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>Add franchise</h2>
      <p className="muted">
        Enter three details. The owner verifies their mobile and completes the outlet setup.
      </p>
      <form
        onSubmit={createFranchise}
        style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}
      >
        <div style={{ flex: 1 }}>
          <label htmlFor="fn">Outlet / franchise name</label>
          <input id="fn" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div style={{ flex: 1 }}>
          <label htmlFor="owner-name">Owner name</label>
          <input
            id="owner-name"
            value={owner.fullName}
            onChange={(e) => setOwner({ ...owner, fullName: e.target.value })}
            required
          />
        </div>
        <div style={{ flex: 1 }}>
          <label htmlFor="owner-phone">Owner mobile</label>
          <input
            id="owner-phone"
            inputMode="tel"
            value={owner.phone}
            onChange={(e) => setOwner({ ...owner, phone: e.target.value })}
            required
          />
        </div>
        <button
          type="submit"
          disabled={busy || name.trim().length < 2 || owner.fullName.trim().length < 2}
        >
          Create invitation
        </button>
      </form>
      {newInviteUrl ? (
        <p className="ok">
          Share with the owner (expires in 72 hours):{' '}
          <a
            href={newInviteUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ overflowWrap: 'anywhere' }}
          >
            {newInviteUrl}
          </a>
          <button type="button" className="secondary" onClick={() => void copyLink(newInviteUrl)}>
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </p>
      ) : null}
      {error && !inviteFor ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      <button type="button" className="secondary" onClick={() => router.refresh()}>
        Refresh progress
      </button>
      <table style={{ marginTop: 12 }}>
        <thead>
          <tr>
            <th>Name</th>
            <th>Brand</th>
            <th>Setup progress</th>
            <th>Outlets</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {franchises.map((f) => {
            const setup = onboarding.find((row) => row.franchiseId === f.id);
            return (
              <tr key={f.id}>
                <td>{f.name}</td>
                <td>{f.brandName}</td>
                <td>
                  {
                    {
                      invited: 'Invited',
                      details_pending: 'Details pending',
                      ready_for_review: 'Ready for review',
                      active: 'Active',
                      outlet_created: 'Outlet created',
                    }[setup?.stage ?? 'invited']
                  }
                </td>
                <td>{f.outletCount}</td>
                <td>
                  {setup?.stage === 'ready_for_review' ? <OnboardingReview setup={setup} /> : null}
                  {setup?.stage === 'details_pending' || setup?.stage === 'ready_for_review' ? (
                    <span className="muted">Owner verified</span>
                  ) : (
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => {
                        setInviteFor(inviteFor === f.id ? null : f.id);
                        setInvite({ fullName: '', phone: setup?.phone ?? '+91' });
                        setCopied(false);
                        setIssuedToken(null);
                        setError(null);
                      }}
                    >
                      {setup?.stage === 'invited' && setup.phone
                        ? 'Generate new link'
                        : 'Invite owner'}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
          {franchises.length === 0 ? (
            <tr>
              <td colSpan={5} className="muted">
                No franchises yet.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      {inviteFor ? (
        <form className="card" style={{ marginTop: 12 }} onSubmit={(e) => sendInvite(inviteFor, e)}>
          <h2>Invite Franchise Owner</h2>
          <p>
            Lost the previous link? Generate a new one below. It replaces the previous unused link.
          </p>
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
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
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            required
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
              <a
                href={invitationUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ overflowWrap: 'anywhere' }}
              >
                {invitationUrl}
              </a>
              <button
                type="button"
                className="secondary"
                onClick={() => void copyLink(invitationUrl)}
              >
                {copied ? 'Copied' : 'Copy link'}
              </button>
            </p>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
