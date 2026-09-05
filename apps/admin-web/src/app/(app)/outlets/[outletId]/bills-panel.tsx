'use client';

import { useState } from 'react';
import type { BillView, Role } from '@jksh/contracts';

interface BillListRow {
  id: string;
  receiptNumber: string;
  businessDate: string;
  finalTotal: string;
  paymentMethod: string | null;
  isComplimentary: boolean;
  committedAt: string;
}

export function BillsPanel({ outletId, role }: { outletId: string; role: Role }) {
  const [bills, setBills] = useState<BillListRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [businessDate, setBusinessDate] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<BillView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canRefund = role === 'franchise_owner';

  async function load(reset: boolean) {
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (businessDate) params.set('businessDate', businessDate);
      if (!reset && nextCursor) params.set('cursor', nextCursor);
      const res = await fetch(`/api/v1/outlets/${outletId}/bills?${params.toString()}`);
      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        setError(body.message ?? 'Could not load bills.');
        return;
      }
      const body = (await res.json()) as { bills: BillListRow[]; nextCursor: string | null };
      setBills((prev) => (reset ? body.bills : [...prev, ...body.bills]));
      setNextCursor(body.nextCursor);
      setLoaded(true);
    } finally {
      setBusy(false);
    }
  }

  async function openBill(id: string) {
    setError(null);
    const res = await fetch(`/api/v1/bills/${id}`);
    if (!res.ok) {
      const body = (await res.json()) as { message?: string };
      setError(body.message ?? 'Could not load bill.');
      return;
    }
    setSelected((await res.json()) as BillView);
  }

  return (
    <div className="card">
      <h2>Bills</h2>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <input
          type="date"
          value={businessDate}
          onChange={(e) => setBusinessDate(e.target.value)}
          style={{ width: 180 }}
        />
        <button className="secondary" disabled={busy} onClick={() => void load(true)}>
          {loaded ? 'Refresh' : 'Load bills'}
        </button>
      </div>
      {error ? <p className="error">{error}</p> : null}
      {loaded && bills.length === 0 ? <p className="muted">No bills for this filter.</p> : null}
      {bills.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th>Receipt</th>
              <th>Date</th>
              <th>Time</th>
              <th>Total</th>
              <th>Payment</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {bills.map((b) => (
              <tr key={b.id}>
                <td className="mono">{b.receiptNumber}</td>
                <td>{b.businessDate}</td>
                <td>{new Date(b.committedAt).toLocaleTimeString()}</td>
                <td>₹{b.finalTotal}</td>
                <td>{b.isComplimentary ? 'Complimentary' : (b.paymentMethod ?? '-')}</td>
                <td>
                  <button className="secondary" onClick={() => void openBill(b.id)}>
                    View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {nextCursor ? (
        <button
          className="secondary"
          style={{ marginTop: 10 }}
          disabled={busy}
          onClick={() => void load(false)}
        >
          Load more
        </button>
      ) : null}

      {selected ? (
        <BillDetailModal
          bill={selected}
          canRefund={canRefund}
          onClose={() => setSelected(null)}
          onRefunded={() => {
            void openBill(selected.id);
          }}
        />
      ) : null}
    </div>
  );
}

function BillDetailModal({
  bill,
  canRefund,
  onClose,
  onRefunded,
}: {
  bill: BillView;
  canRefund: boolean;
  onClose: () => void;
  onRefunded: () => void;
}) {
  const [showRefund, setShowRefund] = useState(false);
  const eligible = bill.status !== 'fully_refunded' && Number(bill.remainingRefundable) > 0;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 50,
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ width: 480, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>{bill.receiptNumber}</h2>
        <p className="muted">
          {bill.employeeName} · {bill.status}
        </p>
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Qty</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {bill.lines.map((l) => (
              <tr key={l.id}>
                <td>{l.itemName}</td>
                <td>
                  {l.quantity}
                  {l.refundedQuantity > 0 ? ` (${String(l.refundedQuantity)} refunded)` : ''}
                </td>
                <td>₹{l.finalTotal}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          <strong>Total: ₹{bill.finalTotal}</strong> · Remaining refundable: ₹
          {bill.remainingRefundable}
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          {canRefund && eligible ? (
            <button className="secondary" onClick={() => setShowRefund(true)}>
              Refund
            </button>
          ) : null}
          <button className="secondary" onClick={onClose}>
            Close
          </button>
        </div>
        {showRefund ? (
          <AdminRefundForm
            billId={bill.id}
            onClose={() => setShowRefund(false)}
            onDone={() => {
              setShowRefund(false);
              onRefunded();
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

function AdminRefundForm({
  billId,
  onClose,
  onDone,
}: {
  billId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [payoutMethod, setPayoutMethod] = useState<'cash' | 'upi'>('cash');
  const [payoutReference, setPayoutReference] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/bills/${billId}/refunds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotencyKey: crypto.randomUUID() + crypto.randomUUID(),
          kind: 'full',
          payoutMethod,
          reason,
          ...(payoutMethod === 'upi' ? { payoutReference } : {}),
        }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        setError(body.message ?? 'Refund failed.');
        return;
      }
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
      <h3 style={{ margin: '0 0 8px' }}>Full refund</h3>
      <p className="muted">
        Franchise Owner refunds are limited to a 60-day window from the bill&apos;s original date.
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button
          className={payoutMethod === 'cash' ? '' : 'secondary'}
          onClick={() => setPayoutMethod('cash')}
        >
          Cash
        </button>
        <button
          className={payoutMethod === 'upi' ? '' : 'secondary'}
          onClick={() => setPayoutMethod('upi')}
        >
          UPI
        </button>
      </div>
      {payoutMethod === 'upi' ? (
        <input
          placeholder="UPI refund reference"
          value={payoutReference}
          onChange={(e) => setPayoutReference(e.target.value)}
          style={{ marginBottom: 8 }}
        />
      ) : null}
      <input
        placeholder="Reason (required)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        style={{ marginBottom: 8 }}
      />
      {error ? <p className="error">{error}</p> : null}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          disabled={busy || !reason.trim() || (payoutMethod === 'upi' && !payoutReference.trim())}
          onClick={() => void submit()}
        >
          Confirm refund
        </button>
        <button className="secondary" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
