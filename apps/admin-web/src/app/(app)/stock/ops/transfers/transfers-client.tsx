'use client';
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { TransferWorkspace } from '@jksh/stock';
import { apiPost, type ApiResult } from '../api';

function stockKey(row: TransferWorkspace['stock'][number]) {
  return `${row.locationId}:${row.itemId}:${row.batchId ?? 'none'}`;
}

interface Warehouse {
  id: string;
  name: string;
  locations: { id: string; kind: string }[];
}
interface Receipt {
  acceptedQtyBase: string;
  damagedQtyBase: string;
  shortageQtyBase: string;
}

function ReceiptForm({
  transfer,
  run,
  disabled,
}: {
  transfer: TransferWorkspace['transfers'][number];
  disabled: boolean;
  run: (url: string, body: unknown) => Promise<ApiResult>;
}) {
  const [counts, setCounts] = useState<Record<string, Receipt>>({});
  const submission = useRef<{ id: string; payload: string } | null>(null);
  const [review, setReview] = useState(false);
  const [locked, setLocked] = useState(false);
  const lines = transfer.lines.filter((l) => Number(l.remaining) > 0);
  const receipts = lines.flatMap((l) => {
    const c = counts[l.id];
    return c && Object.values(c).some((v) => Number(v) > 0) ? [{ lineId: l.id, ...c }] : [];
  });
  async function save() {
    const payload = JSON.stringify(receipts);
    if (submission.current?.payload !== payload)
      submission.current = { id: crypto.randomUUID(), payload };
    setLocked(true);
    const ok = await run(`/api/v1/stock/transfers/${transfer.id}/receive`, {
      submissionId: submission.current.id,
      receipts,
    });
    if (ok.ok) {
      setCounts({});
      setReview(false);
      setLocked(false);
      submission.current = null;
    } else if (!ok.uncertain) {
      setLocked(false);
    }
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setReview(true);
      }}
    >
      <fieldset disabled={disabled || locked || review}>
        <legend>Record this delivery</legend>
        <p>
          Leave lines at zero if they have not arrived. Record shortages only when confirmed
          missing.
        </p>
        {lines.map((l) => (
          <div key={l.id} className="card">
            <strong>
              {l.name} {l.batch ? `· Batch ${l.batch}` : ''}
            </strong>
            <p>
              Remaining: {l.remaining} {l.unit}
            </p>
            <div className="grid">
              {(['acceptedQtyBase', 'damagedQtyBase', 'shortageQtyBase'] as const).map((key, i) => (
                <label key={key}>
                  {['Accepted', 'Damaged', 'Confirmed missing'][i]} ({l.unit})
                  <input
                    type="number"
                    min="0"
                    max={l.remaining}
                    step="0.000001"
                    value={counts[l.id]?.[key] ?? '0'}
                    onChange={(e) =>
                      setCounts({
                        ...counts,
                        [l.id]: {
                          acceptedQtyBase: '0',
                          damagedQtyBase: '0',
                          shortageQtyBase: '0',
                          ...counts[l.id],
                          [key]: e.target.value || '0',
                        },
                      })
                    }
                  />
                </label>
              ))}
            </div>
          </div>
        ))}
        <button disabled={!receipts.length} type="submit">
          Review receipt
        </button>
      </fieldset>
      {review ? (
        <section aria-label="Review receipt">
          <h3>Confirm physical quantities</h3>
          {receipts.map((r) => (
            <p key={r.lineId}>
              {lines.find((l) => l.id === r.lineId)?.name}: {r.acceptedQtyBase} accepted,{' '}
              {r.damagedQtyBase} damaged, {r.shortageQtyBase} missing
            </p>
          ))}
          <button type="button" disabled={disabled} onClick={() => void save()}>
            {locked ? 'Retry same receipt' : 'Confirm receipt'}
          </button>{' '}
          <button
            type="button"
            disabled={disabled || locked}
            onClick={() => {
              setReview(false);
              setLocked(false);
            }}
          >
            Edit quantities
          </button>
        </section>
      ) : null}
    </form>
  );
}

export function TransfersClient({
  workspace,
  warehouses,
}: {
  workspace: TransferWorkspace;
  warehouses: Warehouse[];
}) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const busy = useRef(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [number, setNumber] = useState('');
  const [lines, setLines] = useState([{ stockIndex: '', quantity: '' }]);
  const [review, setReview] = useState(false);
  const [dispatchId, setDispatchId] = useState<string | null>(null);
  const disabled = saving || refreshing;
  const locations = warehouses.flatMap((w) =>
    w.locations.filter((l) => l.kind === 'sellable').map((l) => ({ id: l.id, name: w.name })),
  );
  async function run(url: string, body: unknown) {
    if (busy.current || disabled)
      return { ok: false as const, error: 'Another operation is pending.' };
    busy.current = true;
    setSaving(true);
    setMessage('');
    try {
      const result = await apiPost(url, body);
      setMessage(result.ok ? 'Saved. Stock records refreshed.' : result.error);
      if (result.ok) startTransition(() => router.refresh());
      return result;
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }
  async function create() {
    const selected = lines.map((l) => ({
      row: workspace.stock.find((s) => stockKey(s) === l.stockIndex),
      quantity: l.quantity,
    }));
    if (selected.some((l) => l.row?.locationId !== from)) return;
    const ok = await run('/api/v1/stock/transfers', {
      fromLocationId: from,
      toLocationId: to,
      transferNumber: number,
      lines: selected.map((l) => ({
        itemId: l.row?.itemId,
        batchId: l.row?.batchId,
        qtyBase: l.quantity,
      })),
    });
    if (ok.ok) {
      setReview(false);
      setNumber('');
      setLines([{ stockIndex: '', quantity: '' }]);
    }
  }
  return (
    <>
      {message ? <p role="status">{message}</p> : null}
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          setReview(true);
        }}
      >
        <h2>Create a transfer</h2>
        <p>
          A draft does not move stock. Use a unique reference so you can find it if the connection
          drops.
        </p>
        <fieldset disabled={disabled || review}>
          <legend>Transfer details</legend>
          <label>
            Reference
            <input
              required
              maxLength={60}
              value={number}
              onChange={(e) => setNumber(e.target.value)}
            />
          </label>
          <label>
            From warehouse
            <select
              required
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setLines([{ stockIndex: '', quantity: '' }]);
              }}
            >
              <option value="">Choose source</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            To warehouse
            <select required value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">Choose destination</option>
              {locations
                .filter((l) => l.id !== from)
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
            </select>
          </label>
          {lines.map((line, index) => (
            <div className="grid" key={index}>
              <label>
                Item and batch
                <select
                  required
                  value={line.stockIndex}
                  onChange={(e) =>
                    setLines(
                      lines.map((l, i) => (i === index ? { ...l, stockIndex: e.target.value } : l)),
                    )
                  }
                >
                  <option value="">Choose stock</option>
                  {workspace.stock.map((s, i) =>
                    s.locationId === from ? (
                      <option key={i} value={stockKey(s)}>
                        {s.itemName} · {s.batchCode ?? 'No batch'} · {s.available} {s.unit}{' '}
                        available
                      </option>
                    ) : null,
                  )}
                </select>
              </label>
              <label>
                Quantity in base unit
                <input
                  required
                  type="number"
                  min="0.000001"
                  step="0.000001"
                  max={
                    line.stockIndex
                      ? workspace.stock.find((s) => stockKey(s) === line.stockIndex)?.available
                      : undefined
                  }
                  value={line.quantity}
                  onChange={(e) =>
                    setLines(
                      lines.map((l, i) => (i === index ? { ...l, quantity: e.target.value } : l)),
                    )
                  }
                />
              </label>
              {lines.length > 1 ? (
                <button type="button" onClick={() => setLines(lines.filter((_, i) => i !== index))}>
                  Remove line
                </button>
              ) : null}
            </div>
          ))}
          <button
            type="button"
            onClick={() => setLines([...lines, { stockIndex: '', quantity: '' }])}
          >
            Add item
          </button>{' '}
          <button type="submit" disabled={!from || !to || from === to}>
            Review transfer
          </button>
        </fieldset>
        {review ? (
          <section>
            <h3>Review {number}</h3>
            <p>
              {locations.find((l) => l.id === from)?.name} →{' '}
              {locations.find((l) => l.id === to)?.name}
            </p>
            {lines.map((l, i) => (
              <p key={i}>
                {workspace.stock.find((s) => stockKey(s) === l.stockIndex)?.itemName}: {l.quantity}{' '}
                {workspace.stock.find((s) => stockKey(s) === l.stockIndex)?.unit}
              </p>
            ))}
            <button type="button" disabled={disabled} onClick={() => void create()}>
              Save draft
            </button>{' '}
            <button type="button" disabled={disabled} onClick={() => setReview(false)}>
              Edit
            </button>
          </section>
        ) : null}
      </form>
      <h2>Recent transfers</h2>
      <p>Showing the latest 100 transfers.</p>
      {!workspace.transfers.length ? <p>No warehouse transfers yet.</p> : null}
      {workspace.transfers.map((t) => (
        <section className="card" key={t.id}>
          <h3>
            {t.number} · {t.status.replaceAll('_', ' ')}
          </h3>
          <p>
            {t.fromName} → {t.toName}
          </p>
          <ul>
            {t.lines.map((l) => (
              <li key={l.id}>
                {l.name} {l.batch ? `· ${l.batch}` : ''}: {l.quantity} {l.unit}
              </li>
            ))}
          </ul>
          {t.status === 'draft' ? (
            dispatchId === t.id ? (
              <div>
                <p>
                  Confirm these goods are leaving the source warehouse. Dispatch moves stock into
                  transit.
                </p>
                <button
                  disabled={disabled}
                  onClick={() =>
                    void run(`/api/v1/stock/transfers/${t.id}/dispatch`, {}).then((ok) => {
                      if (ok.ok) setDispatchId(null);
                    })
                  }
                >
                  Confirm dispatch
                </button>{' '}
                <button disabled={disabled} onClick={() => setDispatchId(null)}>
                  Cancel
                </button>
              </div>
            ) : (
              <button disabled={disabled} onClick={() => setDispatchId(t.id)}>
                Dispatch…
              </button>
            )
          ) : null}
          {['dispatched', 'partially_received'].includes(t.status) ? (
            <ReceiptForm key={t.id} transfer={t} run={run} disabled={disabled} />
          ) : null}
        </section>
      ))}
    </>
  );
}
