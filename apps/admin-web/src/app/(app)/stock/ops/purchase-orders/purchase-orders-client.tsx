'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { PurchaseOrderDetail } from '@jksh/stock';

interface POListRow {
  id: string;
  poNumber: string;
  status: string;
  supplierId: string;
  supplierName: string;
  totalPaise: number;
}
interface Opt {
  id: string;
  name: string;
}
interface ItemOpt extends Opt {
  baseUnit: string;
}
interface Wh {
  id: string;
  code: string;
  name: string;
}
interface RcvRow {
  accepted: string;
  batch: string;
  expiry: string;
  cost: string;
}

const rupees = (p: number) => `₹${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
const toPaise = (v: string) => Math.round(Number(v || '0') * 100);

async function api(url: string, body: unknown): Promise<{ ok: boolean; data: unknown }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, data: await res.json().catch(() => ({})) };
}
function errText(d: unknown): string {
  const o = d as { message?: string; error?: string };
  return o.message ?? o.error ?? 'Something went wrong.';
}

const NEXT_ACTIONS: Record<string, { action: string; label: string }[]> = {
  draft: [
    { action: 'submit', label: 'Submit' },
    { action: 'cancel', label: 'Cancel' },
  ],
  submitted: [
    { action: 'approve', label: 'Approve' },
    { action: 'cancel', label: 'Cancel' },
  ],
  approved: [
    { action: 'order', label: 'Mark ordered' },
    { action: 'cancel', label: 'Cancel' },
  ],
  ordered: [{ action: 'close', label: 'Close' }],
  partially_received: [{ action: 'close', label: 'Close' }],
};
const CAN_RECEIVE = new Set(['ordered', 'partially_received', 'approved']);

export function PurchaseOrdersClient({
  pos,
  suppliers,
  warehouses,
  items,
}: {
  pos: POListRow[];
  suppliers: Opt[];
  warehouses: Wh[];
  items: ItemOpt[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PurchaseOrderDetail | null>(null);
  const itemName = new Map(items.map((i) => [i.id, i.name]));

  // Create-PO draft
  const [supplierId, setSupplierId] = useState('');
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? '');
  const [poNumber, setPoNumber] = useState('');
  const [lines, setLines] = useState<{ itemId: string; qty: string; price: string }[]>([
    { itemId: '', qty: '', price: '' },
  ]);

  // Receive draft (per PO-line id)
  const [rcv, setRcv] = useState<Record<string, RcvRow>>({});

  async function open(id: string) {
    if (openId === id) {
      setOpenId(null);
      setDetail(null);
      return;
    }
    setOpenId(id);
    setDetail(null);
    const res = await fetch(`/api/v1/stock/purchase-orders/${id}`);
    if (res.ok) setDetail((await res.json()) as PurchaseOrderDetail);
  }

  async function createPo(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const payloadLines = lines
      .filter((l) => l.itemId && l.qty)
      .map((l) => ({
        itemId: l.itemId,
        orderQtyBase: Number(l.qty).toFixed(6),
        unitPricePaise: toPaise(l.price),
      }));
    if (payloadLines.length === 0) {
      setBusy(false);
      return setMsg({ kind: 'error', text: 'Add at least one line.' });
    }
    const { ok, data } = await api('/api/v1/stock/purchase-orders', {
      supplierId,
      warehouseId,
      poNumber: poNumber.trim() || `PO-${Date.now().toString(36).toUpperCase()}`,
      lines: payloadLines,
    });
    setBusy(false);
    if (!ok) return setMsg({ kind: 'error', text: errText(data) });
    setAdding(false);
    setSupplierId('');
    setPoNumber('');
    setLines([{ itemId: '', qty: '', price: '' }]);
    setMsg({ kind: 'ok', text: 'Purchase order created.' });
    router.refresh();
  }

  async function transition(id: string, action: string) {
    setBusy(true);
    setMsg(null);
    const { ok, data } = await api(`/api/v1/stock/purchase-orders/${id}/transition`, { action });
    setBusy(false);
    if (!ok) return setMsg({ kind: 'error', text: errText(data) });
    setMsg({ kind: 'ok', text: `PO ${action}d.` });
    await open(id);
    await open(id);
    router.refresh();
  }

  async function receive(po: PurchaseOrderDetail) {
    setBusy(true);
    setMsg(null);
    const rcvLines = po.lines
      .map((l) => ({ l, r: rcv[l.id] }))
      .filter((x): x is { l: (typeof po.lines)[number]; r: RcvRow } => {
        return !!x.r && Number(x.r.accepted) > 0;
      })
      .map(({ l, r }) => ({
        purchaseOrderLineId: l.id,
        itemId: l.itemId,
        acceptedQtyBase: Number(r.accepted).toFixed(6),
        ...(r.batch.trim() ? { batchCode: r.batch.trim() } : {}),
        ...(r.expiry ? { expiryDate: r.expiry } : {}),
        unitCostPaise: r.cost ? toPaise(r.cost) : l.unitPricePaise,
      }));
    if (rcvLines.length === 0) {
      setBusy(false);
      return setMsg({ kind: 'error', text: 'Enter an accepted quantity on at least one line.' });
    }
    const { ok, data } = await api('/api/v1/stock/receipts', {
      purchaseOrderId: po.id,
      warehouseId: po.warehouseId,
      receiptNumber: `GRN-${po.poNumber}-${Date.now().toString(36).toUpperCase()}`,
      idempotencyKey: `grn-${po.id}-${Date.now().toString(36)}`,
      lines: rcvLines,
    });
    setBusy(false);
    if (!ok) return setMsg({ kind: 'error', text: errText(data) });
    setRcv({});
    setMsg({ kind: 'ok', text: 'Shipment received into stock.' });
    await open(po.id);
    await open(po.id);
    router.refresh();
  }

  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <button className="secondary sm" onClick={() => setAdding((v) => !v)}>
          {adding ? 'Close' : '+ New purchase order'}
        </button>
      </div>
      {msg ? <p className={msg.kind}>{msg.text}</p> : null}

      {adding ? (
        <form className="card" onSubmit={createPo}>
          <div className="toolbar">
            <label>
              Supplier
              <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
                <option value="">— select —</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Warehouse
              <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} required>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code}
                  </option>
                ))}
              </select>
            </label>
            <label>
              PO number
              <input
                value={poNumber}
                onChange={(e) => setPoNumber(e.target.value)}
                placeholder="auto"
              />
            </label>
          </div>
          {lines.map((l, i) => (
            <div key={i} className="row" style={{ gap: 8, marginBottom: 6 }}>
              <select
                value={l.itemId}
                onChange={(e) =>
                  setLines((r) => r.map((x, j) => (j === i ? { ...x, itemId: e.target.value } : x)))
                }
                style={{ margin: 0 }}
              >
                <option value="">— item —</option>
                {items.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.name}
                  </option>
                ))}
              </select>
              <input
                value={l.qty}
                onChange={(e) =>
                  setLines((r) => r.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))
                }
                placeholder="qty (base)"
                inputMode="decimal"
                style={{ margin: 0, width: 120 }}
              />
              <input
                value={l.price}
                onChange={(e) =>
                  setLines((r) => r.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))
                }
                placeholder="₹ unit"
                inputMode="decimal"
                style={{ margin: 0, width: 100 }}
              />
              {i === lines.length - 1 ? (
                <button
                  type="button"
                  className="ghost sm"
                  onClick={() => setLines((r) => [...r, { itemId: '', qty: '', price: '' }])}
                >
                  + line
                </button>
              ) : null}
            </div>
          ))}
          <button type="submit" disabled={busy || !supplierId} style={{ marginTop: 6 }}>
            Create PO
          </button>
        </form>
      ) : null}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>PO</th>
              <th>Supplier</th>
              <th>Status</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {pos.map((p) => (
              <tr
                key={p.id}
                onClick={() => void open(p.id)}
                style={{
                  cursor: 'pointer',
                  background: openId === p.id ? 'var(--panel-3)' : undefined,
                }}
              >
                <td className="mono">{p.poNumber}</td>
                <td>{p.supplierName}</td>
                <td>
                  <span className={`pill ${p.status}`}>{p.status.replace('_', ' ')}</span>
                </td>
                <td className="num">{rupees(p.totalPaise)}</td>
              </tr>
            ))}
            {pos.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted">
                  No purchase orders yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {openId && detail ? (
        <section className="card">
          <div className="spread" style={{ marginBottom: 8 }}>
            <strong>
              {detail.poNumber} · {detail.supplierName} · {detail.warehouseCode}
            </strong>
            <span className={`pill ${detail.status}`}>{detail.status.replace('_', ' ')}</span>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="num">Ordered</th>
                  <th className="num">Received</th>
                  <th className="num">Unit</th>
                  {CAN_RECEIVE.has(detail.status) ? (
                    <>
                      <th>Accept</th>
                      <th>Batch</th>
                      <th>Expiry</th>
                      <th>₹ cost</th>
                    </>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {detail.lines.map((l) => {
                  const r = rcv[l.id] ?? { accepted: '', batch: '', expiry: '', cost: '' };
                  const set = (patch: Partial<typeof r>) =>
                    setRcv((prev) => ({ ...prev, [l.id]: { ...r, ...patch } }));
                  return (
                    <tr key={l.id}>
                      <td>{itemName.get(l.itemId) ?? l.itemName}</td>
                      <td className="num">
                        {l.orderQtyBase} {l.baseUnit}
                      </td>
                      <td className="num">{l.receivedQtyBase}</td>
                      <td className="num">{rupees(l.unitPricePaise)}</td>
                      {CAN_RECEIVE.has(detail.status) ? (
                        <>
                          <td>
                            <input
                              value={r.accepted}
                              onChange={(e) => set({ accepted: e.target.value })}
                              inputMode="decimal"
                              style={{ margin: 0, width: 80 }}
                            />
                          </td>
                          <td>
                            <input
                              value={r.batch}
                              onChange={(e) => set({ batch: e.target.value })}
                              style={{ margin: 0, width: 100 }}
                            />
                          </td>
                          <td>
                            <input
                              type="date"
                              value={r.expiry}
                              onChange={(e) => set({ expiry: e.target.value })}
                              style={{ margin: 0, width: 140 }}
                            />
                          </td>
                          <td>
                            <input
                              value={r.cost}
                              onChange={(e) => set({ cost: e.target.value })}
                              placeholder={(l.unitPricePaise / 100).toString()}
                              inputMode="decimal"
                              style={{ margin: 0, width: 80 }}
                            />
                          </td>
                        </>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="row wrap" style={{ gap: 8, marginTop: 12 }}>
            {(NEXT_ACTIONS[detail.status] ?? []).map((a) => (
              <button
                key={a.action}
                className="secondary sm"
                disabled={busy}
                onClick={() => void transition(detail.id, a.action)}
              >
                {a.label}
              </button>
            ))}
            {CAN_RECEIVE.has(detail.status) ? (
              <button disabled={busy} onClick={() => void receive(detail)}>
                Receive shipment
              </button>
            ) : null}
          </div>
        </section>
      ) : null}
    </>
  );
}
