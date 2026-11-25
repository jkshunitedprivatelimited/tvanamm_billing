'use client';
import { useRef, useState } from 'react';
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
  const [review, setReview] = useState<{
    submissionId: string;
    lines: { itemId: string; quantity: string }[];
  } | null>(null);
  const saving = useRef(false);
  const pending = items.filter((i) => !i.trackingStarted);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (saving.current || !review) return;
    saving.current = true;
    setBusy(true);
    setMessage('');
    try {
      const res = await fetch(`/api/v1/stock/outlets/${outletId}/opening`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(review),
      });
      const body = (await res.json()) as { message?: string };
      if (!res.ok)
        throw new Error(body.message ?? 'Could not save stock. Please refresh and try again.');
      setValues({});
      setOpen(false);
      setMessage(`Starting stock saved. Reference: ${review.submissionId}.`);
      setReview(null);
      try {
        await onSaved();
      } catch {
        setMessage(
          `Starting stock saved. Reference: ${review.submissionId}. Refresh to see updated quantities.`,
        );
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save stock.');
    } finally {
      saving.current = false;
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
        <button
          disabled={!pending.length || busy}
          onClick={() => {
            setOpen(!open);
            setReview(null);
          }}
        >
          {open ? 'Cancel' : 'Enter current stock'}
        </button>
      </div>
      <p>
        {items.length - pending.length} of {items.length} materials have a starting quantity
        recorded.
      </p>
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
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (review) {
              void save(e);
              return;
            }
            setMessage('');
            setReview({
              submissionId: crypto.randomUUID(),
              lines: pending
                .filter((i) => values[i.itemId]?.trim())
                .map((i) => ({ itemId: i.itemId, quantity: (values[i.itemId] ?? '').trim() })),
            });
          }}
        >
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
                  disabled={busy || !!review}
                />
              </label>
            ))}
          </div>
          {review ? (
            <div role="region" aria-label="Review starting stock">
              <h3>Review {review.lines.length} counted materials</h3>
              <ul>
                {review.lines.map((line) => {
                  const item = items.find((i) => i.itemId === line.itemId);
                  return (
                    <li key={line.itemId}>
                      {item?.name}: {line.quantity} {item?.baseUnit}
                    </li>
                  );
                })}
              </ul>
              <p>
                {pending.length - review.lines.length} materials will remain uncounted. Zero means
                you physically checked and found none. Saved quantities must be corrected through a
                stock count.
              </p>
              <button type="button" disabled={busy} onClick={() => setReview(null)}>
                Edit quantities
              </button>
            </div>
          ) : null}
          <button
            style={{ marginTop: 16 }}
            disabled={busy || !pending.some((i) => values[i.itemId]?.trim())}
          >
            {busy ? 'Saving…' : review ? 'Confirm starting stock' : 'Review quantities'}
          </button>
        </form>
      ) : null}
    </section>
  );
}
