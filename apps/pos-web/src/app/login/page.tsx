'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BrandMark } from '@/components/BrandMark';

const CREDENTIAL_KEY = 'jksh_terminal_credential';
const OUTLET_KEY = 'jksh_terminal_outlet';

export default function StoreLoginPage() {
  const router = useRouter();
  const [credential, setCredential] = useState<string | null>(null);
  const [outletName, setOutletName] = useState('');
  const [pin, setPin] = useState('');
  const [phase, setPhase] = useState<'pin' | 'confirm'>('pin');
  const [confirmName, setConfirmName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** The stored credential points at a terminal that no longer exists — wipe
   *  every copy of it and send the user to activation. */
  async function forgetTerminal() {
    try {
      localStorage.removeItem(CREDENTIAL_KEY);
      localStorage.removeItem(OUTLET_KEY);
    } catch {
      /* ignore */
    }
    try {
      await fetch('/api/v1/terminals/session', { method: 'DELETE' });
    } catch {
      /* ignore */
    }
    router.replace('/register');
  }

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(CREDENTIAL_KEY);
      setOutletName(localStorage.getItem(OUTLET_KEY) ?? '');
    } catch {
      stored = null;
    }
    if (stored) {
      setCredential(stored);
      return;
    }
    // localStorage was cleared (or a fresh browser profile on this device):
    // recover the credential from the durable server cookie before making the
    // owner re-run activation.
    void (async () => {
      try {
        const res = await fetch('/api/v1/terminals/session');
        if (res.ok) {
          const { credential: recovered } = (await res.json()) as { credential: string };
          try {
            localStorage.setItem(CREDENTIAL_KEY, recovered);
          } catch {
            /* storage disabled — still usable for this session */
          }
          setCredential(recovered);
          return;
        }
      } catch {
        /* offline / no cookie — fall through to registration */
      }
      router.replace('/register');
    })();
  }, [router]);

  async function submit(nextPin: string) {
    if (!credential) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/operator-sessions/pin-login', {
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
        if (body.reason === 'terminal_revoked' || body.reason === 'invalid') {
          setError('This terminal is not registered any more. Redirecting to activation…');
          void forgetTerminal();
          return;
        }
        setError(
          body.reason === 'locked'
            ? `Too many attempts. Try again in ${String(body.retryAfterSeconds ?? 60)}s.`
            : body.reason === 'outlet_inactive'
              ? 'This outlet is not active.'
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
          <div className="brand">
            <BrandMark />
            <span>
              T&nbsp;VANAMM <small>· Billing</small>
            </span>
          </div>
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
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void fetch('/api/v1/operator-sessions/reject', { method: 'POST' }).finally(() => {
                setPhase('pin');
                setConfirmName('');
                setBusy(false);
              });
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
        <div className="brand">
          <BrandMark />
          <span>
            T&nbsp;VANAMM <small>· Billing</small>
          </span>
        </div>
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
        <button
          className="ghost"
          style={{ marginTop: 12, fontSize: 13 }}
          onClick={() => void forgetTerminal()}
        >
          Re-register this terminal
        </button>
      </div>
    </div>
  );
}
