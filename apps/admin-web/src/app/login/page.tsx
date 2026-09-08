'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BrandMark } from '@/components/BrandMark';

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('+91');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function start(e: React.SyntheticEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/auth/otp/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      if (!res.ok) {
        setError(
          ((await res.json()) as { message?: string }).message ?? 'Could not send the code.',
        );
        return;
      }
      setStep('code');
      setNotice('If that number has an account, a code is on its way.');
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.SyntheticEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/auth/otp/verify', {
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
        setError(('message' in body && body.message) || 'Verification failed.');
        return;
      }
      if (body.outcome === 'rejected') {
        setError(
          body.retryAfterSeconds
            ? `Too many attempts. Try again in ${String(body.retryAfterSeconds)}s.`
            : 'That code was not accepted.',
        );
        return;
      }
      router.replace(body.outcome === 'select_workspace' ? '/select-workspace' : body.redirectTo);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center">
      <div className="card">
        <div className="auth-brand">
          <BrandMark size={32} />
          <strong>
            T&nbsp;VANAMM <span className="muted">· JKSH Admin</span>
          </strong>
        </div>
        <h2>Sign in</h2>
        {step === 'phone' ? (
          <form onSubmit={start}>
            <label htmlFor="phone">Mobile number</label>
            <input
              id="phone"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value.trim())}
              placeholder="+919876543210"
            />
            <button type="submit" disabled={busy}>
              {busy ? 'Sending…' : 'Send code'}
            </button>
          </form>
        ) : (
          <form onSubmit={verify}>
            <label htmlFor="code">Enter the code sent to {phone}</label>
            <input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              maxLength={8}
            />
            <button type="submit" disabled={busy || code.length < 4}>
              {busy ? 'Checking…' : 'Verify'}
            </button>{' '}
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setStep('phone');
                setCode('');
                setNotice(null);
              }}
            >
              Change number
            </button>
          </form>
        )}
        {notice ? <p className="ok">{notice}</p> : null}
        {error ? <p className="error">{error}</p> : null}
      </div>
    </div>
  );
}
