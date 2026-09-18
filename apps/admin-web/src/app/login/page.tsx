'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BrandMark } from '@/components/BrandMark';

type LoginResult =
  | { outcome: 'single_workspace'; redirectTo: string }
  | { outcome: 'select_workspace' }
  | { outcome: 'rejected'; retryAfterSeconds?: number }
  | { message?: string };

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('+91');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((n) => Math.max(0, n - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function requestCode() {
    const digits = phone.replace(/\D/g, '');
    const normalized = digits.length === 10 ? `+91${digits}` : `+${digits}`;
    if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
      setError('Enter a valid mobile number, including its country code.');
      return;
    }
    setPhone(normalized);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/auth/otp/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: normalized }),
      });
      const body = (await res.json()) as { message?: string; resendAvailableInSeconds?: number };
      setCooldown(body.resendAvailableInSeconds ?? 0);
      if (!res.ok) {
        setError(body.message ?? 'Could not send the code. Please try again.');
        return;
      }
      setCode('');
      setStep('code');
      setNotice('If that number has an account, a code is on its way.');
    } catch {
      setError('Could not reach the login service. Check your connection and try again.');
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
      const body = (await res.json()) as LoginResult;
      if (!res.ok || !('outcome' in body)) {
        setError(('message' in body && body.message) || 'Verification failed.');
        return;
      }
      if (body.outcome === 'rejected') {
        setError(
          body.retryAfterSeconds
            ? `Too many attempts. Try again in ${String(body.retryAfterSeconds)}s.`
            : 'That code was not accepted or has expired. Check it or request a new code.',
        );
        return;
      }
      router.replace(body.outcome === 'select_workspace' ? '/select-workspace' : body.redirectTo);
      router.refresh();
    } catch {
      setError('Could not verify the code. Check your connection and try again.');
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
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void requestCode();
            }}
          >
            <label htmlFor="phone">Mobile number</label>
            <input
              id="phone"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value.trim())}
              placeholder="9550511549"
            />
            <button type="submit" disabled={busy || cooldown > 0}>
              {busy ? 'Sending…' : cooldown > 0 ? `Try again in ${String(cooldown)}s` : 'Send code'}
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
              disabled={busy || cooldown > 0}
              onClick={() => void requestCode()}
            >
              {cooldown > 0 ? `Resend in ${String(cooldown)}s` : 'Resend code'}
            </button>{' '}
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => {
                setStep('phone');
                setCode('');
                setNotice(null);
                setError(null);
              }}
            >
              Change number
            </button>
          </form>
        )}
        {notice ? (
          <p className="ok" role="status">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
