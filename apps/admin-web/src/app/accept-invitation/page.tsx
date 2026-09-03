'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function AcceptForm() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const [phone, setPhone] = useState('+91');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!token) {
    return <p className="error">This invitation link is missing its token.</p>;
  }

  async function start(e: React.SyntheticEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await fetch('/api/v1/auth/otp/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      setStep('code');
      setNotice('Enter the code sent to your mobile.');
    } finally {
      setBusy(false);
    }
  }

  async function accept(e: React.SyntheticEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/invitations/${encodeURIComponent(token)}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code }),
      });
      const body = (await res.json()) as
        | { outcome: 'single_workspace'; redirectTo: string }
        | { outcome: 'select_workspace' }
        | { outcome: 'rejected'; retryAfterSeconds?: number }
        | { message?: string };
      if (!res.ok || !('outcome' in body)) {
        setError(('message' in body && body.message) || 'Could not accept the invitation.');
        return;
      }
      if (body.outcome === 'rejected') {
        setError('That code or invitation was not accepted.');
        return;
      }
      router.replace(body.outcome === 'select_workspace' ? '/select-workspace' : body.redirectTo);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="muted">
        Confirm your registered mobile number to accept this Franchise Owner invitation.
      </p>
      {step === 'phone' ? (
        <form onSubmit={start}>
          <label htmlFor="p">Mobile number</label>
          <input
            id="p"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value.trim())}
          />
          <button type="submit" disabled={busy}>
            {busy ? 'Sending…' : 'Send code'}
          </button>
        </form>
      ) : (
        <form onSubmit={accept}>
          <label htmlFor="c">Verification code</label>
          <input
            id="c"
            inputMode="numeric"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            maxLength={8}
          />
          <button type="submit" disabled={busy || code.length < 4}>
            {busy ? 'Accepting…' : 'Accept invitation'}
          </button>
        </form>
      )}
      {notice ? <p className="ok">{notice}</p> : null}
      {error ? <p className="error">{error}</p> : null}
    </>
  );
}

export default function AcceptInvitationPage() {
  return (
    <div className="center">
      <div className="card">
        <h2>Accept your invitation</h2>
        <Suspense fallback={<p className="muted">Loading…</p>}>
          <AcceptForm />
        </Suspense>
      </div>
    </div>
  );
}
