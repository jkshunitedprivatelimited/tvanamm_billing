'use client';
import { useCallback, useEffect, useState } from 'react';
import type { IntegrationHealth } from '@jksh/stock';

function Stat({ label, value, bad }: { label: string; value: number; bad?: boolean }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value" style={bad && value > 0 ? { color: 'var(--danger)' } : undefined}>
        {value}
      </div>
    </div>
  );
}

export function IntegrationClient() {
  const [health, setHealth] = useState<IntegrationHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/stock/integration-health');
      if (res.ok) setHealth((await res.json()) as IntegrationHealth);
      else setMsg('Could not load integration health.');
    } catch {
      setMsg('Could not load integration health.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function runRelay() {
    setRunning(true);
    setMsg(null);
    try {
      const res = await fetch('/api/v1/stock/relay', { method: 'POST' });
      const body = (await res.json()) as {
        delivery?: unknown;
        inbox?: unknown;
        reconciliation?: unknown;
        message?: string;
      };
      setMsg(res.ok ? 'Relay + reconcile complete.' : (body.message ?? 'Relay failed.'));
    } catch {
      setMsg('Relay request failed.');
    } finally {
      setRunning(false);
      await load();
    }
  }

  async function retry(id: string) {
    setMsg(null);
    const res = await fetch(`/api/v1/stock/inbox/${id}/retry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    setMsg(res.ok ? 'Re-queued and reprocessed.' : (body.message ?? 'Retry failed.'));
    await load();
  }

  if (loading && !health) return <p className="muted">Loading…</p>;
  if (!health) return <p className="error">{msg ?? 'Unavailable.'}</p>;

  return (
    <>
      <div className="card">
        <div className="spread">
          <strong>Queue depth</strong>
          <button className="secondary sm" onClick={runRelay} disabled={running}>
            {running ? 'Running…' : 'Run relay + reconcile'}
          </button>
        </div>
        {msg ? <p className="notice">{msg}</p> : null}
        <div
          className="grid"
          style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', marginTop: 10 }}
        >
          <Stat label="Billing outbox pending" value={health.billingOutbox.pending} />
          <Stat label="Billing outbox dead-letter" value={health.billingOutbox.deadLetter} bad />
          <Stat label="Stock inbox unprocessed" value={health.stockInbox.unprocessed} />
          <Stat label="Stock inbox dead-lettered" value={health.stockInbox.deadLettered} bad />
          <Stat label="Stock outbox undelivered" value={health.stockOutbox.undelivered} />
          <Stat label="Stock outbox dead-letter" value={health.stockOutbox.deadLettered} bad />
        </div>
        {health.billingOutbox.oldestPendingAt ? (
          <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
            Oldest pending Billing event:{' '}
            {new Date(health.billingOutbox.oldestPendingAt).toLocaleString()}
          </p>
        ) : null}
      </div>

      <div className="card">
        <strong>Last reconciliation</strong>
        {health.lastReconciliation ? (
          <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
            {new Date(health.lastReconciliation.startedAt).toLocaleString()} ·{' '}
            {health.lastReconciliation.discrepancies} discrepancy(ies) ·{' '}
            <span className="mono" style={{ fontSize: 11 }}>
              {JSON.stringify(health.lastReconciliation.report)}
            </span>
          </p>
        ) : (
          <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
            No reconciliation run recorded yet.
          </p>
        )}
      </div>

      <h2 className="section-label">Dead-lettered inbound events</h2>
      {health.deadLetters.length === 0 ? (
        <p className="ok">None — the pipeline is clean.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Event</th>
                <th>Source id</th>
                <th className="num">Attempts</th>
                <th>Last error</th>
                <th>Dead-lettered</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {health.deadLetters.map((d) => (
                <tr key={d.id}>
                  <td className="mono" style={{ fontSize: 12 }}>
                    {d.eventType}
                  </td>
                  <td className="mono" style={{ fontSize: 11 }}>
                    {d.sourceEventId}
                  </td>
                  <td className="num">{d.attempts}</td>
                  <td style={{ color: 'var(--danger)', fontSize: 12, maxWidth: 320 }}>
                    {d.lastError ?? '—'}
                  </td>
                  <td className="muted">{new Date(d.deadLetteredAt).toLocaleString()}</td>
                  <td>
                    <button className="secondary sm" onClick={() => void retry(d.id)}>
                      Re-queue
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
