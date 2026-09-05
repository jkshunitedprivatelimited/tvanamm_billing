'use client';

import { useEffect, useState } from 'react';
import type { BillView, ReceiptSnapshot } from '@jksh/contracts';
import { ReceiptView } from '../receipt-view';
import { terminalPaperWidthMm } from '../terminal-prefs';

interface BillListRow {
  id: string;
  receiptNumber: string;
  businessDate: string;
  finalTotal: string;
  paymentMethod: string | null;
  isComplimentary: boolean;
  committedAt: string;
}

export function HistoryClient() {
  const [bills, setBills] = useState<BillListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<BillView | null>(null);
  const [receipt, setReceipt] = useState<ReceiptSnapshot | null>(null);
  const [showRefund, setShowRefund] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch('/api/v1/bills')
      .then((r) => r.json() as Promise<{ bills: BillListRow[] }>)
      .then((body) => setBills(body.bills))
      .finally(() => setLoading(false));
  }, []);

  async function open(id: string) {
    setError(null);
    const res = await fetch(`/api/v1/bills/${id}`);
    const body = (await res.json()) as BillView;
    setSelected(body);
    setReceipt(null);
  }

  async function viewReceipt(id: string) {
    const res = await fetch(`/api/v1/bills/${id}/receipt`);
    setReceipt((await res.json()) as ReceiptSnapshot);
  }

  function printAndLog(id: string) {
    let result: 'success' | 'failed' = 'success';
    try {
      window.print();
    } catch {
      result = 'failed';
    }
    void fetch(`/api/v1/bills/${id}/print-attempts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ result }),
    });
  }

  if (receipt && selected) {
    return (
      <div>
        <div style={{ width: 380, maxWidth: '100%' }}>
          <ReceiptView receipt={receipt} paperWidthMm={terminalPaperWidthMm()} />
          <div className="no-print" style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button onClick={() => printAndLog(selected.id)}>Reprint</button>
            <button className="ghost" onClick={() => setReceipt(null)}>
              Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (selected) {
    return (
      <BillDetail
        bill={selected}
        onBack={() => setSelected(null)}
        onViewReceipt={() => void viewReceipt(selected.id)}
        onRefund={() => setShowRefund(true)}
        showRefund={showRefund}
        onRefundClose={() => setShowRefund(false)}
        onRefunded={() => {
          setShowRefund(false);
          void open(selected.id);
        }}
      />
    );
  }

  return (
    <div>
      {loading ? <p className="muted">Loading…</p> : null}
      {!loading && bills.length === 0 ? <p className="muted">No bills yet today.</p> : null}
      {error ? <p className="error">{error}</p> : null}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {bills.map((b) => (
          <button
            key={b.id}
            className="item-card"
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
            onClick={() => void open(b.id)}
          >
            <span>
              <div className="name">{b.receiptNumber}</div>
              <div className="meta">{new Date(b.committedAt).toLocaleTimeString()}</div>
            </span>
            <span>
              ₹{b.finalTotal} · {b.isComplimentary ? 'Comp' : (b.paymentMethod ?? '-')}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function BillDetail({
  bill,
  onBack,
  onViewReceipt,
  onRefund,
  showRefund,
  onRefundClose,
  onRefunded,
}: {
  bill: BillView;
  onBack: () => void;
  onViewReceipt: () => void;
  onRefund: () => void;
  showRefund: boolean;
  onRefundClose: () => void;
  onRefunded: () => void;
}) {
  const canRefund = bill.status !== 'fully_refunded' && Number(bill.remainingRefundable) > 0;
  return (
    <div>
      <button className="link-btn" onClick={onBack}>
        &larr; Back to list
      </button>
      <h1 style={{ fontSize: 18 }}>{bill.receiptNumber}</h1>
      <p className="muted">
        {bill.status === 'completed'
          ? 'Completed'
          : bill.status === 'partially_refunded'
            ? 'Partially refunded'
            : 'Fully refunded'}
      </p>
      <div className="panel" style={{ width: 'auto', padding: 14 }}>
        {bill.lines.map((l) => (
          <div className="cart-line" key={l.lineNo}>
            <span>
              {l.quantity} x {l.itemName}
              {l.refundedQuantity > 0 ? ` (${String(l.refundedQuantity)} refunded)` : ''}
            </span>
            <span>₹{l.finalTotal}</span>
          </div>
        ))}
        <div className="totals-row grand">
          <span>Total</span>
          <span>₹{bill.finalTotal}</span>
        </div>
        <div className="totals-row">
          <span>Remaining refundable</span>
          <span>₹{bill.remainingRefundable}</span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
        <button onClick={onViewReceipt}>View / print receipt</button>
        {canRefund ? (
          <button className="ghost" onClick={onRefund}>
            Refund
          </button>
        ) : null}
      </div>
      {showRefund ? <RefundModal bill={bill} onClose={onRefundClose} onDone={onRefunded} /> : null}
    </div>
  );
}

function RefundModal({
  bill,
  onClose,
  onDone,
}: {
  bill: BillView;
  onClose: () => void;
  onDone: () => void;
}) {
  const [kind, setKind] = useState<'full' | 'partial'>('full');
  const [payoutMethod, setPayoutMethod] = useState<'cash' | 'upi'>('cash');
  const [reason, setReason] = useState('');
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [payoutReference, setPayoutReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refundableLines = bill.lines.filter((l) => l.quantity - l.refundedQuantity > 0);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const lines =
        kind === 'partial'
          ? refundableLines
              .map((l) => ({ billLineId: l.id, quantity: quantities[l.lineNo] ?? 0 }))
              .filter((l) => l.quantity > 0)
          : undefined;
      const res = await fetch(`/api/v1/bills/${bill.id}/refunds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotencyKey: crypto.randomUUID() + crypto.randomUUID(),
          kind,
          payoutMethod,
          reason,
          ...(payoutMethod === 'upi' ? { payoutReference } : {}),
          ...(lines ? { lines } : {}),
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
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <h1 style={{ fontSize: 16, marginTop: 0 }}>Refund</h1>
        <div className="pay-row">
          <button
            className={kind === 'full' ? 'selected' : 'ghost'}
            onClick={() => setKind('full')}
          >
            Full
          </button>
          <button
            className={kind === 'partial' ? 'selected' : 'ghost'}
            onClick={() => setKind('partial')}
          >
            Partial
          </button>
        </div>
        {kind === 'partial' ? (
          <div style={{ marginBottom: 10 }}>
            {refundableLines.map((l) => (
              <div
                className="row"
                key={l.lineNo}
                style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}
              >
                <span>
                  {l.itemName} ({l.quantity - l.refundedQuantity} left)
                </span>
                <input
                  type="number"
                  min="0"
                  max={l.quantity - l.refundedQuantity}
                  style={{ width: 70, marginBottom: 0 }}
                  value={quantities[l.lineNo] ?? 0}
                  onChange={(e) =>
                    setQuantities((prev) => ({ ...prev, [l.lineNo]: Number(e.target.value) }))
                  }
                />
              </div>
            ))}
          </div>
        ) : null}
        <div className="pay-row">
          <button
            className={payoutMethod === 'cash' ? 'selected' : 'ghost'}
            onClick={() => setPayoutMethod('cash')}
          >
            Cash
          </button>
          <button
            className={payoutMethod === 'upi' ? 'selected' : 'ghost'}
            onClick={() => setPayoutMethod('upi')}
          >
            UPI
          </button>
        </div>
        {payoutMethod === 'upi' ? (
          <>
            <label htmlFor="payout-reference">UPI refund reference (required)</label>
            <input
              id="payout-reference"
              value={payoutReference}
              onChange={(e) => setPayoutReference(e.target.value)}
            />
          </>
        ) : null}
        <label htmlFor="refund-reason">Reason (required)</label>
        <input id="refund-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        {error ? <p className="error">{error}</p> : null}
        <button
          disabled={busy || !reason.trim() || (payoutMethod === 'upi' && !payoutReference.trim())}
          onClick={() => void submit()}
        >
          Confirm refund
        </button>
        <button className="ghost" style={{ marginTop: 8 }} onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
