'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { ItemRow, OwnerReturnRow } from '@jksh/stock';
import { apiPost } from '../../ops/api';

const money = (paise: number | null) => (paise == null ? '—' : `₹${(paise / 100).toFixed(2)}`);

export function ReturnsClient({
  outletId,
  role,
  items,
  returns,
}: {
  outletId: string;
  role: string;
  items: ItemRow[];
  returns: OwnerReturnRow[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const [itemId, setItemId] = useState('');
  const [qtyBase, setQtyBase] = useState('');
  const [reason, setReason] = useState('');

  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [decisionNote, setDecisionNote] = useState('');
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<'credited' | 'replaced' | 'rejected'>('credited');
  const [creditAmount, setCreditAmount] = useState('');
  const [resolveNote, setResolveNote] = useState('');

  // A return is decided, collected and resolved by JKSH's own staff, never
  // by the outlet/owner that raised the request.
  const canApprove = role === 'central_admin' || role === 'warehouse_manager';
  const canCollect =
    role === 'central_admin' || role === 'warehouse_manager' || role === 'warehouse_staff';
  const canResolve = role === 'central_admin' || role === 'warehouse_manager';

  function refresh() {
    startTransition(() => router.refresh());
  }

  async function request(e: React.FormEvent) {
    e.preventDefault();
    if (!itemId || !qtyBase.trim() || !reason.trim()) return;
    setMsg(null);
    const r = await apiPost(`/api/v1/stock/outlets/${outletId}/returns`, {
      itemId,
      qtyBase: qtyBase.trim(),
      reason: reason.trim(),
    });
    if (r.ok) {
      setItemId('');
      setQtyBase('');
      setReason('');
      refresh();
    } else {
      setMsg(`Failed: ${r.error}`);
    }
  }

  async function decide(id: string, action: 'approve' | 'reject') {
    setMsg(null);
    const r = await apiPost(`/api/v1/stock/returns/${id}/decide`, {
      action,
      ...(decisionNote.trim() ? { note: decisionNote.trim() } : {}),
    });
    if (r.ok) {
      setDecidingId(null);
      setDecisionNote('');
      refresh();
    } else {
      setMsg(`Failed: ${r.error}`);
    }
  }

  async function collect(id: string) {
    setMsg(null);
    const r = await apiPost(`/api/v1/stock/returns/${id}/collect`, {});
    if (r.ok) refresh();
    else setMsg(`Failed: ${r.error}`);
  }

  async function receive(id: string) {
    setMsg(null);
    const r = await apiPost(`/api/v1/stock/returns/${id}/receive`, {});
    if (r.ok) refresh();
    else setMsg(`Failed: ${r.error}`);
  }

  async function resolve(id: string) {
    setMsg(null);
    const r = await apiPost(`/api/v1/stock/returns/${id}/resolve`, {
      outcome,
      ...(outcome === 'credited' && creditAmount.trim()
        ? { creditAmountPaise: Math.round(Number(creditAmount) * 100) }
        : {}),
      ...(resolveNote.trim() ? { note: resolveNote.trim() } : {}),
    });
    if (r.ok) {
      setResolvingId(null);
      setCreditAmount('');
      setResolveNote('');
      refresh();
    } else {
      setMsg(`Failed: ${r.error}`);
    }
  }

  return (
    <>
      {msg ? <p className="error">{msg}</p> : null}

      <form className="card" onSubmit={request}>
        <strong style={{ fontSize: 13 }}>Request a return</strong>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'end', marginTop: 8 }}>
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
          <label style={{ flex: 1, minWidth: 200 }}>
            <div className="muted" style={{ fontSize: 12 }}>
              Reason
            </div>
            <input value={reason} onChange={(e) => setReason(e.target.value)} required />
          </label>
          <button disabled={!itemId || !qtyBase.trim() || !reason.trim()}>Request return</button>
        </div>
      </form>

      <div className="card">
        {returns.length === 0 ? <p className="muted">No returns requested yet.</p> : null}
        {returns.map((r) => (
          <div
            key={r.id}
            className="cart-line"
            style={{ flexDirection: 'column', alignItems: 'stretch' }}
          >
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span>
                <strong>{r.itemName}</strong>{' '}
                <span className="muted" style={{ fontSize: 12 }}>
                  {r.qtyBase} {r.baseUnit} · {new Date(r.createdAt).toLocaleDateString()}
                </span>
              </span>
              <span className={`pill ${r.status}`}>{r.status}</span>
            </div>
            <p className="muted" style={{ fontSize: 13, margin: '4px 0' }}>
              {r.reason}
            </p>
            {r.status !== 'requested' ? (
              <p className="muted" style={{ fontSize: 12.5 }}>
                {r.creditAmountPaise != null ? `Credit: ${money(r.creditAmountPaise)}` : null}
                {r.decisionNote ? ` · ${r.decisionNote}` : ''}
              </p>
            ) : null}

            {r.status === 'requested' && canApprove ? (
              decidingId === r.id ? (
                <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                  <input
                    value={decisionNote}
                    onChange={(e) => setDecisionNote(e.target.value)}
                    placeholder="Note (optional)"
                    style={{ width: 200, margin: 0 }}
                  />
                  <button className="secondary sm" onClick={() => void decide(r.id, 'approve')}>
                    Approve
                  </button>
                  <button className="danger sm" onClick={() => void decide(r.id, 'reject')}>
                    Reject
                  </button>
                  <button className="ghost sm" onClick={() => setDecidingId(null)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  className="secondary sm"
                  style={{ marginTop: 4, alignSelf: 'start' }}
                  onClick={() => setDecidingId(r.id)}
                >
                  Decide
                </button>
              )
            ) : null}

            {r.status === 'approved' && canCollect ? (
              <button
                className="secondary sm"
                style={{ marginTop: 4, alignSelf: 'start' }}
                onClick={() => void collect(r.id)}
              >
                Mark collected
              </button>
            ) : null}

            {r.status === 'collected' && canResolve ? (
              <button
                className="secondary sm"
                style={{ marginTop: 4, alignSelf: 'start' }}
                onClick={() => void receive(r.id)}
              >
                Mark received
              </button>
            ) : null}

            {r.status === 'received' && canResolve ? (
              resolvingId === r.id ? (
                <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                  <select
                    value={outcome}
                    onChange={(e) => setOutcome(e.target.value as typeof outcome)}
                    style={{ margin: 0 }}
                  >
                    <option value="credited">Credit owner</option>
                    <option value="replaced">Replace item</option>
                    <option value="rejected">Reject (goods didn't match)</option>
                  </select>
                  {outcome === 'credited' ? (
                    <input
                      value={creditAmount}
                      onChange={(e) => setCreditAmount(e.target.value)}
                      placeholder="Credit ₹"
                      style={{ width: 120, margin: 0 }}
                    />
                  ) : null}
                  <input
                    value={resolveNote}
                    onChange={(e) => setResolveNote(e.target.value)}
                    placeholder="Note (optional)"
                    style={{ width: 200, margin: 0 }}
                  />
                  <button className="secondary sm" onClick={() => void resolve(r.id)}>
                    Confirm
                  </button>
                  <button className="ghost sm" onClick={() => setResolvingId(null)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  className="secondary sm"
                  style={{ marginTop: 4, alignSelf: 'start' }}
                  onClick={() => setResolvingId(r.id)}
                >
                  Finalize
                </button>
              )
            ) : null}
          </div>
        ))}
      </div>
    </>
  );
}
