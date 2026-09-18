'use client';
import { useRef, useState } from 'react';

const QUICK_CATEGORIES = ['Milk', 'Sugar', 'Gas', 'Ice', 'Maintenance', 'Transport', 'Cleaning'];
const PAYMENT_SOURCES: { value: string; label: string }[] = [
  { value: 'shared_cash_drawer', label: 'Cash drawer' },
  { value: 'outlet_upi', label: 'Outlet UPI' },
  { value: 'owner_paid', label: 'Owner paid' },
  { value: 'employee_paid', label: 'Employee paid (reimburse)' },
];

export function ExpensesClient({
  embedded = false,
  onSaved,
  onDraftChange,
  onCancel,
}: {
  embedded?: boolean;
  onCancel?: () => void;
  onSaved?: () => void;
  onDraftChange?: (pending: boolean) => void;
} = {}) {
  const attemptKey = useRef<string | null>(null);
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [paymentSource, setPaymentSource] = useState('shared_cash_drawer');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const canSubmit =
    category.trim() &&
    /^\d+(\.\d{1,2})?$/.test(amount.trim()) &&
    Number.isFinite(Number(amount)) &&
    Number(amount) > 0 &&
    reason.trim();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    onDraftChange?.(true);
    setBusy(true);
    attemptKey.current ??= crypto.randomUUID();
    setMsg(null);
    try {
      const res = await fetch('/api/v1/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotencyKey: attemptKey.current,
          categoryName: category.trim(),
          amount: Number(amount).toFixed(2),
          paymentSource,
          reason: reason.trim(),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        if (res.status < 500) attemptKey.current = null;
        setMsg({ kind: 'error', text: body.message ?? 'Could not record this expense.' });
        return;
      }
      const sourceLabel =
        PAYMENT_SOURCES.find((p) => p.value === paymentSource)?.label ?? paymentSource;
      setMsg({
        kind: 'ok',
        text:
          paymentSource === 'shared_cash_drawer'
            ? `Recorded — ₹${amount} taken from the cash drawer.`
            : `Recorded — ₹${amount} (${sourceLabel}).`,
      });
      attemptKey.current = null;
      onDraftChange?.(false);
      onSaved?.();
      setCategory('');
      setAmount('');
      setReason('');
    } catch {
      setMsg({
        kind: 'error',
        text: 'Could not confirm the expense was saved. Reconnect and retry this expense.',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="card"
      onChange={() => onDraftChange?.(true)}
      onSubmit={submit}
      style={{ maxWidth: embedded ? undefined : 420 }}
    >
      {embedded ? (
        <>
          <h2>Record an expense</h2>
          <p>
            Enter any expense category, amount and reason. This records spending without changing
            stock.
          </p>
        </>
      ) : null}
      <label>
        <div className="muted" style={{ fontSize: 12 }}>
          What was it for?
        </div>
        <input
          disabled={busy || attemptKey.current !== null}
          maxLength={120}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder={embedded ? 'e.g. Delivery charge, cleaning supplies, repairs' : 'e.g. Milk'}
          required
        />
      </label>
      <div className="row wrap" style={{ gap: 6, margin: '-8px 0 12px' }}>
        {QUICK_CATEGORIES.filter((c) => !embedded || !['Milk', 'Sugar', 'Ice'].includes(c)).map(
          (c) => (
            <button
              key={c}
              type="button"
              disabled={busy || attemptKey.current !== null}
              className={`cat-tab${category === c ? ' active' : ''}`}
              onClick={() => {
                setCategory(c);
                onDraftChange?.(true);
              }}
            >
              {c}
            </button>
          ),
        )}
      </div>

      <label>
        <div className="muted" style={{ fontSize: 12 }}>
          Amount ₹
        </div>
        <input
          inputMode="decimal"
          disabled={busy || attemptKey.current !== null}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          required
        />
      </label>

      <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
        Paid from
      </div>
      <div className="row wrap" style={{ gap: 6, marginBottom: 12 }}>
        {PAYMENT_SOURCES.map((p) => (
          <button
            key={p.value}
            type="button"
            disabled={busy || attemptKey.current !== null}
            className={`cat-tab${paymentSource === p.value ? ' active' : ''}`}
            onClick={() => {
              setPaymentSource(p.value);
              onDraftChange?.(true);
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      <label>
        <div className="muted" style={{ fontSize: 12 }}>
          Note (required — what happened)
        </div>
        <input
          disabled={busy || attemptKey.current !== null}
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={
            embedded ? 'What was purchased or paid for?' : 'e.g. 2L milk for the morning batch'
          }
          required
        />
      </label>

      {msg ? <p className={msg.kind}>{msg.text}</p> : null}

      <button disabled={busy || !canSubmit}>{busy ? 'Recording…' : 'Record expense'}</button>
      {onCancel ? (
        <button
          type="button"
          className="ghost"
          disabled={busy || attemptKey.current !== null}
          onClick={onCancel}
        >
          Discard unsaved expense
        </button>
      ) : null}
      <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
        {paymentSource === 'shared_cash_drawer'
          ? 'This reduces the expected cash total when the register is closed.'
          : "This doesn't touch the cash drawer."}{' '}
        The owner reviews every expense.
      </p>
    </form>
  );
}
