'use client';
import { useRef, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { TransferWorkspace, WarehouseWork } from '@jksh/stock';
import { apiPost } from '../api';
interface Option {
  id: string;
  name: string;
}
interface Warehouse extends Option {
  locations: { id: string; kind: string }[];
}
function ActionForm({
  url,
  title,
  children,
  build,
  warning,
}: {
  url: string;
  title: string;
  children?: ReactNode;
  build: (data: FormData) => unknown;
  warning: string;
}) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const [review, setReview] = useState<{ body: unknown; summary: string[] } | null>(null);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const busy = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  async function confirm() {
    if (!review || busy.current) return;
    busy.current = true;
    setSaving(true);
    setMessage('');
    try {
      const r = await apiPost(url, review.body);
      if (r.ok) {
        setReview(null);
        setUncertain(false);
        form.current?.reset();
        setMessage('Saved.');
        startTransition(() => router.refresh());
      } else {
        setMessage(r.error);
        setUncertain(r.uncertain === true);
      }
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }
  return (
    <form
      ref={form}
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        const element = e.currentTarget;
        const summary = Array.from(element.elements).flatMap((control) => {
          if (control instanceof HTMLInputElement && control.name && control.value)
            return [`${control.getAttribute('aria-label') ?? control.name}: ${control.value}`];
          if (control instanceof HTMLSelectElement && control.name)
            return [
              `${control.getAttribute('aria-label') ?? control.name}: ${control.selectedOptions[0]?.textContent ?? ''}`,
            ];
          return [];
        });
        setReview({ body: build(new FormData(element)), summary });
      }}
    >
      <h3>{title}</h3>
      <p>{warning}</p>
      <fieldset disabled={saving || refreshing || !!review}>
        <legend>Details</legend>
        {children}
        <button type="submit">Review</button>
      </fieldset>
      {review ? (
        <section aria-label="Review operation">
          <h4>Confirm {title.toLowerCase()}</h4>
          <ul>
            {review.summary.map((text, i) => (
              <li key={i}>{text}</li>
            ))}
          </ul>
          <button type="button" disabled={saving || refreshing} onClick={() => void confirm()}>
            {saving ? 'Saving…' : uncertain ? 'Retry same request' : 'Confirm'}
          </button>{' '}
          <button type="button" disabled={saving || uncertain} onClick={() => setReview(null)}>
            Edit / cancel
          </button>
          {uncertain ? (
            <p>
              Save is not confirmed. Retry this same request, or reload to inspect the latest record
              before making another change.
            </p>
          ) : null}
        </section>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
    </form>
  );
}
const value = (data: FormData, key: string) => {
  const result = data.get(key);
  return typeof result === 'string' ? result : '';
};
function Select({ name, label, options }: { name: string; label: string; options: Option[] }) {
  return (
    <label>
      {label}
      <select name={name} aria-label={label} required defaultValue="">
        <option value="">Choose…</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}
function Quantity({ name, label, zero = false }: { name: string; label: string; zero?: boolean }) {
  return (
    <label>
      {label}
      <input
        name={name}
        aria-label={label}
        type="number"
        required
        min={zero ? '0' : '0.000001'}
        step="0.000001"
        defaultValue={zero ? '0' : undefined}
      />
    </label>
  );
}

export function WarehouseWorkClient({
  work,
  stock,
  warehouses,
  items,
  suppliers,
}: {
  work: WarehouseWork;
  stock: TransferWorkspace['stock'];
  warehouses: Warehouse[];
  items: (Option & { unit: string })[];
  suppliers: Option[];
}) {
  const [tab, setTab] = useState<'production' | 'returns'>('production');
  return (
    <>
      <nav aria-label="Warehouse workflow">
        <button aria-pressed={tab === 'production'} onClick={() => setTab('production')}>
          Production
        </button>{' '}
        <button aria-pressed={tab === 'returns'} onClick={() => setTab('returns')}>
          Supplier returns
        </button>
      </nav>
      {tab === 'production' ? (
        <>
          <ActionForm
            title="Plan production"
            url="/api/v1/stock/production-orders"
            warning="This creates a draft. It does not consume ingredients. Use the approved SOP to choose the output and planned quantity."
            build={(d) => ({
              warehouseId: value(d, 'warehouseId'),
              outputItemId: value(d, 'outputItemId'),
              plannedQtyBase: value(d, 'plannedQtyBase'),
            })}
          >
            <Select name="warehouseId" label="Warehouse" options={warehouses} />
            <Select
              name="outputItemId"
              label="Output item and base unit"
              options={items.map((i) => ({ ...i, name: `${i.name} (${i.unit})` }))}
            />
            <Quantity name="plannedQtyBase" label="Planned quantity in output base unit" />
          </ActionForm>
          <h2>Recent production orders</h2>
          <p>
            Latest 100 orders. Issue the complete material list once; record actual output after
            production.
          </p>
          {work.production.map((p) => {
            const locs =
              warehouses.find((w) => w.id === p.warehouseId)?.locations.map((l) => l.id) ?? [];
            const available = stock.filter((s) => locs.includes(s.locationId));
            return (
              <section className="card" key={p.id}>
                <h3>
                  {p.item} · {p.warehouse}
                </h3>
                <p>
                  Reference {p.id} · {p.status.replaceAll('_', ' ')} · Planned {p.planned} {p.unit}{' '}
                  · Produced {p.produced} {p.unit}
                </p>
                {p.status === 'draft' ? (
                  <ActionForm
                    title="Issue materials"
                    url={`/api/v1/stock/production-orders/${p.id}/issue`}
                    warning="Confirm the complete material list against the SOP. This removes the selected quantities from sellable stock. Materials can be issued only once for this order."
                    build={(d) => ({
                      inputs: available.flatMap((s, i) =>
                        Number(value(d, `qty${String(i)}`)) > 0
                          ? [
                              {
                                itemId: s.itemId,
                                batchId: s.batchId,
                                qtyBase: value(d, `qty${String(i)}`),
                              },
                            ]
                          : [],
                      ),
                    })}
                  >
                    {available.length ? (
                      available.map((s, i) => (
                        <label key={`${s.itemId}:${s.batchId ?? 'none'}`}>
                          {s.itemName} · {s.batchCode ?? 'No batch'} · Available {s.available}{' '}
                          {s.unit}
                          <input
                            aria-label={`${s.itemName} ${s.batchCode ?? ''} (${s.unit})`}
                            type="number"
                            min="0"
                            max={s.available}
                            step="0.000001"
                            name={`qty${String(i)}`}
                            placeholder="Leave blank if unused"
                          />
                        </label>
                      ))
                    ) : (
                      <p>No available materials in this warehouse.</p>
                    )}
                  </ActionForm>
                ) : null}
                {p.status === 'materials_issued' ? (
                  <ActionForm
                    title="Record production output"
                    url={`/api/v1/stock/production-orders/${p.id}/output`}
                    warning="Accepted output becomes sellable immediately; rejected output goes to damaged stock. Enter the new batch code and measured quantities only after quality checks."
                    build={(d) => ({
                      outputBatchCode: value(d, 'outputBatchCode'),
                      expiryDate: value(d, 'expiryDate') || null,
                      acceptedQtyBase: value(d, 'acceptedQtyBase'),
                      rejectedQtyBase: value(d, 'rejectedQtyBase'),
                    })}
                  >
                    <label>
                      New batch code
                      <input
                        name="outputBatchCode"
                        aria-label="New batch code"
                        required
                        maxLength={80}
                      />
                    </label>
                    <label>
                      Expiry date
                      <input name="expiryDate" aria-label="Expiry date" type="date" />
                    </label>
                    <Quantity name="acceptedQtyBase" label={`Accepted (${p.unit})`} zero />
                    <Quantity name="rejectedQtyBase" label={`Rejected (${p.unit})`} zero />
                  </ActionForm>
                ) : null}
                {['produced', 'quality_checked'].includes(p.status) ? (
                  <ActionForm
                    title="Finalize production record"
                    url={`/api/v1/stock/production-orders/${p.id}/post`}
                    warning="Confirm the production record is complete. Output stock was already recorded in the previous step."
                    build={() => ({})}
                  />
                ) : null}
              </section>
            );
          })}
          {!work.production.length ? <p>No production orders yet.</p> : null}
        </>
      ) : (
        <>
          <ActionForm
            title="Request supplier return"
            url="/api/v1/stock/supplier-returns"
            warning="This moves the selected sellable stock into quarantine. Use this form for goods already accepted into stock; rejected deliveries require their receiving workflow."
            build={(d) => {
              const s = stock.find(
                (s) => `${s.locationId}:${s.itemId}:${s.batchId ?? ''}` === value(d, 'stock'),
              );
              return {
                submissionId: crypto.randomUUID(),
                supplierId: value(d, 'supplierId'),
                warehouseId: warehouses.find((w) => w.locations.some((l) => l.id === s?.locationId))
                  ?.id,
                itemId: s?.itemId,
                batchId: s?.batchId,
                quantityBase: value(d, 'quantityBase'),
                reason: value(d, 'reason'),
              };
            }}
          >
            <Select name="supplierId" label="Original supplier" options={suppliers} />
            <Select
              name="stock"
              label="Warehouse, item and batch"
              options={stock.map((s) => ({
                id: `${s.locationId}:${s.itemId}:${s.batchId ?? ''}`,
                name: `${warehouses.find((w) => w.locations.some((l) => l.id === s.locationId))?.name ?? ''} · ${s.itemName} · ${s.batchCode ?? 'No batch'} · ${s.available} ${s.unit}`,
              }))}
            />
            <Quantity name="quantityBase" label="Quantity in item base unit" />
            <Select
              name="reason"
              label="Return reason"
              options={['damaged', 'wrong_item', 'expired', 'rejected', 'quality_failed'].map(
                (id) => ({ id, name: id.replaceAll('_', ' ') }),
              )}
            />
          </ActionForm>
          <h2>Recent supplier returns</h2>
          <p>
            Latest 100 records. Resolution records the supplier's decision; it does not create a
            refund, credit note or replacement receipt.
          </p>
          {work.returns.map((r) => (
            <section className="card" key={r.id}>
              <h3>
                {r.item} · {r.supplier}
              </h3>
              <p>
                {r.warehouse} · Batch {r.batch ?? 'none'} · {r.quantity} {r.unit} ·{' '}
                {r.reason.replaceAll('_', ' ')} · {r.status}
                {r.resolution ? ` · ${r.resolution.replaceAll('_', ' ')}` : ''}
              </p>
              <p>Reference {r.id}</p>
              {r.status === 'requested' ? (
                <ActionForm
                  title="Dispatch supplier return"
                  url={`/api/v1/stock/supplier-returns/${r.id}/dispatch`}
                  warning="Confirm the quarantined goods have left the warehouse for the supplier. This removes the returned quantity from warehouse stock."
                  build={() => ({})}
                />
              ) : null}
              {r.status === 'dispatched' ? (
                <ActionForm
                  title="Record supplier decision"
                  url={`/api/v1/stock/supplier-returns/${r.id}/resolve`}
                  warning="Record the confirmed outcome. Handle the actual financial document or replacement receipt separately."
                  build={(d) => ({ resolution: value(d, 'resolution') })}
                >
                  <Select
                    name="resolution"
                    label="Confirmed outcome"
                    options={['replacement', 'credit_note', 'refund', 'supplier_rejected'].map(
                      (id) => ({ id, name: id.replaceAll('_', ' ') }),
                    )}
                  />
                </ActionForm>
              ) : null}
            </section>
          ))}
          {!work.returns.length ? <p>No supplier returns yet.</p> : null}
        </>
      )}
    </>
  );
}
