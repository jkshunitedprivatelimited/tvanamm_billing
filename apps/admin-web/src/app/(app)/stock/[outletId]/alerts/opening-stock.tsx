'use client';
import { useState } from 'react';
import type { LowStockItem } from '@jksh/stock';
export function OpeningStock({
  outletId,
  items,
  onSaved,
}: {
  outletId: string;
  items: LowStockItem[];
  onSaved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const pending = items.filter((i) => !i.trackingStarted);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      const lines = pending
        .filter((i) => values[i.itemId]?.trim())
        .map((i) => ({ itemId: i.itemId, quantity: (values[i.itemId] ?? '').trim() }));
      const res = await fetch(`/api/v1/stock/outlets/${outletId}/opening`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lines }),
      });
      const body = (await res.json()) as { message?: string };
      if (!res.ok)
        throw new Error(body.message ?? 'Could not save stock. Please refresh and try again.');
      setValues({});
      setOpen(false);
      setMessage('Starting stock saved. Future deliveries and sales will update these quantities.');
      await onSaved();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save stock.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card">
      <div className="row" style={{ justifyContent: 'space-between', gap: 16 }}>
        <div>
          <h2>Current stock</h2>
          <p className="muted">
            Enter what you have today, or start with your next delivery. Billing continues either
            way.
          </p>
        </div>
        <button disabled={!pending.length || busy} onClick={() => setOpen(!open)}>
          {open ? 'Cancel' : 'Enter current stock'}
        </button>
      </div>
      {!items.length ? (
        <p className="muted">
          No stock items are available yet. You can enter quantities once items appear here. Billing
          is available as usual.
        </p>
      ) : !pending.length ? (
        <p className="muted">
          Tracking has started for all items. Use a stock count to correct a quantity.
        </p>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
      {open ? (
        <form onSubmit={(e) => void save(e)}>
          <p>
            Count each item using the unit shown. Leave items blank to start tracking when they
            arrive; enter 0 only if you counted none.
          </p>
          <div className="grid">
            {pending.map((item) => (
              <label key={item.itemId}>
                {item.name} ({item.baseUnit})
                <input
                  type="number"
                  min="0"
                  step="0.000001"
                  value={values[item.itemId] ?? ''}
                  onChange={(e) => setValues({ ...values, [item.itemId]: e.target.value })}
                  placeholder="Not counted"
                  disabled={busy}
                />
              </label>
            ))}
          </div>
          <button
            style={{ marginTop: 16 }}
            disabled={busy || !pending.some((i) => values[i.itemId]?.trim())}
          >
            {busy ? 'Saving…' : 'Save starting stock'}
          </button>
        </form>
      ) : null}
    </section>
  );
}
