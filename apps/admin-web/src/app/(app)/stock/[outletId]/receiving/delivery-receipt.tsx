'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PendingDelivery } from '@jksh/stock';
import { apiPost } from '../../ops/api';

export function DeliveryReceipt({
  delivery,
  outletId,
}: {
  delivery: PendingDelivery;
  outletId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [message, setMessage] = useState('');
  const reference = useRef<string | null>(null);
  async function receive(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || done) return;
    const data = new FormData(event.currentTarget);
    const quantity = (key: string) => {
      const v = data.get(key);
      return typeof v === 'string' && v !== '' ? v : '0';
    };
    const lines = delivery.lines.map((l) => ({
      stockDispatchLineId: l.id,
      acceptedQtyBase: quantity(`${l.id}-accepted`),
      damagedQtyBase: quantity(`${l.id}-damaged`),
      shortQtyBase: quantity(`${l.id}-short`),
    }));
    const invalid = lines.some((line, i) => {
      const amounts = [line.acceptedQtyBase, line.damagedQtyBase, line.shortQtyBase];
      return (
        amounts.some((v) => !/^\d+(\.\d{1,6})?$/.test(v)) ||
        Math.abs(
          amounts.reduce((sum, v) => sum + Number(v), 0) - Number(delivery.lines[i]?.remaining),
        ) > 0.000001
      );
    });
    if (invalid) {
      setMessage('For each item, accepted + damaged + missing must equal the delivery quantity.');
      return;
    }
    reference.current ??= `IN-${crypto.randomUUID()}`;
    setBusy(true);
    const result = await apiPost('/api/v1/stock/outlet-inwards', {
      outletId,
      stockOrderId: delivery.orderId,
      stockDispatchId: delivery.id,
      franchiseId: delivery.franchiseId,
      inwardNumber: reference.current,
      lines,
    });
    setBusy(false);
    if (result.ok) {
      setDone(true);
      setMessage('Delivery recorded. Stock and delivery differences have been updated.');
      router.refresh();
    } else setMessage(result.error);
  }
  return (
    <details className="card">
      <summary>
        <strong>{delivery.dispatchNumber}</strong> · Order {delivery.orderNumber} ·{' '}
        {delivery.lines.length} supplies
      </summary>
      <p className="muted">
        Count the delivery first. Enter what is usable, damaged or missing in the units shown.
        Confirm only after checking every item.
      </p>
      <form onSubmit={receive}>
        <fieldset disabled={busy || done}>
          {delivery.lines.map((line) => (
            <div className="delivery-receipt-line" key={line.id}>
              <div>
                <strong>{line.name}</strong>
                <p className="muted">
                  Expected: {Number(line.remaining)} {line.baseUnit}
                </p>
              </div>
              {(['accepted', 'damaged', 'short'] as const).map((kind) => (
                <label key={kind}>
                  {kind === 'short' ? 'Missing' : kind === 'accepted' ? 'Accepted' : 'Damaged'} (
                  {line.baseUnit})
                  <input
                    required
                    name={`${line.id}-${kind}`}
                    type="number"
                    min="0"
                    max={line.remaining}
                    step="0.000001"
                    inputMode="decimal"
                    defaultValue={kind === 'accepted' ? '' : '0'}
                  />
                </label>
              ))}
            </div>
          ))}
          <button type="submit">
            {busy ? 'Recording…' : done ? 'Delivery recorded' : 'Confirm received quantities'}
          </button>
        </fieldset>
      </form>
      {message ? <p role="status">{message}</p> : null}
    </details>
  );
}
