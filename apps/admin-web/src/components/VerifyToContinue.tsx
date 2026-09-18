'use client';
import { useEffect, useState } from 'react';

export function VerifyToContinue({
  onVerified,
  onCancel,
}: {
  onVerified: () => Promise<void>;
  onCancel: () => void;
}) {
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((n) => Math.max(0, n - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);
  async function submit(action: 'send' | 'verify') {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/v1/auth/reauth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'send' ? { action } : { action, code }),
      });
      const body = (await res.json()) as {
        message?: string;
        resendAvailableInSeconds?: number;
        verified?: boolean;
      };
      if (action === 'send') setCooldown(body.resendAvailableInSeconds ?? 30);
      if (!res.ok) throw new Error(body.message ?? 'Verification could not be completed.');
      if (action === 'send') {
        setSent(true);
        setCode('');
      } else if (body.verified) {
        setCode('');
        await onVerified();
      } else throw new Error('Verification could not be completed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card" aria-label="Verify to activate">
      <h3>Verify to activate</h3>
      <p className="muted">
        Confirm with an OTP to your signed-in admin mobile. Your details stay here; approval
        continues after verification.
      </p>
      {sent ? (
        <>
          <label>
            Verification code
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={8}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (!busy && code.length >= 4) void submit('verify');
                }
              }}
            />
          </label>
          <button
            type="button"
            disabled={busy || code.length < 4}
            onClick={() => void submit('verify')}
          >
            {busy ? 'Verifying…' : 'Verify & activate'}
          </button>{' '}
        </>
      ) : null}
      <button
        type="button"
        className={sent ? 'secondary' : ''}
        disabled={busy || cooldown > 0}
        onClick={() => void submit('send')}
      >
        {cooldown > 0 ? `Resend in ${String(cooldown)}s` : sent ? 'Resend code' : 'Send OTP'}
      </button>{' '}
      <button type="button" className="secondary" disabled={busy} onClick={onCancel}>
        Cancel
      </button>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
