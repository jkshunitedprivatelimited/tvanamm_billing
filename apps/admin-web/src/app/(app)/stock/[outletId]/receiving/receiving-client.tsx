'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { ItemRow, LocalInwardRow, DiscrepancyRow, CloseableOrderRow } from '@jksh/stock';
import { apiPost } from '../../ops/api';

const DISCREPANCY_RESOLUTIONS: { value: string; label: string; excessOnly?: boolean }[] = [
  { value: 'replacement', label: 'Replacement' },
  { value: 'credit_note', label: 'Credit note' },
  { value: 'approved_excess', label: 'Approve excess', excessOnly: true },
  { value: 'return_collection', label: 'Return collection' },
  { value: 'written_off', label: 'Write off' },
];

export function ReceivingClient({
  outletId,
  items,
  initialLocalInwards,
  initialDiscrepancies,
  initialCloseableOrders,
}: {
  outletId: string;
  items: ItemRow[];
  initialLocalInwards: LocalInwardRow[];
  initialDiscrepancies: DiscrepancyRow[];
  initialCloseableOrders: CloseableOrderRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const [itemId, setItemId] = useState('');
  const [qtyBase, setQtyBase] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [batchCode, setBatchCode] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');

  const [reversingId, setReversingId] = useState<string | null>(null);
  const [reverseReason, setReverseReason] = useState('');
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  function refresh() {
    startTransition(() => router.refresh());
  }

  async function recordInward(e: React.FormEvent) {
    e.preventDefault();
    if (!itemId || !qtyBase.trim()) return;
    setMsg(null);
    const r = await apiPost(`/api/v1/stock/outlets/${outletId}/local-inward`, {
      itemId,
      qtyBase: qtyBase.trim(),
      ...(unitCost.trim() ? { unitCostPaise: Math.round(Number(unitCost) * 100) } : {}),
      ...(batchCode.trim() ? { batchCode: batchCode.trim() } : {}),
      ...(expiryDate ? { expiryDate } : {}),
      ...(supplierName.trim() ? { supplierName: supplierName.trim() } : {}),
      ...(invoiceNumber.trim() ? { invoiceNumber: invoiceNumber.trim() } : {}),
    });
    if (r.ok) {
      setQtyBase('');
      setUnitCost('');
      setBatchCode('');
      setExpiryDate('');
      setSupplierName('');
      setInvoiceNumber('');
      setMsg('Recorded.');
      refresh();
    } else {
      setMsg(`Failed: ${r.error}`);
    }
  }

  async function reviewInward(id: string, action: 'confirm' | 'reverse', reason?: string) {
    setMsg(null);
    const r = await apiPost(`/api/v1/stock/local-inwards/${id}/review`, {
      action,
      ...(reason ? { reason } : {}),
    });
    if (r.ok) {
      setReversingId(null);
      setReverseReason('');
      refresh();
    } else {
      setMsg(`Failed: ${r.error}`);
    }
  }

  async function resolve(id: string, resolution: string) {
    setMsg(null);
    const r = await apiPost(`/api/v1/stock/discrepancies/${id}/resolve`, { resolution });
    if (r.ok) {
      setResolvingId(null);
      refresh();
    } else {
      setMsg(`Failed: ${r.error}`);
    }
  }

  async function closeOrder(id: string) {
    setMsg(null);
    const r = await apiPost(`/api/v1/stock/orders/${id}/close`);
    if (r.ok) refresh();
    else setMsg(`Failed: ${r.error}`);
  }

  return (
    <>
      {initialCloseableOrders.length > 0 ? (
        <>
          <h2 className="section-label">Orders ready to close</h2>
          <div className="card">
            <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
              Fully received — close one once every discrepancy against it is resolved.
            </p>
            {initialCloseableOrders.map((o) => (
              <div
                key={o.id}
                className="row"
                style={{ justifyContent: 'space-between', padding: '4px 0' }}
              >
                <span>
                  <strong>{o.orderNumber}</strong>{' '}
                  <span className="muted" style={{ fontSize: 12 }}>
                    ₹{(o.totalPaise / 100).toFixed(2)}
                  </span>
                </span>
                {o.openDiscrepancies > 0 ? (
                  <span className="muted" style={{ fontSize: 12.5 }}>
                    {o.openDiscrepancies} open discrepanc{o.openDiscrepancies === 1 ? 'y' : 'ies'}{' '}
                    to resolve first
                  </span>
                ) : (
                  <button className="secondary sm" onClick={() => void closeOrder(o.id)}>
                    Close order
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      ) : null}

      <h2 className="section-label">Add a local purchase</h2>
      <form className="card" onSubmit={recordInward}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
          <label>
            <div className="muted" style={{ fontSize: 12 }}>
              Item
            </div>
            <select value={itemId} onChange={(e) => setItemId(e.target.value)} required>
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
            <input value={qtyBase} onChange={(e) => setQtyBase(e.target.value)} required />
          </label>
          <label style={{ width: 110 }}>
            <div className="muted" style={{ fontSize: 12 }}>
              Unit cost ₹ (optional)
            </div>
            <input
              value={unitCost}
              onChange={(e) => setUnitCost(e.target.value)}
              placeholder="pending"
            />
          </label>
          <label style={{ width: 140 }}>
            <div className="muted" style={{ fontSize: 12 }}>
              Batch code (optional)
            </div>
            <input value={batchCode} onChange={(e) => setBatchCode(e.target.value)} />
          </label>
          <label style={{ width: 140 }}>
            <div className="muted" style={{ fontSize: 12 }}>
              Expiry (optional)
            </div>
            <input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
          </label>
          <label style={{ width: 160 }}>
            <div className="muted" style={{ fontSize: 12 }}>
              Supplier (optional)
            </div>
            <input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} />
          </label>
          <label style={{ width: 140 }}>
            <div className="muted" style={{ fontSize: 12 }}>
              Invoice # (optional)
            </div>
            <input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
          </label>
          <button disabled={pending || !itemId || !qtyBase.trim()}>Record</button>
        </div>
        {msg ? (
          <p className="muted" style={{ marginTop: 8 }}>
            {msg}
          </p>
        ) : null}
      </form>

      <h2 className="section-label">Local purchases</h2>
      <div className="card">
        {initialLocalInwards.length === 0 ? <p className="muted">None recorded yet.</p> : null}
        {initialLocalInwards.map((li) => (
          <div
            key={li.id}
            className="cart-line"
            style={{ flexDirection: 'column', alignItems: 'stretch' }}
          >
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span>
                <strong>{li.itemName}</strong>{' '}
                <span className="muted" style={{ fontSize: 12 }}>
                  {li.qtyBase} {li.baseUnit}
                  {li.employeeName ? ` · Recorded by ${li.employeeName}` : ''}
                  {li.supplierName ? ` · ${li.supplierName}` : ''}
                  {li.invoiceNumber ? ` · Inv ${li.invoiceNumber}` : ''}
                </span>
              </span>
              <span className="muted" style={{ fontSize: 12 }}>
                {li.totalPaid
                  ? `Total paid ₹${li.totalPaid} · Expense recorded`
                  : li.unitCostPaise == null
                    ? 'cost pending'
                    : `₹${(li.unitCostPaise / 100).toFixed(2)}/unit`}
              </span>
            </div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
              <span className={`pill ${li.status}`}>{li.status.replace('_', ' ')}</span>
              {li.status === 'pending_review' ? (
                reversingId === li.id ? (
                  <>
                    <input
                      value={reverseReason}
                      onChange={(e) => setReverseReason(e.target.value)}
                      placeholder="Reason"
                      style={{ width: 180, margin: 0 }}
                    />
                    <button
                      type="button"
                      className="danger sm"
                      disabled={!reverseReason.trim()}
                      onClick={() => void reviewInward(li.id, 'reverse', reverseReason.trim())}
                    >
                      Confirm reversal
                    </button>
                    <button type="button" className="ghost sm" onClick={() => setReversingId(null)}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="secondary sm"
                      onClick={() => void reviewInward(li.id, 'confirm')}
                    >
                      Confirm
                    </button>
                    {!li.expenseId ? (
                      <button
                        type="button"
                        className="ghost sm"
                        onClick={() => setReversingId(li.id)}
                      >
                        Reverse
                      </button>
                    ) : (
                      <a href={`/outlets/${outletId}?section=expenses`}>View linked expense →</a>
                    )}
                  </>
                )
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <h2 className="section-label">Discrepancies</h2>
      <div className="card">
        {initialDiscrepancies.length === 0 ? <p className="muted">No discrepancies.</p> : null}
        {initialDiscrepancies.map((d) => (
          <div
            key={d.id}
            className="cart-line"
            style={{ flexDirection: 'column', alignItems: 'stretch' }}
          >
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span>
                <strong>{d.itemName}</strong>{' '}
                <span className="muted" style={{ fontSize: 12 }}>
                  {d.qtyBase} {d.baseUnit}
                </span>
              </span>
              <span className={`pill ${d.kind === 'excess' ? 'warn' : 'danger'}`}>{d.kind}</span>
            </div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
              <span className={`pill ${d.status}`}>{d.status}</span>
              {d.resolution ? (
                <span className="muted" style={{ fontSize: 12 }}>
                  {d.resolution}
                </span>
              ) : null}
              {d.status === 'open' ? (
                resolvingId === d.id ? (
                  <>
                    {DISCREPANCY_RESOLUTIONS.filter(
                      (r) => !r.excessOnly || d.kind === 'excess',
                    ).map((r) => (
                      <button
                        key={r.value}
                        type="button"
                        className="secondary sm"
                        onClick={() => void resolve(d.id, r.value)}
                      >
                        {r.label}
                      </button>
                    ))}
                    <button type="button" className="ghost sm" onClick={() => setResolvingId(null)}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="secondary sm"
                    onClick={() => setResolvingId(d.id)}
                  >
                    Resolve
                  </button>
                )
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
