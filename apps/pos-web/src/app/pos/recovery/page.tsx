'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  listOutboxBills,
  readOfflineKit,
  removeOutboxBill,
  type OfflineKit,
  type OutboxBill,
} from '@/lib/offline-store';

export default function RecoveryPage() {
  const [bills, setBills] = useState<OutboxBill[]>([]);
  const [kit, setKit] = useState<OfflineKit | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [b, k] = await Promise.all([listOutboxBills(), readOfflineKit()]);
    setBills(b);
    setKit(k);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function syncNow() {
    setBusy(true);
    setMsg(null);
    const pending = (await listOutboxBills()).filter((b) => b.status === 'pending');
    if (pending.length === 0) {
      setMsg('Nothing pending.');
      setBusy(false);
      return;
    }
    try {
      const res = await fetch('/api/v1/bills/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bills: pending.map((b) => b.cmd) }),
      });
      if (!res.ok) {
        setMsg(`Sync failed (${String(res.status)}).`);
      } else {
        const { results } = (await res.json()) as {
          results: { idempotencyKey: string; ok: boolean; error?: string }[];
        };
        const ok = results.filter((r) => r.ok).length;
        for (const r of results) {
          if (r.ok) await removeOutboxBill(r.idempotencyKey);
        }
        setMsg(`Synced ${String(ok)} of ${String(results.length)}.`);
      }
    } catch {
      setMsg('Still offline — try again when connected.');
    }
    await refresh();
    setBusy(false);
  }

  async function discard(key: string) {
    await removeOutboxBill(key);
    await refresh();
  }

  const pending = bills.filter((b) => b.status === 'pending').length;
  const failed = bills.filter((b) => b.status === 'failed').length;

  return (
    <main className="pos">
      <p className="muted">
        <Link href="/pos">← Billing</Link>
      </p>
      <h1>Offline bill recovery</h1>
      <p className="muted" style={{ fontSize: 13 }}>
        Bills created while this terminal was offline. They send automatically on reconnect; use{' '}
        <strong>Sync now</strong> to push them immediately.
      </p>

      <div className="statusbar" style={{ borderRadius: 10, border: '1px solid var(--border)' }}>
        <span>
          {pending} pending · {failed} failed
          {kit ? ` · ${String(kit.receiptNumbers.length)} spare receipt numbers` : ' · not armed'}
        </span>
        <button style={{ width: 'auto' }} onClick={syncNow} disabled={busy}>
          {busy ? 'Syncing…' : 'Sync now'}
        </button>
      </div>
      {msg ? <p className="ok">{msg}</p> : null}

      <table style={{ marginTop: 16, width: '100%' }}>
        <thead>
          <tr>
            <th>Receipt</th>
            <th>Total</th>
            <th>Pay</th>
            <th>Queued</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {bills.map((b) => (
            <tr key={b.key}>
              <td className="mono">{b.provisional.receiptNumber ?? '—'}</td>
              <td>₹{b.provisional.total}</td>
              <td>{b.provisional.paymentMethod ?? 'comp'}</td>
              <td className="muted">{new Date(b.queuedAt).toLocaleString()}</td>
              <td>
                {b.status === 'failed' ? (
                  <span style={{ color: 'var(--danger)' }}>failed — {b.error}</span>
                ) : (
                  b.status
                )}
              </td>
              <td>
                {b.status === 'failed' ? (
                  <button
                    className="ghost"
                    style={{ width: 'auto' }}
                    onClick={() => void discard(b.key)}
                  >
                    Discard
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
          {bills.length === 0 ? (
            <tr>
              <td colSpan={6} className="muted">
                No offline bills — everything is synced.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </main>
  );
}
