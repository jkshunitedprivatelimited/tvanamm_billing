'use client';

import { useState } from 'react';
import type { CashSessionSummary, ExpenseView } from '@jksh/contracts';
import { useRouter } from 'next/navigation';
import { ExpensesClient } from '../expenses/expenses-client';
import { clearOfflineKit, listOutboxBills } from '@/lib/offline-store';

export function CloseRegister({
  cashSession,
  expenses,
}: {
  cashSession: CashSessionSummary | null;
  expenses: ExpenseView[];
}) {
  const router = useRouter();
  const [reviewed, setReviewed] = useState(false);
  const [addingExpense, setAddingExpense] = useState(false);
  const [expensePending, setExpensePending] = useState(false);
  const [closing, setClosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [countedCash, setCountedCash] = useState('');
  const [varianceReason, setVarianceReason] = useState('');
  const [result, setResult] = useState<{ cashSession: CashSessionSummary | null } | null>(null);

  async function finish(closeStore: boolean) {
    if (!reviewed || expensePending || addingExpense) return;
    setBusy(true);
    setError('');
    try {
      const pending = (await listOutboxBills()).filter((b) => b.status !== 'synced');
      if (pending.length)
        throw new Error(
          `${String(pending.length)} offline sale(s) still need to sync. Reconnect and try again.`,
        );
      const res = await fetch('/api/v1/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          closeStore && cashSession
            ? {
                action: 'close-store',
                expensesReviewed: true,
                sessionId: cashSession.id,
                cash: {
                  countedCash: Number(countedCash).toFixed(2),
                  ...(varianceReason.trim() ? { varianceReason: varianceReason.trim() } : {}),
                },
              }
            : { action: 'finish-work', expensesReviewed: true },
        ),
      });
      const body = (await res.json()) as {
        cashSession: CashSessionSummary | null;
        message?: string;
      };
      if (!res.ok) throw new Error(body.message ?? 'Could not finish. Please try again.');
      setResult(body);
      await clearOfflineKit().catch(() => undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connect to the internet and try again.');
    } finally {
      setBusy(false);
    }
  }
  if (result)
    return (
      <div>
        <h2>{result.cashSession ? 'Store closed' : 'Your work is finished'}</h2>
        <p>Your shift is ended, any open attendance is checked out, and you are signed out.</p>
        {result.cashSession ? (
          <>
            <p>Counted cash: ₹{result.cashSession.countedCash}</p>
            <p>
              Expected cash: ₹{result.cashSession.expectedCash} · Difference: ₹
              {result.cashSession.variance}
            </p>
          </>
        ) : (
          <p>The register stays available for your colleagues.</p>
        )}
        <a className="link-btn" href="/login">
          Go to sign in
        </a>
      </div>
    );
  return (
    <div>
      <h2>Finish</h2>
      <section aria-labelledby="expense-review" style={{ marginBottom: 24 }}>
        <h3 id="expense-review">Expenses during your shift</h3>
        <p>
          Record anything you paid for before finishing. Include the amount, payment source and
          reason.
        </p>
        {expenses.length ? (
          <ul>
            {expenses.map((expense) => (
              <li key={expense.id}>
                <strong>
                  {expense.categoryName} · ₹{expense.amount}
                </strong>{' '}
                — {expense.reason}
                {expense.reversedAt
                  ? ' (reversed)'
                  : expense.affectsDrawer
                    ? ' · Paid from cash drawer'
                    : ' · Paid outside cash drawer'}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No expenses recorded during this shift.</p>
        )}
        {addingExpense ? (
          <>
            <ExpensesClient
              onCancel={() => {
                setAddingExpense(false);
                setExpensePending(false);
              }}
              onDraftChange={setExpensePending}
              onSaved={() => {
                setAddingExpense(false);
                setReviewed(false);
                router.refresh();
              }}
            />
          </>
        ) : (
          <button
            className="ghost"
            disabled={busy}
            onClick={() => {
              setAddingExpense(true);
              setReviewed(false);
            }}
          >
            Add expense
          </button>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16 }}>
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={reviewed}
            disabled={busy || addingExpense || expensePending}
            onChange={(event) => setReviewed(event.target.checked)}
          />
          {expenses.some((expense) => !expense.reversedAt)
            ? 'All my expenses are recorded. Nothing else to add.'
            : 'I had no expenses to record during this shift.'}
        </label>
      </section>
      {!closing ? (
        <div style={{ display: 'grid', gap: 16 }}>
          <div>
            <button
              disabled={busy || !reviewed || addingExpense || expensePending}
              onClick={() => void finish(false)}
            >
              Finish my work
            </button>
            <p className="muted">
              Check out, end my shift and sign out. Leave the register open for colleagues.
            </p>
          </div>
          {cashSession ? (
            <div>
              <button className="ghost" disabled={busy} onClick={() => setClosing(true)}>
                Close store
              </button>
              <p className="muted">
                Count closing cash, close the register and finish my work. Other employees record
                their own attendance.
              </p>
            </div>
          ) : null}
        </div>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void finish(true);
          }}
        >
          <p>
            Count the cash after the final sale. This closes the shared register and finishes your
            work.
          </p>
          <label htmlFor="counted-cash">Cash in the drawer (₹)</label>
          <input
            id="counted-cash"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            required
            value={countedCash}
            onChange={(event) => setCountedCash(event.target.value)}
          />
          <label htmlFor="variance-reason">Reason if the cash differs</label>
          <input
            id="variance-reason"
            value={varianceReason}
            onChange={(event) => setVarianceReason(event.target.value)}
          />
          <button
            disabled={
              busy ||
              !reviewed ||
              addingExpense ||
              expensePending ||
              countedCash === '' ||
              !Number.isFinite(Number(countedCash)) ||
              Number(countedCash) < 0
            }
          >
            {busy ? 'Finishing…' : 'Confirm & close store'}
          </button>
          <button type="button" className="ghost" disabled={busy} onClick={() => setClosing(false)}>
            Back
          </button>
        </form>
      )}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
