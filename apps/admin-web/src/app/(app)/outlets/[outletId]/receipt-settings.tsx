'use client';
import { useState } from 'react';
import type { ReceiptSettings } from '@jksh/contracts';

const TOGGLES: [keyof ReceiptSettings, string][] = [
  ['showAddress', 'Outlet address'],
  ['showOutletPhone', 'Outlet phone number'],
  ['showTime', 'Time of the bill'],
  ['showCustomerName', 'Customer name'],
  ['showCashierName', 'Cashier (employee) name'],
  ['showPaymentMethod', 'Payment method'],
  ['showItemNotes', 'Item notes'],
];

/** Owner/Central editor for what the outlet's receipts show, with a preview. */
export function ReceiptSettingsEditor({
  outletId,
  outletName,
  initial,
}: {
  outletId: string;
  outletName: string;
  initial: ReceiptSettings;
}) {
  const [s, setS] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = <K extends keyof ReceiptSettings>(k: K, v: ReceiptSettings[K]) => {
    setS({ ...s, [k]: v });
    setMsg(null);
  };

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/v1/outlets/${outletId}/receipt-settings`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(s),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) throw new Error(body.message ?? 'Could not save.');
      setMsg({ ok: true, text: 'Saved. All counters at this outlet print this way from now on.' });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Could not save.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="grid"
      style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 16 }}
    >
      <section className="card">
        <h2>What prints on the receipt</h2>
        <p className="muted">
          Outlet name and GSTIN always print. Customer details print only when the cashier enters
          them at checkout (“+ Customer details”).
        </p>
        {TOGGLES.map(([key, label]) => (
          <label key={key} className="row" style={{ gap: 8, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={s[key] as boolean}
              onChange={(e) => set(key, e.target.checked as never)}
            />
            {label}
          </label>
        ))}
        <label>
          Customer phone number
          <select
            value={s.customerMobile}
            onChange={(e) =>
              set('customerMobile', e.target.value as ReceiptSettings['customerMobile'])
            }
          >
            <option value="hidden">Don’t print</option>
            <option value="masked">Print last 4 digits only (******3210)</option>
            <option value="full">Print full number</option>
          </select>
        </label>
        <label>
          Extra line under the outlet details
          <input
            maxLength={120}
            placeholder="e.g. FSSAI Lic. No. 12345678901234"
            value={s.headerNote}
            onChange={(e) => set('headerNote', e.target.value)}
          />
        </label>
        <label>
          Message at the bottom
          <input
            maxLength={160}
            placeholder="Leave empty for no message"
            value={s.footerNote}
            onChange={(e) => set('footerNote', e.target.value)}
          />
        </label>
        <button disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save receipt layout'}
        </button>
        {msg ? <p className={msg.ok ? 'ok' : 'error'}>{msg.text}</p> : null}
      </section>

      <section className="card" aria-label="Receipt preview">
        <h2>Preview</h2>
        <div
          className="mono"
          style={{
            maxWidth: 320,
            margin: '0 auto',
            padding: 14,
            border: '1px dashed var(--border)',
            fontSize: 12,
            lineHeight: 1.5,
            background: 'var(--surface, #fff)',
          }}
        >
          <div style={{ textAlign: 'center' }}>
            <strong>{outletName}</strong>
            {s.showAddress ? <div>Shop 4, Main Road, Hyderabad</div> : null}
            {s.showOutletPhone ? <div>9876500000</div> : null}
            <div>GSTIN: 36ABCDE1234F1Z5</div>
            {s.headerNote ? <div>{s.headerNote}</div> : null}
          </div>
          <hr />
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>20261125-T01-000042</span>
            <span>2026-11-25</span>
          </div>
          {s.showTime ? <div>6:42:10 pm</div> : null}
          {s.showCashierName ? <div>Cashier: Ravi</div> : null}
          {s.showCustomerName ? <div>Customer: Priya</div> : null}
          {s.customerMobile === 'masked' ? <div>Phone: ******3210</div> : null}
          {s.customerMobile === 'full' ? <div>Phone: 9876543210</div> : null}
          <hr />
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>2 x Masala Tea</span>
            <span>₹40.00</span>
          </div>
          {s.showItemNotes ? <div style={{ paddingLeft: 10 }}>Note: less sugar</div> : null}
          <hr />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
            <span>Total</span>
            <span>₹40.00</span>
          </div>
          {s.showPaymentMethod ? (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Payment</span>
              <span>upi</span>
            </div>
          ) : null}
          {s.footerNote ? (
            <>
              <hr />
              <div style={{ textAlign: 'center' }}>{s.footerNote}</div>
            </>
          ) : null}
        </div>
      </section>
    </div>
  );
}
