'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const CREDENTIAL_KEY = 'jksh_terminal_credential';
const OUTLET_KEY = 'jksh_terminal_outlet';

export default function RegisterPage() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [deviceLabel, setDeviceLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/terminal/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim(), deviceLabel: deviceLabel.trim(), appVersion: '0.1.0' }),
      });
      const body = (await res.json()) as {
        terminalCredential?: string;
        outletName?: string;
        receiptPrefix?: string;
        message?: string;
      };
      if (!res.ok || !body.terminalCredential) {
        setError(body.message ?? 'That activation code was not accepted.');
        return;
      }
      try {
        localStorage.setItem(CREDENTIAL_KEY, body.terminalCredential);
        localStorage.setItem(OUTLET_KEY, body.outletName ?? '');
      } catch {
        setError('This browser blocked local storage. Enable it to run the terminal.');
        return;
      }
      router.replace('/login');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <form className="panel" onSubmit={submit}>
        <h1>Register this terminal</h1>
        <p className="muted">
          Enter the activation code from your Franchise Owner. This device becomes the outlet&apos;s
          Billing terminal.
        </p>
        <label htmlFor="code">Activation code</label>
        <input
          id="code"
          autoCapitalize="characters"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="ABCD-1234"
        />
        <label htmlFor="label">Device label</label>
        <input
          id="label"
          value={deviceLabel}
          onChange={(e) => setDeviceLabel(e.target.value)}
          placeholder="Front counter iPad"
        />
        <button type="submit" disabled={busy || code.length < 6 || deviceLabel.trim().length === 0}>
          {busy ? 'Registering…' : 'Register terminal'}
        </button>
        {error ? <p className="error">{error}</p> : null}
      </form>
    </div>
  );
}
