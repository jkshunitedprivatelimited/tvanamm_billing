'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CashSessionSummary } from '@jksh/contracts';

export function CloseRegister({
  cashSession,
  myShiftId,
}: {
  cashSession: CashSessionSummary | null;
  myShiftId: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [countedCash, setCountedCash] = useState('');
  const [varianceReason, setVarianceReason] = useState('');
  const [result, setResult] = useState<{ expectedCash: string; variance: string } | null>(null);

  async function endMyShift() {
    if (!myShiftId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/shifts/${myShiftId}/end`, { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        setError(body.message ?? 'Could not end shift.');
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function closeCash() {
    if (!cashSession) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/cash-sessions/${cashSession.id}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          countedCash: Number(countedCash).toFixed(2),
          ...(varianceReason ? { varianceReason } : {}),
        }),
      });
      const body = (await res.json()) as {
        expectedCash?: string;
        variance?: string;
        message?: string;
      };
      if (!res.ok || body.expectedCash === undefined) {
        setError(body.message ?? 'Could not close the cash session.');
        return;
      }
      setResult({ expectedCash: body.expectedCash, variance: body.variance ?? '0.00' });
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div>
        <h1 style={{ fontSize: 16 }}>Cash session closed</h1>
        <p>Expected: ₹{result.expectedCash}</p>
        <p>Counted: ₹{Number(countedCash).toFixed(2)}</p>
        <p>Variance: ₹{result.variance}</p>
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ fontSize: 16 }}>End of day</h1>
      {myShiftId ? (
        <>
          <p className="muted">End your own shift when you finish for the day.</p>
          <button disabled={busy} onClick={() => void endMyShift()}>
            End my shift
          </button>
        </>
      ) : (
        <p className="muted">Your shift is already ended.</p>
      )}
      {cashSession ? (
        <div style={{ marginTop: 20 }}>
          <p className="muted">
            Any authorized employee may close the shared Cash session for the whole outlet.
          </p>
          <label htmlFor="counted-cash">Counted Cash</label>
          <input
            id="counted-cash"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={countedCash}
            onChange={(e) => setCountedCash(e.target.value)}
          />
          <label htmlFor="variance-reason">Variance reason (if any)</label>
          <input
            id="variance-reason"
            value={varianceReason}
            onChange={(e) => setVarianceReason(e.target.value)}
          />
          <button disabled={busy || !countedCash} onClick={() => void closeCash()}>
            Close Cash session
          </button>
        </div>
      ) : (
        <p className="muted" style={{ marginTop: 20 }}>
          The Cash session is already closed.
        </p>
      )}
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
