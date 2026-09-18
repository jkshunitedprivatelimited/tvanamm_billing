'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { ItemRow, StockCountRow, CountLineRow, WastageRow } from '@jksh/stock';
import { apiPost } from '../../ops/api';

const WASTAGE_REASONS = [
  'spoilage',
  'breakage',
  'expiry',
  'preparation_loss',
  'customer_cancelled',
  'pest',
  'other',
];

export function CountsWastageClient({
  role,
  items,
  stockLocationId,
  counts,
  activeCount,
  activeLines,
  wastage,
}: {
  role: string;
  items: ItemRow[];
  stockLocationId: string | null;
  counts: StockCountRow[];
  activeCount: StockCountRow | null;
  activeLines: CountLineRow[];
  wastage: WastageRow[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const [countType, setCountType] = useState<'full' | 'cycle'>('cycle');
  const [lineItemId, setLineItemId] = useState('');
  const [countedQty, setCountedQty] = useState('');
  const [lineReason, setLineReason] = useState('');

  const [wasteItemId, setWasteItemId] = useState('');
  const [wasteQty, setWasteQty] = useState('');
  const [wasteReason, setWasteReason] = useState('spoilage');

  function refresh() {
    startTransition(() => router.refresh());
  }

  async function openCount() {
    if (!stockLocationId) return;
    setMsg(null);
    const r = await apiPost('/api/v1/stock/stock-counts', { stockLocationId, countType });
    if (r.ok) refresh();
    else setMsg(`Failed: ${r.error}`);
  }

  async function addLine(e: React.FormEvent) {
    e.preventDefault();
    if (!activeCount || !lineItemId || !countedQty.trim()) return;
    setMsg(null);
    const r = await apiPost(`/api/v1/stock/stock-counts/${activeCount.id}/lines`, {
      itemId: lineItemId,
      countedQtyBase: countedQty.trim(),
      ...(lineReason.trim() ? { reason: lineReason.trim() } : {}),
    });
    if (r.ok) {
      setLineItemId('');
      setCountedQty('');
      setLineReason('');
      refresh();
    } else {
      setMsg(`Failed: ${r.error}`);
    }
  }

  async function submitForReview() {
    if (!activeCount) return;
    setMsg(null);
    const r = await apiPost(`/api/v1/stock/stock-counts/${activeCount.id}/submit`);
    if (r.ok) refresh();
    else setMsg(`Failed: ${r.error}`);
  }

  async function approve() {
    if (!activeCount) return;
    setMsg(null);
    const r = await apiPost(`/api/v1/stock/stock-counts/${activeCount.id}/approve`);
    if (r.ok) refresh();
    else setMsg(`Failed: ${r.error}`);
  }

  async function recordWastage(e: React.FormEvent) {
    e.preventDefault();
    if (!stockLocationId || !wasteItemId || !wasteQty.trim()) return;
    setMsg(null);
    const r = await apiPost('/api/v1/stock/wastage', {
      stockLocationId,
      itemId: wasteItemId,
      qtyBase: wasteQty.trim(),
      reason: wasteReason,
    });
    if (r.ok) {
      setWasteItemId('');
      setWasteQty('');
      refresh();
    } else {
      setMsg(`Failed: ${r.error}`);
    }
  }

  if (!stockLocationId) {
    return <p className="error">This outlet doesn&rsquo;t have stock tracking configured yet.</p>;
  }

  return (
    <>
      {msg ? <p className="error">{msg}</p> : null}

      <h2 className="section-label">Stock count</h2>
      <div className="card">
        {!activeCount ? (
          <div className="row" style={{ gap: 8 }}>
            <select
              value={countType}
              onChange={(e) => setCountType(e.target.value as 'full' | 'cycle')}
            >
              <option value="cycle">Cycle count (some items)</option>
              <option value="full">Full count (everything)</option>
            </select>
            <button onClick={() => void openCount()}>Open a stock count</button>
          </div>
        ) : (
          <>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span>
                <strong>{activeCount.countType === 'full' ? 'Full count' : 'Cycle count'}</strong>{' '}
                <span className="muted" style={{ fontSize: 12 }}>
                  opened {new Date(activeCount.createdAt).toLocaleDateString()}
                </span>
              </span>
              <span className={`pill ${activeCount.status}`}>{activeCount.status}</span>
            </div>

            {activeCount.periodLabel ? <p className="muted">{activeCount.periodLabel}</p> : null}
            {activeLines.length > 0 ? (
              <div style={{ marginTop: 10 }}>
                {activeLines.map((l) => (
                  <div
                    key={l.id}
                    className="row"
                    style={{ justifyContent: 'space-between', fontSize: 13, padding: '4px 0' }}
                  >
                    <span>{l.itemName}</span>
                    <span className="muted">
                      system {l.systemQtyBase} → counted {l.countedQtyBase} ({l.baseUnit})
                    </span>
                    <span
                      style={{
                        color: Number(l.varianceQtyBase) === 0 ? undefined : 'var(--danger)',
                      }}
                    >
                      {Number(l.varianceQtyBase) > 0 ? '+' : ''}
                      {l.varianceQtyBase}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}

            {activeCount.status === 'open' || activeCount.status === 'counting' ? (
              <form
                onSubmit={addLine}
                className="row"
                style={{ gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'end' }}
              >
                <label>
                  <div className="muted" style={{ fontSize: 12 }}>
                    Item
                  </div>
                  <select
                    value={lineItemId}
                    onChange={(e) => setLineItemId(e.target.value)}
                    required
                  >
                    <option value="">— choose —</option>
                    {items.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name} ({i.baseUnit})
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ width: 110 }}>
                  <div className="muted" style={{ fontSize: 12 }}>
                    Counted qty
                  </div>
                  <input
                    value={countedQty}
                    onChange={(e) => setCountedQty(e.target.value)}
                    required
                  />
                </label>
                <label style={{ width: 160 }}>
                  <div className="muted" style={{ fontSize: 12 }}>
                    Note (optional)
                  </div>
                  <input value={lineReason} onChange={(e) => setLineReason(e.target.value)} />
                </label>
                <button disabled={!lineItemId || !countedQty.trim()}>Add line</button>
              </form>
            ) : null}

            <div className="row" style={{ gap: 8, marginTop: 10 }}>
              {(activeCount.status === 'open' || activeCount.status === 'counting') &&
              activeLines.length > 0 ? (
                <button className="secondary" onClick={() => void submitForReview()}>
                  Submit for review
                </button>
              ) : null}
              {activeCount.status === 'review' &&
              ['central_admin', 'franchise_owner'].includes(role) ? (
                <button onClick={() => void approve()}>Approve adjustments</button>
              ) : null}
              {activeCount.status === 'review' &&
              !['central_admin', 'franchise_owner'].includes(role) ? (
                <p className="muted" style={{ fontSize: 12.5 }}>
                  Submitted for review. Stock changes after approval.
                </p>
              ) : null}
            </div>
          </>
        )}
      </div>

      {counts.length > 0 ? (
        <div className="card" style={{ marginTop: 8 }}>
          <strong style={{ fontSize: 13 }}>History</strong>
          {counts.map((c) => (
            <div
              key={c.id}
              className="row"
              style={{ justifyContent: 'space-between', fontSize: 13, padding: '4px 0' }}
            >
              <span>
                {c.countType} · {new Date(c.createdAt).toLocaleDateString()}
              </span>
              <span className={`pill ${c.status}`}>{c.status}</span>
            </div>
          ))}
        </div>
      ) : null}

      <h2 className="section-label">Wastage</h2>
      <form className="card" onSubmit={recordWastage}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
          <label>
            <div className="muted" style={{ fontSize: 12 }}>
              Item
            </div>
            <select value={wasteItemId} onChange={(e) => setWasteItemId(e.target.value)} required>
              <option value="">— choose —</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({i.baseUnit})
                </option>
              ))}
            </select>
          </label>
          <label style={{ width: 110 }}>
            <div className="muted" style={{ fontSize: 12 }}>
              Quantity
            </div>
            <input value={wasteQty} onChange={(e) => setWasteQty(e.target.value)} required />
          </label>
          <label>
            <div className="muted" style={{ fontSize: 12 }}>
              Reason
            </div>
            <select value={wasteReason} onChange={(e) => setWasteReason(e.target.value)}>
              {WASTAGE_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r.replace('_', ' ')}
                </option>
              ))}
            </select>
          </label>
          <button disabled={!wasteItemId || !wasteQty.trim()}>Record wastage</button>
        </div>
      </form>

      <div className="card">
        {wastage.length === 0 ? <p className="muted">No wastage recorded yet.</p> : null}
        {wastage.map((w) => (
          <div
            key={w.id}
            className="row"
            style={{ justifyContent: 'space-between', fontSize: 13, padding: '4px 0' }}
          >
            <span>
              {w.itemName} · {w.qtyBase} {w.baseUnit}
              {w.employeeName ? ` · ${w.employeeName}` : ''}
              {w.details ? <small style={{ display: 'block' }}>{w.details}</small> : null}
            </span>
            <span className="muted">
              {w.reason.replace('_', ' ')} · {new Date(w.occurredAt).toLocaleDateString()}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
