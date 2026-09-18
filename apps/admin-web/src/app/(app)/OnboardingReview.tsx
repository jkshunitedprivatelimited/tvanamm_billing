'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { VerifyToContinue } from '@/components/VerifyToContinue';
import type { OutletOnboardingView } from '@jksh/contracts';
export function OnboardingReview({ setup }: { setup: OutletOnboardingView }) {
  const router = useRouter();
  const [charge, setCharge] = useState('0');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [needsVerification, setNeedsVerification] = useState(false);
  const draftKey = `onboarding-charge:${setup.franchiseId}`;
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(draftKey);
      if (saved !== null && Number.isFinite(Number(saved))) setCharge(saved);
    } catch {
      /* Storage can be unavailable in private browsing. */
    }
  }, [draftKey]);
  async function approve(event?: React.SyntheticEvent) {
    event?.preventDefault();
    setBusy(true);
    setError('');
    setNeedsVerification(false);
    try {
      const res = await fetch('/api/v1/onboarding/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          franchiseId: setup.franchiseId,
          transportChargePaise: Math.round(Number(charge) * 100),
        }),
      });
      const body = (await res.json()) as { message?: string; error?: string };
      if (body.error === 'fresh_auth_required') {
        setNeedsVerification(true);
        setError(
          'Verify below to continue. Your outlet details and transport charge are unchanged.',
        );
        return;
      }
      if (!res.ok) throw new Error(body.message ?? 'Could not activate.');
      try {
        sessionStorage.removeItem(draftKey);
      } catch {
        /* Approval is already saved. */
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }
  if (!setup.details) return null;
  const d = setup.details;
  return (
    <details>
      <summary>Review details</summary>
      <form onSubmit={approve} style={{ minWidth: 240, padding: '12px 0' }}>
        <strong>{d.displayName}</strong>
        <p>
          {d.phone}
          <br />
          {d.addressLine}
          <br />
          {d.city}, {d.state} — {d.postalCode}
        </p>
        <p>
          GSTIN: {d.gstin ?? 'Not provided'}
          <br />
          Landmark: {d.nearestBusStop ?? 'Not provided'}
        </p>
        <label htmlFor={`charge-${setup.franchiseId}`}>Transport charge (₹)</label>
        <input
          id={`charge-${setup.franchiseId}`}
          type="number"
          required
          min="0"
          max="100000"
          step="0.01"
          disabled={busy || needsVerification}
          value={charge}
          onChange={(e) => setCharge(e.target.value)}
        />
        <p className="muted">
          Creates and activates this outlet. Menu and terminal setup follow from Billing &amp; team.
        </p>
        {needsVerification ? (
          <VerifyToContinue
            onVerified={() => approve()}
            onCancel={() => {
              setNeedsVerification(false);
              setError('');
            }}
          />
        ) : (
          <button disabled={busy}>{busy ? 'Activating…' : 'Approve & activate'}</button>
        )}
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </details>
  );
}
