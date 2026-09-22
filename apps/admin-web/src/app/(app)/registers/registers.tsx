'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { OwnerRegisterReview } from '@jksh/identity';

const money = (value: string | number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(value));

export function Registers({ initial }: { initial: OwnerRegisterReview[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<OwnerRegisterReview | null>(null);
  const [counted, setCounted] = useState('');
  const [reason, setReason] = useState('');
  const [closeShifts, setCloseShifts] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const submitting = useRef(false);
  async function review(register: OwnerRegisterReview) {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const response = await fetch(`/api/v1/cash-sessions/${register.id}/owner-close`, {
        cache: 'no-store',
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? 'Could not load register');
      setSelected(data as OwnerRegisterReview);
      setCounted('');
      setReason('');
      setCloseShifts(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load register');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  async function close() {
    if (!selected || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/v1/cash-sessions/${selected.id}/owner-close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          countedCash: Number(counted).toFixed(2),
          expectedCash: selected.expectedCash,
          reason,
          closeOpenShifts: closeShifts,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? 'Could not close register');
      setSuccess(
        `${selected.outletName}: register closed. Counted ${money(data.countedCash)}; difference ${money(data.variance)}. Staff can refresh billing and open a new register now, even today, by entering the opening cash. The previous register stays in closing history.`,
      );
      setSelected(null);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not close register. Check your connection.',
      );
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  }
  return (
    <>
      <div className="grid" style={{ marginBottom: 24 }}>
        <div className="card">
          <p className="muted">Open registers</p>
          <h2>{initial.length}</h2>
        </div>
        <div className="card">
          <p className="muted">Previous-day registers</p>
          <h2>{initial.filter((r) => r.overdue).length}</h2>
        </div>
        <div className="card">
          <p className="muted">Expected cash across open registers</p>
          <h2>{money(initial.reduce((sum, r) => sum + Number(r.expectedCash), 0))}</h2>
        </div>
      </div>
      {success && (
        <div className="card" role="status">
          {success}
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {selected ? (
        <section className="card" aria-labelledby="register-review-title">
          <div className="toolbar" style={{ justifyContent: 'space-between' }}>
            <div>
              <h2 id="register-review-title">{selected.outletName} · Closing review</h2>
              <p className="muted">
                Business date {selected.businessDate} · Opened by {selected.openedBy}
              </p>
            </div>
            <button className="secondary" disabled={busy} onClick={() => void review(selected)}>
              Refresh summary
            </button>
          </div>
          <div className="grid">
            {[
              ['Opening cash', selected.openingCash],
              ['Cash sales', selected.cashSales],
              ['Cash refunds', selected.cashRefunds],
              ['Drawer expenses', selected.drawerExpenses],
              ['Expected closing cash', selected.expectedCash],
            ].map(([label, value]) => (
              <div className="card" key={label}>
                <p className="muted">{label}</p>
                <strong>{money(value!)}</strong>
              </div>
            ))}
          </div>
          <form
            style={{ maxWidth: 620, marginTop: 24 }}
            onSubmit={(event) => {
              event.preventDefault();
              void close();
            }}
          >
            <label htmlFor="owner-counted">Verified cash at the outlet (₹)</label>
            <input
              id="owner-counted"
              type="number"
              min="0"
              step="0.01"
              required
              value={counted}
              disabled={busy}
              onChange={(e) => setCounted(e.target.value)}
            />
            <p className="muted">
              Enter the physical cash total confirmed by your outlet team. UPI is excluded.
            </p>
            {counted !== '' && Number.isFinite(Number(counted)) && (
              <p>
                <strong>
                  Cash difference: {money(Number(counted) - Number(selected.expectedCash))}
                </strong>
              </p>
            )}
            <label htmlFor="owner-close-reason">Closure note</label>
            <textarea
              id="owner-close-reason"
              required
              maxLength={500}
              value={reason}
              disabled={busy}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason for owner closure and explanation of any cash difference"
            />
            <p>
              <strong>Open shifts for this register’s business date and earlier:</strong>{' '}
              {selected.shifts.length
                ? selected.shifts.map((s) => `${s.name} (${s.businessDate})`).join(', ')
                : 'None'}
            </p>
            <label style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <input
                type="checkbox"
                style={{ width: 'auto' }}
                checked={closeShifts}
                disabled={busy}
                onChange={(e) => setCloseShifts(e.target.checked)}
              />
              End remaining shifts for this business date and earlier
            </label>
            <p className="muted">
              This records your owner authorization. Staff attendance stays unchanged. Ask the
              outlet to pause billing and sync pending offline sales before confirming.
            </p>
            {!closeShifts && selected.overdue && selected.shifts.length > 0 && (
              <p className="error">
                Previous-day shifts will still block billing until they are ended.
              </p>
            )}
            <p>
              The closing record is final. A new register can be opened immediately with a fresh
              opening cash amount.
            </p>
            <div className="toolbar">
              <button
                disabled={
                  busy ||
                  counted === '' ||
                  !Number.isFinite(Number(counted)) ||
                  Number(counted) < 0 ||
                  !reason.trim()
                }
              >
                {busy ? 'Closing…' : 'Authorize & close register'}
              </button>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => setSelected(null)}
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      ) : (
        <>
          {!initial.length && (
            <div className="card">
              <h2>No open registers</h2>
              <p>
                Staff can open a new register from billing at any time, including after a closure on
                the same day.
              </p>
            </div>
          )}
          <div className="grid">
            {initial.map((register) => (
              <section className="card" key={register.id}>
                <span className="pill">
                  {register.overdue ? 'Previous day · action needed' : 'Open'}
                </span>
                <h2 style={{ marginTop: 16 }}>{register.outletName}</h2>
                <p className="muted">
                  {register.businessDate} · Opened by {register.openedBy}
                </p>
                <p>
                  Expected cash <strong>{money(register.expectedCash)}</strong>
                </p>
                <p>{register.shifts.length} open shift(s)</p>
                <button disabled={busy} onClick={() => void review(register)}>
                  Review & close register
                </button>
              </section>
            ))}
          </div>
        </>
      )}
    </>
  );
}
