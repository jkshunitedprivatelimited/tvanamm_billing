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
      else setMsg('Could not load stock update status.');
    } catch {
      setMsg('Could not load stock update status.');
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
      setMsg(
        res.ok
          ? 'Stock update check completed.'
          : (body.message ?? 'Could not complete the stock update check.'),
      );
    } catch {
      setMsg('Could not reach the stock update service.');
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
    setMsg(
      res.ok
        ? 'Update retried. Review the latest status below.'
        : (body.message ?? 'Retry failed.'),
    );
    await load();
  }

  if (loading && !health) return <p className="muted">Loading…</p>;
  if (!health) return <p className="error">{msg ?? 'Unavailable.'}</p>;

  return (
    <>
      <div className="card">
        <div className="spread">
          <strong>Updates awaiting processing</strong>
          <button className="secondary sm" onClick={runRelay} disabled={running}>
            {running ? 'Running…' : 'Check stock updates'}
          </button>
        </div>
        {msg ? <p className="notice">{msg}</p> : null}
        <div
          className="grid"
          style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', marginTop: 10 }}
        >
          <Stat label="Bills awaiting transfer" value={health.billingOutbox.pending} />
          <Stat
            label="Bill transfers needing attention"
            value={health.billingOutbox.deadLetter}
            bad
          />
          <Stat label="Stock deductions pending" value={health.stockInbox.unprocessed} />
          <Stat label="Deductions needing attention" value={health.stockInbox.deadLettered} bad />
          <Stat label="Outgoing updates pending" value={health.stockOutbox.undelivered} />
          <Stat
            label="Outgoing updates needing attention"
            value={health.stockOutbox.deadLettered}
            bad
          />
        </div>
        {health.billingOutbox.oldestPendingAt ? (
          <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
            Oldest waiting bill update:{' '}
            {new Date(health.billingOutbox.oldestPendingAt).toLocaleString()}
          </p>
        ) : null}
      </div>

      <div className="card">
        <strong>Last consistency check</strong>
        {health.lastReconciliation ? (
          <div className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
            {new Date(health.lastReconciliation.startedAt).toLocaleString()} ·{' '}
            {health.lastReconciliation.discrepancies} differences found ·{' '}
            <details>
              <summary>Technical details</summary>
              <pre>{JSON.stringify(health.lastReconciliation.report, null, 2)}</pre>
            </details>
          </div>
        ) : (
          <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
            No consistency check has run yet.
          </p>
        )}
      </div>

      <h2 className="section-label">Failed stock deductions</h2>
      {health.deadLetters.length === 0 ? (
        <p className="ok">No failed stock deductions. Pending updates, if any, are shown above.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Update type</th>
                <th>Reference</th>
                <th className="num">Attempts</th>
                <th>Last error</th>
                <th>Failed at</th>
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
                      Retry update
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
