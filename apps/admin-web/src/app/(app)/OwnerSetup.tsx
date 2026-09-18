'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { OutletOnboardingView } from '@jksh/contracts';
export function OwnerSetup({ setup }: { setup: OutletOnboardingView }) {
  const router = useRouter();
  const [form, setForm] = useState({
    displayName: setup.name,
    phone: setup.phone,
    addressLine: '',
    city: '',
    state: '',
    postalCode: '',
    gstin: '',
    nearestBusStop: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: React.SyntheticEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const digits = form.phone.replace(/\D/g, '');
      const { gstin, nearestBusStop, ...details } = form;
      const res = await fetch('/api/v1/onboarding/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...details,
          phone: digits.length === 10 ? `+91${digits}` : `+${digits}`,
          ...(gstin.trim() ? { gstin: gstin.trim().toUpperCase() } : {}),
          ...(nearestBusStop.trim() ? { nearestBusStop: nearestBusStop.trim() } : {}),
        }),
      });
      const body = (await res.json()) as { message?: string };
      if (!res.ok) throw new Error(body.message ?? 'Could not submit your details.');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }
  if (setup.stage === 'ready_for_review')
    return (
      <main>
        <div className="card">
          <span className="badge">Ready for review</span>
          <h1>Your outlet details are submitted</h1>
          <p>
            Central will review and activate {setup.details?.displayName ?? setup.name}. You do not
            need another invitation.
          </p>
          <button className="secondary" onClick={() => router.refresh()}>
            Refresh status
          </button>
        </div>
      </main>
    );
  return (
    <main style={{ maxWidth: 760 }}>
      <p className="section-label">Welcome · Outlet setup</p>
      <h1>Complete your outlet setup</h1>
      <p className="page-intro">
        Your account is verified. Add your contact and location details; central will handle
        activation, transport charges and menu setup.
      </p>
      <form className="card" onSubmit={submit}>
        {(
          [
            ['displayName', 'Outlet name'],
            ['phone', 'Contact mobile'],
            ['addressLine', 'Street address'],
            ['city', 'City'],
            ['state', 'State'],
            ['postalCode', 'Pincode'],
            ['gstin', 'GSTIN (optional)'],
            ['nearestBusStop', 'Delivery landmark / nearest bus stop (optional)'],
          ] as const
        ).map(([key, label]) => (
          <div key={key}>
            <label htmlFor={key}>{label}</label>
            <input
              id={key}
              value={form[key]}
              required={key !== 'gstin' && key !== 'nearestBusStop'}
              maxLength={
                key === 'postalCode'
                  ? 6
                  : key === 'gstin'
                    ? 15
                    : key === 'addressLine'
                      ? 240
                      : key === 'nearestBusStop'
                        ? 200
                        : 120
              }
              inputMode={key === 'phone' ? 'tel' : key === 'postalCode' ? 'numeric' : 'text'}
              onChange={(event) => setForm({ ...form, [key]: event.target.value })}
            />
          </div>
        ))}
        <button disabled={busy}>{busy ? 'Submitting…' : 'Submit for activation'}</button>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </main>
  );
}
