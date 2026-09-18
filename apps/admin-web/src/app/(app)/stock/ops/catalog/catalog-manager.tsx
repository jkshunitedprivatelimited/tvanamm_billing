'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ItemRow, listSupplyCatalogForCentral } from '@jksh/stock';
import { apiPost } from '../api';
type Catalog = Awaited<ReturnType<typeof listSupplyCatalogForCentral>>;
const value = (data: FormData, key: string) => {
  const v = data.get(key);
  return typeof v === 'string' ? v : '';
};

export function CatalogManager({ items, catalog }: { items: ItemRow[]; catalog: Catalog }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [dimension, setDimension] = useState('mass');
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    const result = await apiPost('/api/v1/stock/items', {
      name: value(data, 'name').trim(),
      sku: value(data, 'sku').trim(),
      itemType: value(data, 'itemType'),
      dimension,
      baseUnit: dimension === 'mass' ? 'g' : dimension === 'volume' ? 'ml' : 'each',
      supplyRule: value(data, 'supplyRule'),
      isBatchTracked: data.has('batch'),
      isReturnable: data.has('returnable'),
    });
    setBusy(false);
    setMessage(
      result.ok
        ? 'Item created. Set its catalogue price below when it is ready to order.'
        : result.error,
    );
    if (result.ok) {
      form.reset();
      router.refresh();
    }
  }
  return (
    <>
      <details className="card">
        <summary>
          <strong>Add a stock item</strong>
        </summary>
        <form onSubmit={create}>
          <fieldset disabled={busy}>
            <div className="grid">
              <label>
                Item name
                <input name="name" required maxLength={160} placeholder="e.g. Tea powder" />
              </label>
              <label>
                SKU
                <input name="sku" required maxLength={60} placeholder="e.g. TEA-001" />
              </label>
              <label>
                Category
                <select name="itemType">
                  <option value="raw_material">Raw material</option>
                  <option value="packaging">Packaging</option>
                  <option value="consumable">Consumable</option>
                  <option value="packaged_product">Packaged product</option>
                  <option value="finished_good">Finished product</option>
                  <option value="intermediate">Prepared ingredient</option>
                </select>
              </label>
              <label>
                Measure in
                <select value={dimension} onChange={(e) => setDimension(e.target.value)}>
                  <option value="mass">Weight · grams (g)</option>
                  <option value="volume">Volume · millilitres (ml)</option>
                  <option value="count">Count · pieces (each)</option>
                </select>
              </label>
              <label>
                Purchase source
                <select name="supplyRule">
                  <option value="jksh_required">Central supply only</option>
                  <option value="local_purchase">Local purchase</option>
                  <option value="flexible">Central or local</option>
                </select>
              </label>
            </div>
            <label>
              <input type="checkbox" name="batch" /> Track batches and expiry
            </label>
            <label>
              <input type="checkbox" name="returnable" /> Allow outlet return requests
            </label>
            <button>{busy ? 'Saving…' : 'Create item'}</button>
          </fieldset>
        </form>
        {message ? <p role="status">{message}</p> : null}
      </details>
      <label>
        Find an item
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or SKU"
        />
      </label>
      <p className="muted">
        {items.length} items loaded. Prices include GST and are entered per order pack.
      </p>
      {items
        .filter((i) => `${i.name} ${i.sku}`.toLowerCase().includes(search.toLowerCase()))
        .map((item) => (
          <CatalogRow key={item.id} item={item} entry={catalog.find((c) => c.itemId === item.id)} />
        ))}
      {!items.length ? <p className="card muted">Add your first stock item to begin.</p> : null}
    </>
  );
}
function CatalogRow({ item, entry }: { item: ItemRow; entry: Catalog[number] | undefined }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    const pack = Number(value(data, 'pack'));
    const price = Number(value(data, 'price'));
    const pricePaise = Math.round((price * 100) / pack);
    if (
      !Number.isFinite(pack) ||
      pack <= 0 ||
      !Number.isFinite(price) ||
      price < 0 ||
      (price > 0 && pricePaise === 0)
    ) {
      setMessage(
        'Enter a positive pack size and a price that can be represented in paise per base unit.',
      );
      return;
    }
    if (Math.abs(pricePaise * pack - price * 100) > 0.5) {
      setMessage(
        'This pack price cannot be represented exactly in paise per base unit. Choose a compatible price or pack size.',
      );
      return;
    }
    setBusy(true);
    const result = await apiPost('/api/v1/stock/supply-catalog', {
      itemId: item.id,
      gstInclusivePricePaise: pricePaise,
      gstRate: value(data, 'gst'),
      orderPackBase: value(data, 'pack'),
      hsnCode: value(data, 'hsn').trim() || null,
      deliveryRuleId: entry?.deliveryRuleId ?? null,
      isAvailable: data.has('available'),
    });
    setBusy(false);
    setMessage(
      result.ok
        ? 'Catalogue saved. Owners will see the updated availability and price.'
        : result.error,
    );
    if (result.ok) router.refresh();
  }
  return (
    <details className="card">
      <summary>
        <strong>{item.name}</strong> · {item.sku} ·{' '}
        {entry?.available ? 'Available to order' : 'Not published for ordering'}
      </summary>
      <p className="muted">
        Base unit: {item.baseUnit}. Existing delivery charge rules are preserved.
      </p>
      <form onSubmit={save}>
        <fieldset disabled={busy}>
          <div className="grid">
            <label>
              Pack size ({item.baseUnit})
              <input
                name="pack"
                required
                type="number"
                min="0.000001"
                step="0.000001"
                defaultValue={Number(entry?.orderPackBase ?? 1)}
              />
            </label>
            <label>
              Price per pack (₹, including GST)
              <input
                name="price"
                required
                type="number"
                min="0"
                step="0.01"
                defaultValue={
                  entry ? ((entry.pricePaise * Number(entry.orderPackBase)) / 100).toFixed(2) : ''
                }
              />
            </label>
            <label>
              GST %
              <input
                name="gst"
                required
                type="number"
                min="0"
                max="100"
                step="0.01"
                defaultValue={Number(entry?.gstRate ?? 0)}
              />
            </label>
            <label>
              HSN code
              <input name="hsn" maxLength={20} defaultValue={entry?.hsnCode ?? ''} />
            </label>
          </div>
          <label>
            <input name="available" type="checkbox" defaultChecked={entry?.available ?? false} />{' '}
            Available for owners to order
          </label>
          <button>{busy ? 'Saving…' : 'Save catalogue entry'}</button>
        </fieldset>
      </form>
      {message ? <p role="status">{message}</p> : null}
    </details>
  );
}
