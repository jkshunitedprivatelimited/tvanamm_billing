'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const CREDENTIAL_KEY = 'jksh_terminal_credential';
const OUTLET_KEY = 'jksh_terminal_outlet';

type Phase = 'pin' | 'confirm';

export default function StoreLoginPage() {
  const router = useRouter();
  const [credential, setCredential] = useState<string | null>(null);
  const [outletName, setOutletName] = useState('');
  const [pin, setPin] = useState('');
  const [phase, setPhase] = useState<Phase>('pin');
  const [confirmName, setConfirmName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(CREDENTIAL_KEY);
      setOutletName(localStorage.getItem(OUTLET_KEY) ?? '');
    } catch {
      stored = null;
    }
    if (!stored) {
      router.replace('/register');
      return;
    }
    setCredential(stored);
  }, [router]);

  async function submit(nextPin: string) {
    if (!credential) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/pin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ terminalCredential: credential, pin: nextPin }),
      });
      const body = (await res.json()) as
        | { outcome: 'resolved'; employeeName: string; outletName: string }
        | { outcome: 'rejected'; reason: string; retryAfterSeconds?: number }
        | { message?: string };
      setPin('');
      if (!res.ok || !('outcome' in body)) {
        setError(('message' in body && body.message) || 'Login failed.');
        return;
      }
      if (body.outcome === 'rejected') {
        setError(
          body.reason === 'locked'
            ? `Locked. Try again in ${String(body.retryAfterSeconds ?? 60)}s.`
            : body.reason === 'terminal_revoked'
              ? 'This terminal is no longer active. Re-register it.'
              : 'Incorrect PIN.',
        );
        return;
      }
      setConfirmName(body.employeeName);
      setOutletName(body.outletName);
      setPhase('confirm');
    } finally {
      setBusy(false);
    }
  }

  function press(digit: string) {
    if (busy || pin.length >= 4) return;
    const next = pin + digit;
    setPin(next);
    if (next.length === 4) void submit(next);
  }

  if (phase === 'confirm') {
    return (
      <div className="screen">
        <div className="panel">
          <h1>Is this you?</h1>
          <p className="muted">{outletName}</p>
          <p style={{ fontSize: 22, fontWeight: 700, margin: '12px 0 24px' }}>{confirmName}</p>
          <button
            onClick={() => {
              router.replace('/');
              router.refresh();
            }}
          >
            Yes, continue
          </button>
          <button
            className="ghost"
            style={{ marginTop: 10 }}
            onClick={() => {
              setPhase('pin');
              setConfirmName('');
            }}
          >
            Not me
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="panel">
        <h1>{outletName || 'Store terminal'}</h1>
        <p className="muted">Enter your four-digit PIN.</p>
        <div className="pinrow">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={`pindot${pin.length > i ? ' on' : ''}`} />
          ))}
        </div>
        <div className="keys">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <button key={d} onClick={() => press(d)} disabled={busy}>
              {d}
            </button>
          ))}
          <button className="ghost" onClick={() => setPin('')} disabled={busy}>
            Clear
          </button>
          <button onClick={() => press('0')} disabled={busy}>
            0
          </button>
          <button className="ghost" onClick={() => setPin(pin.slice(0, -1))} disabled={busy}>
            ⌫
          </button>
        </div>
        {error ? <p className="error">{error}</p> : null}
      </div>
    </div>
  );
}
