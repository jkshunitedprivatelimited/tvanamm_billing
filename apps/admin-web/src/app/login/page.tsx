'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BrandMark } from '@/components/BrandMark';

const WIDGET_ID = process.env.NEXT_PUBLIC_MSG91_WIDGET_ID;
const WIDGET_TOKEN = process.env.NEXT_PUBLIC_MSG91_WIDGET_TOKEN;
const USE_WIDGET = !!WIDGET_ID && !!WIDGET_TOKEN;

type Cb = (data: unknown) => void;
interface Msg91Widget {
  initSendOTP: (c: {
    widgetId: string;
    tokenAuth: string;
    exposeMethods: boolean;
    success?: Cb;
    failure?: Cb;
  }) => void;
  sendOtp: (identifier: string, success: Cb, failure: Cb) => void;
  verifyOtp: (otp: string, success: Cb, failure: Cb) => void;
  retryOtp: (channel: string | null, success: Cb, failure: Cb) => void;
}
type W = Window & Partial<Msg91Widget>;

function msgOf(d: unknown, fallback: string): string {
  if (d && typeof d === 'object' && 'message' in d) {
    const m = (d as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return fallback;
}

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
  const widgetReady = useRef(false);

  useEffect(() => {
    if (!WIDGET_ID || !WIDGET_TOKEN || widgetReady.current) return;
    const w = window as W;
    const init = () => {
      if (!w.initSendOTP) return;
      w.initSendOTP({ widgetId: WIDGET_ID, tokenAuth: WIDGET_TOKEN, exposeMethods: true });
      widgetReady.current = true;
    };
    if (w.initSendOTP) return init();
    const s = document.createElement('script');
    s.src = 'https://verify.msg91.com/otp-provider.js';
    s.async = true;
    s.onload = init;
    document.body.appendChild(s);
  }, []);

  const finish = useCallback(
    (body: LoginResult, resOk: boolean) => {
      if (!resOk || !('outcome' in body)) {
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
    },
    [router],
  );

  const identifier = () => phone.replace(/\D/g, '');

  async function start(e: React.SyntheticEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (USE_WIDGET) {
        const sendOtp = (window as W).sendOtp;
        if (!sendOtp) {
          setError('OTP service is still loading — try again in a moment.');
          return;
        }
        await new Promise<void>((resolve) => {
          sendOtp(
            identifier(),
            () => {
              setStep('code');
              setNotice('If that number has an account, a code is on its way.');
              resolve();
            },
            (d) => {
              setError(msgOf(d, 'Could not send the code.'));
              resolve();
            },
          );
        });
        return;
      }
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

  async function submitToServer(accessToken: string) {
    const res = await fetch('/api/v1/auth/msg91-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, accessToken }),
    });
    finish((await res.json()) as LoginResult, res.ok);
  }

  async function verify(e: React.SyntheticEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (USE_WIDGET) {
        const verifyOtp = (window as W).verifyOtp;
        if (!verifyOtp) {
          setError('OTP service is not ready.');
          return;
        }
        await new Promise<void>((resolve) => {
          verifyOtp(
            code,
            (d) => {
              void submitToServer(msgOf(d, '')).finally(resolve);
            },
            (d) => {
              setError(msgOf(d, 'That code was not accepted.'));
              resolve();
            },
          );
        });
        return;
      }
      const res = await fetch('/api/v1/auth/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code }),
      });
      finish((await res.json()) as LoginResult, res.ok);
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
