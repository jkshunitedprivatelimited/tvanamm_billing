'use client';
import { useCallback, useEffect, useState } from 'react';
import type { ExpenseView, ExpenseReport } from '@jksh/contracts';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoIso(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}
const PAYMENT_SOURCE_LABEL: Record<string, string> = {
  shared_cash_drawer: 'Cash drawer',
  outlet_upi: 'Outlet UPI',
  owner_paid: 'Owner paid',
  employee_paid: 'Employee paid',
};

export function ExpensePanel({ outletId, role }: { outletId: string; role: string }) {
  const canOversee = role === 'franchise_owner' || role === 'central_admin';
  const [from, setFrom] = useState(daysAgoIso(29));
  const [to, setTo] = useState(todayIso());
  const [report, setReport] = useState<ExpenseReport | null>(null);
  const [expenses, setExpenses] = useState<ExpenseView[]>([]);
  const [threshold, setThreshold] = useState<{ threshold: string; isOverride: boolean } | null>(
    null,
  );
  const [newThreshold, setNewThreshold] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reversing, setReversing] = useState<string | null>(null);
  const [reverseReason, setReverseReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [reportRes, listRes, thresholdRes] = await Promise.all([
        fetch(`/api/v1/outlets/${outletId}/expense-report?from=${from}&to=${to}`),
        fetch(`/api/v1/outlets/${outletId}/expenses`),
        fetch(`/api/v1/outlets/${outletId}/expense-threshold`),
      ]);
      const reportBody = (await reportRes.json()) as ExpenseReport & { message?: string };
      const listBody = (await listRes.json()) as { expenses?: ExpenseView[]; message?: string };
      const thresholdBody = (await thresholdRes.json()) as {
        threshold?: string;
        isOverride?: boolean;
        message?: string;
      };
      if (!reportRes.ok || !listRes.ok) {
        setErr(reportBody.message ?? listBody.message ?? 'Could not load expenses.');
        return;
      }
      setReport(reportBody);
      setExpenses(listBody.expenses ?? []);
      if (thresholdRes.ok && thresholdBody.threshold) {
        setThreshold({
          threshold: thresholdBody.threshold,
          isOverride: thresholdBody.isOverride ?? false,
        });
      }
    } catch {
      setErr('Could not load expenses.');
    } finally {
      setLoading(false);
    }
  }, [outletId, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  async function review(id: string, action: 'approve' | 'reverse', reason?: string) {
    setBusyId(id);
    setErr(null);
    try {
      const res = await fetch(`/api/v1/expenses/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...(reason ? { reason } : {}) }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        setErr(body.message ?? 'Could not review this expense.');
        return;
      }
      setReversing(null);
      setReverseReason('');
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function saveThreshold(e: React.FormEvent) {
    e.preventDefault();
    if (!newThreshold.trim()) return;
    setErr(null);
    const res = await fetch('/api/v1/expense-threshold', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outletId, threshold: newThreshold.trim() }),
    });
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    if (!res.ok) {
      setErr(body.message ?? 'Could not set threshold.');
      return;
    }
    setNewThreshold('');
    await load();
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <strong>Expenses</strong>
        <div className="row" style={{ gap: 8 }}>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            style={{ margin: 0 }}
          />
          <span className="muted">to</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            style={{ margin: 0 }}
          />
        </div>
      </div>

      {err ? <p className="error">{err}</p> : null}
      {loading ? <p className="muted">Loading…</p> : null}

      {report ? (
        <div
          className="grid"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', margin: '12px 0' }}
        >
          <div className="stat">
            <div className="label">Total</div>
            <div className="value">₹{report.total}</div>
          </div>
          <div className="stat">
            <div className="label">From cash drawer</div>
            <div className="value">₹{report.drawerTotal}</div>
          </div>
          <div className="stat">
            <div className="label">Awaiting review</div>
            <div className="value">{report.unreviewedCount}</div>
          </div>
        </div>
      ) : null}

      {report && report.byCategory.length > 0 ? (
        <p className="muted" style={{ fontSize: 13 }}>
          By category: {report.byCategory.map((c) => `${c.categoryName} ₹${c.total}`).join(' · ')}
        </p>
      ) : null}

      {canOversee ? (
        <form
          onSubmit={saveThreshold}
          className="row"
          style={{ gap: 8, alignItems: 'end', margin: '12px 0' }}
        >
          <label>
            <div className="muted" style={{ fontSize: 12 }}>
              High-value alert threshold
              {threshold
                ? ` (currently ₹${threshold.threshold}${threshold.isOverride ? '' : ', org default'})`
                : ''}
            </div>
            <input
              inputMode="decimal"
              value={newThreshold}
              onChange={(e) => setNewThreshold(e.target.value)}
              placeholder={threshold?.threshold ?? '5000'}
              style={{ width: 140, margin: 0 }}
            />
          </label>
          <button type="submit" className="secondary sm">
            Save
          </button>
        </form>
      ) : null}

      <div style={{ marginTop: 8 }}>
        {expenses.length === 0 && !loading ? (
          <p className="muted">No expenses recorded in this range.</p>
        ) : null}
        {expenses.map((e) => (
          <div
            key={e.id}
            className="cart-line"
            style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}
          >
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span>
                <strong>{e.categoryName}</strong>{' '}
                <span className="muted" style={{ fontSize: 12 }}>
                  · {PAYMENT_SOURCE_LABEL[e.paymentSource] ?? e.paymentSource} · {e.businessDate}
                  {e.recordedByName ? ` · ${e.recordedByName}` : ''}
                </span>
              </span>
              <span style={{ fontWeight: 600 }}>₹{e.amount}</span>
            </div>
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>
              {e.reason}
            </p>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {e.isHighValue ? <span className="pill warn">High value</span> : null}
              {e.reversedAt ? (
                <span className="pill danger">
                  Reversed{e.reversalReason ? `: ${e.reversalReason}` : ''}
                </span>
              ) : e.reviewedAt ? (
                <span className="pill ok">Reviewed</span>
              ) : (
                <span className="pill pending">Awaiting review</span>
              )}
              {canOversee && !e.reversedAt && !e.reviewedAt ? (
                <button
                  type="button"
                  className="secondary sm"
                  disabled={busyId === e.id}
                  onClick={() => void review(e.id, 'approve')}
                >
                  Approve
                </button>
              ) : null}
              {canOversee && !e.reversedAt ? (
                reversing === e.id ? (
                  <>
                    <input
                      value={reverseReason}
                      onChange={(ev) => setReverseReason(ev.target.value)}
                      placeholder="Reason for reversal"
                      style={{ width: 200, margin: 0 }}
                    />
                    <button
                      type="button"
                      className="danger sm"
                      disabled={busyId === e.id || !reverseReason.trim()}
                      onClick={() => void review(e.id, 'reverse', reverseReason.trim())}
                    >
                      Confirm reversal
                    </button>
                    <button type="button" className="ghost sm" onClick={() => setReversing(null)}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <button type="button" className="ghost sm" onClick={() => setReversing(e.id)}>
                    Reverse
                  </button>
                )
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
