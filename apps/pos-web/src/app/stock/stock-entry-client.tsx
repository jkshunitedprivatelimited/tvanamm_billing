'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ExpensesClient } from '../expenses/expenses-client';
import type { ExpenseView } from '@jksh/contracts';
import type { EmployeeStockEntry } from '@jksh/stock';
interface Item {
  id: string;
  name: string;
  baseUnit: string;
  supplyRule: string;
}
interface Entry {
  id: string;
  command: EmployeeStockEntry;
  result: Record<string, unknown> | null;
  created_at: string;
}
const reasons = [
  ['spoilage', 'Spoiled'],
  ['expiry', 'Expired'],
  ['breakage', 'Spilled or broken'],
  ['preparation_loss', 'Preparation loss'],
  ['other', 'Other'],
] as const;
export function StockEntryClient({
  items,
  entries,
  expenses = [],
}: {
  items: Item[];
  entries: Entry[];
  expenses?: ExpenseView[];
}) {
  const router = useRouter();
  const saving = useRef(false);
  const [kind, setKind] = useState<EmployeeStockEntry['kind']>('purchase');
  const [itemId, setItem] = useState('');
  const [expenseDraft, setExpenseDraft] = useState(false);
  const otherExpense = kind === 'purchase' && itemId === 'other-expense';
  const visibleEntries = entries.filter((e) => e.result && e.command.kind === kind);
  const availableItems = items.filter(
    (i) => kind !== 'purchase' || i.supplyRule !== 'jksh_required',
  );
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState<EmployeeStockEntry['unit']>('ml');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [wasteReason, setWasteReason] = useState<EmployeeStockEntry['wasteReason']>('spoilage');
  const [paymentSource, setPayment] =
    useState<NonNullable<EmployeeStockEntry['paymentSource']>>('employee_paid');
  const [attempt, setAttempt] = useState<EmployeeStockEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const item = items.find((i) => i.id === itemId);
  const pending = entries.filter((e) => !e.result);
  const units =
    item?.baseUnit === 'ml' || item?.baseUnit === 'l'
      ? ['ml', 'l']
      : item?.baseUnit === 'g' || item?.baseUnit === 'kg'
        ? ['g', 'kg']
        : ['each'];
  async function send(command: EmployeeStockEntry) {
    if (saving.current) return;
    saving.current = true;
    setAttempt(command);
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/v1/stock/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
      });
      const body = (await response.json()) as { message?: string };
      if (!response.ok)
        throw new Error(body.message ?? 'Could not finish saving. Retry this entry.');
      setAttempt(null);
      setQuantity('');
      setAmount('');
      setReason('');
      setMessage(
        command.kind === 'purchase'
          ? 'Purchase saved. Stock added and expense recorded.'
          : command.kind === 'wastage'
            ? 'Wastage saved. Stock updated.'
            : 'Count submitted for review. Stock changes after approval.',
      );
      router.refresh();
    } catch (e) {
      setMessage(
        `${e instanceof Error ? e.message : 'Connection interrupted.'} Retry the same entry; it will not be recorded twice.`,
      );
      router.refresh();
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <nav className="row wrap" style={{ gap: 10, marginBottom: 20 }}>
        {(['purchase', 'wastage', 'count'] as const).map((k) => (
          <button
            key={k}
            className={kind === k ? '' : 'ghost'}
            aria-pressed={kind === k}
            disabled={busy || !!attempt || expenseDraft}
            onClick={() => {
              setKind(k);
              setItem('');
              setQuantity('');
              setReason('');
              setAmount('');
              setMessage('');
            }}
          >
            {k === 'purchase'
              ? 'Purchases & expenses'
              : k === 'wastage'
                ? 'Record wastage'
                : 'Count stock'}
          </button>
        ))}
      </nav>
      {pending.length ? (
        <section className="card">
          <h2>Finish saving</h2>
          <p>
            These entries still need to finish saving. Retry them before adding another purchase.
          </p>
          {pending.map((e) => (
            <p key={e.id}>
              {items.find((i) => i.id === e.command.itemId)?.name ?? 'Stock item'} ·{' '}
              {e.command.quantity} {e.command.unit}{' '}
              <button disabled={busy} onClick={() => void send(e.command)}>
                Retry entry
              </button>
            </p>
          ))}
        </section>
      ) : null}
      <section className="card">
        <label htmlFor="entry-item">
          {kind === 'purchase' ? 'What are you recording?' : 'Stock item'}
        </label>
        <select
          id="entry-item"
          disabled={busy || !!attempt || expenseDraft || pending.length > 0}
          value={itemId}
          onChange={(e) => {
            setItem(e.target.value);
            setQuantity('');
            setAmount('');
            setReason('');
            setMessage('');
            const next = items.find((i) => i.id === e.target.value);
            setUnit(
              next?.baseUnit === 'ml'
                ? 'l'
                : next?.baseUnit === 'g'
                  ? 'kg'
                  : ((next?.baseUnit ?? 'each') as EmployeeStockEntry['unit']),
            );
          }}
        >
          <option value="">
            {kind === 'purchase' ? 'Choose a purchase or expense' : 'Choose a stock item'}
          </option>
          {availableItems.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
          {kind === 'purchase' ? (
            <option value="other-expense">Other expense — transport, cleaning, repairs…</option>
          ) : null}
        </select>
        <p>
          {kind === 'purchase'
            ? 'Milk and sugar purchases update stock and expenses together. For other spending, choose Other expense and enter any category.'
            : kind === 'wastage'
              ? 'Record only the quantity that was lost.'
              : 'Enter the quantity you physically have.'}
        </p>
      </section>
      {otherExpense ? (
        <ExpensesClient
          embedded
          onDraftChange={setExpenseDraft}
          onSaved={() => router.refresh()}
          onCancel={() => {
            setExpenseDraft(false);
            setItem('');
          }}
        />
      ) : item ? (
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy)
              void send(
                attempt ?? {
                  id: crypto.randomUUID(),
                  kind,
                  itemId,
                  quantity,
                  unit,
                  reason,
                  ...(kind === 'purchase'
                    ? { amount: Number(amount).toFixed(2), paymentSource }
                    : {}),
                  ...(kind === 'wastage' ? { wasteReason } : {}),
                },
              );
          }}
        >
          <h2>
            {kind === 'purchase'
              ? `Record ${item.name} purchase`
              : kind === 'wastage'
                ? 'Record wasted stock'
                : 'Enter a physical count'}
          </h2>
          <p>
            {kind === 'purchase'
              ? 'Enter the quantity received and total amount paid. No separate expense entry is needed.'
              : kind === 'wastage'
                ? 'Enter only the quantity lost. Don’t record the same loss twice.'
                : 'Count what is physically left. This sends the difference for review.'}
          </p>
          <fieldset
            disabled={busy || !!attempt || pending.length > 0}
            style={{ border: 0, padding: 0, display: 'grid', gap: 14 }}
          >
            <div className="row" style={{ gap: 12 }}>
              <label>
                Quantity
                <input
                  required
                  type="number"
                  step="0.000001"
                  min={kind === 'count' ? 0 : 0.000001}
                  max="99999999"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </label>
              <label>
                Unit
                <select
                  value={unit}
                  onChange={(e) => setUnit(e.target.value as EmployeeStockEntry['unit'])}
                >
                  {units.map((u) => (
                    <option key={u} value={u}>
                      {u === 'l'
                        ? 'Litres'
                        : u === 'kg'
                          ? 'Kilograms'
                          : u === 'ml'
                            ? 'Millilitres'
                            : u === 'g'
                              ? 'Grams'
                              : 'Pieces'}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {kind === 'purchase' ? (
              <>
                <label>
                  Total paid (₹)
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    max="99999999"
                    required
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </label>
                <label>
                  Paid from
                  <select
                    value={paymentSource}
                    onChange={(e) => setPayment(e.target.value as typeof paymentSource)}
                  >
                    <option value="employee_paid">My money — reimbursement due</option>
                    <option value="shared_cash_drawer">Cash drawer</option>
                    <option value="outlet_upi">Outlet UPI</option>
                    <option value="owner_paid">Owner paid</option>
                  </select>
                </label>
              </>
            ) : null}
            {kind === 'wastage' ? (
              <label>
                Reason
                <select
                  value={wasteReason}
                  onChange={(e) => setWasteReason(e.target.value as typeof wasteReason)}
                >
                  {reasons.map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label>
              {kind === 'purchase' ? 'Purchase note' : 'Details'}
              <input
                required
                maxLength={400}
                value={reason}
                placeholder={
                  kind === 'purchase'
                    ? 'Where you bought it or why it was needed'
                    : 'Describe what happened'
                }
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
          </fieldset>
          <button
            style={{ marginTop: 18 }}
            disabled={busy || (!attempt && pending.length > 0) || !items.length}
          >
            {busy
              ? 'Saving…'
              : attempt
                ? 'Retry saving'
                : kind === 'purchase'
                  ? 'Save purchase & expense'
                  : kind === 'wastage'
                    ? 'Save wastage'
                    : 'Submit count'}
          </button>
        </form>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
      {!items.length ? <p>No stock items are available yet. Billing is still available.</p> : null}
      <section className="card">
        <h2>
          {kind === 'purchase'
            ? 'Your expenses this shift'
            : kind === 'wastage'
              ? 'Your recent wastage'
              : 'Your recent counts'}
        </h2>
        {kind === 'purchase'
          ? expenses.map((e) => (
              <p key={e.id}>
                <strong>{e.categoryName}</strong> · ₹{e.amount}
                {e.reversedAt ? ' · Reversed' : ''}
                <br />
                <small>
                  {e.reason} · {new Date(e.createdAt).toLocaleString()}
                </small>
              </p>
            ))
          : null}
        {(kind === 'purchase' ? expenses.length === 0 : visibleEntries.length === 0) ? (
          <p className="muted">No entries in this section yet.</p>
        ) : null}
        {entries
          .filter((e) => e.result && e.command.kind === kind && kind !== 'purchase')
          .map((e) => (
            <p key={e.id}>
              <strong>
                {typeof e.result?.itemName === 'string' ? e.result.itemName : 'Stock item'}
              </strong>{' '}
              · {e.command.quantity} {e.command.unit} ·{' '}
              {e.command.kind === 'purchase'
                ? `₹${e.command.amount ?? ''} · Purchase`
                : e.command.kind === 'count'
                  ? 'Count submitted'
                  : 'Wastage'}
              <br />
              <small>
                {e.command.reason} · {new Date(e.created_at).toLocaleString()}
              </small>
            </p>
          ))}
      </section>
    </>
  );
}
