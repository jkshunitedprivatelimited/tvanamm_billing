'use client';
import { useRef, useState } from 'react';
import type { ShipmentPreparationDetails } from '@jksh/stock';

interface Draft {
  revision: number;
  details: ShipmentPreparationDetails;
  missing: string[];
}
const empty: ShipmentPreparationDetails = {
  paymentMethod: 'prepaid',
  pickupLocation: '',
  recipientName: '',
  recipientPhone: '',
  address: '',
  city: '',
  state: '',
  pincode: '',
  weightKg: null,
  lengthCm: null,
  widthCm: null,
  heightCm: null,
  carrierAcceptanceConfirmed: false,
};

export function ShippingPreparation({
  orderId,
  warehouseId,
  initial,
}: {
  orderId: string;
  warehouseId: string;
  initial: Draft | null;
}) {
  const [details, setDetails] = useState(initial?.details ?? empty);
  const [revision, setRevision] = useState(initial?.revision ?? 0);
  const [missing, setMissing] = useState(initial?.missing ?? []);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`/api/v1/stock/orders/${orderId}/shipment-preparation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ warehouseId, expectedRevision: revision, details }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { message?: string };
        throw new Error(body.message ?? 'Could not save shipment preparation.');
      }
      const draft = (await response.json()) as Draft;
      setRevision(draft.revision);
      setMissing(draft.missing);
      setMessage(
        draft.missing.length
          ? 'Draft saved. Complete the missing details below before booking.'
          : 'Preparation saved. Courier booking is not enabled yet.',
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Save not confirmed. Retry the same details.',
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <form onSubmit={(e) => void save(e)} className="card">
      <p>
        <strong>Payment: prepaid only.</strong> Full captured payment is checked when saving. COD is
        unavailable.
      </p>
      <fieldset disabled={busy}>
        <legend>Pickup and delivery</legend>
        <div className="grid">
          {(
            [
              ['pickupLocation', 'Registered pickup location name'],
              ['recipientName', 'Receiver name'],
              ['recipientPhone', 'Receiver phone'],
              ['address', 'Full delivery address'],
              ['city', 'City'],
              ['state', 'State'],
              ['pincode', 'PIN code'],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                value={details[key]}
                maxLength={
                  key === 'address'
                    ? 500
                    : key === 'pincode'
                      ? 6
                      : key === 'recipientPhone'
                        ? 20
                        : 100
                }
                onChange={(e) => setDetails({ ...details, [key]: e.target.value })}
              />
            </label>
          ))}
        </div>
        <p>Enter measurements after packing. Leave unknown values blank; do not estimate.</p>
        <div className="grid">
          {(
            [
              ['weightKg', 'Packed weight (kg)'],
              ['lengthCm', 'Length (cm)'],
              ['widthCm', 'Width (cm)'],
              ['heightCm', 'Height (cm)'],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                type="number"
                min="0.001"
                max="1000"
                step="0.001"
                value={details[key] ?? ''}
                onChange={(e) =>
                  setDetails({
                    ...details,
                    [key]: e.target.value === '' ? null : Number(e.target.value),
                  })
                }
              />
            </label>
          ))}
        </div>
        <label>
          <input
            type="checkbox"
            checked={details.carrierAcceptanceConfirmed}
            onChange={(e) =>
              setDetails({ ...details, carrierAcceptanceConfirmed: e.target.checked })
            }
          />{' '}
          Carrier acceptance has been confirmed for the actual contents and packaging.
        </label>
        <button type="submit">{busy ? 'Saving…' : 'Save preparation'}</button>
      </fieldset>
      {message ? <p role="status">{message}</p> : null}
      {missing.length ? (
        <div>
          <h2>Missing from the saved preparation</h2>
          <ul>
            {missing.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <p>
        Saving does not increase outlet stock. The outlet must inspect and accept delivered
        quantities.
      </p>
    </form>
  );
}
