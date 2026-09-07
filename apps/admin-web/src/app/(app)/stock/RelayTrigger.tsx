'use client';
import { useState } from 'react';

export function RelayTrigger() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch('/api/v1/stock/relay', { method: 'POST' });
      const body: unknown = await res.json();
      setResult(res.ok ? JSON.stringify(body) : `Error: ${JSON.stringify(body)}`);
    } catch (error) {
      setResult(error instanceof Error ? error.message : 'request failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>Cross-system pipeline</h2>
      <p className="muted" style={{ fontSize: 13 }}>
        Deliver Billing sale events into Stock, process the inbox, and record a reconciliation run.
      </p>
      <button onClick={run} disabled={busy}>
        {busy ? 'Running…' : 'Run relay + reconcile'}
      </button>
      {result ? (
        <pre className="mono" style={{ fontSize: 12, whiteSpace: 'pre-wrap', marginTop: 12 }}>
          {result}
        </pre>
      ) : null}
    </div>
  );
}
