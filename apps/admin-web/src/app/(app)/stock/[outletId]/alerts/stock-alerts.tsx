'use client';
import Link from 'next/link';
import { useState } from 'react';
import type { LowStockItem } from '@jksh/stock';
import { OpeningStock } from './opening-stock';

const number = (value: string) =>
  Number(value).toLocaleString('en-IN', { maximumFractionDigits: 6 });

export function StockAlerts({
  outletId,
  initialItems,
}: {
  outletId: string;
  initialItems: LowStockItem[];
}) {
  const [items, setItems] = useState(initialItems);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [message, setMessage] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  async function refresh() {
    setRefreshing(true);
    try {
      const res = await fetch(`/api/v1/stock/outlets/${outletId}/alerts`);
      if (!res.ok) throw new Error('Could not refresh stock. Please retry.');
      const body = (await res.json()) as { items: LowStockItem[] };
      setItems(body.items);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not refresh stock.');
    } finally {
      setRefreshing(false);
    }
  }
  const visible = items.filter(
    (item) =>
      `${item.name} ${item.sku}`.toLowerCase().includes(search.toLowerCase()) &&
      (filter === 'all' || (filter === 'low' ? item.low : item.threshold === null)),
  );
  return (
    <>
      <OpeningStock outletId={outletId} items={items} onSaved={refresh} />
      <div
        className="card grid"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}
      >
        <div className="stat">
          <div className="label">Low stock</div>
          <div className="value">{items.filter((i) => i.low).length}</div>
        </div>
        <div className="stat">
          <div className="label">Alerts enabled</div>
          <div className="value">{items.filter((i) => i.enabled).length}</div>
        </div>
        <div className="stat">
          <div className="label">No limit set</div>
          <div className="value">{items.filter((i) => i.threshold === null).length}</div>
        </div>
      </div>
      <div className="toolbar card">
        <label>
          Find an item
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name or SKU"
          />
        </label>
        <label>
          Show
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">All items</option>
            <option value="low">Low stock</option>
            <option value="unset">No limit set</option>
          </select>
        </label>
        <button className="secondary" disabled={refreshing} onClick={() => void refresh()}>
          {refreshing ? 'Refreshing…' : 'Refresh balances'}
        </button>
      </div>
      <p className="muted">
        Stock increases when you confirm a delivery and decreases as recorded sales use ingredients.
        Orders on the way are added only when received. Offline sales update after syncing.
      </p>
      {message ? <p role="status">{message}</p> : null}
      <div className="stock-limit-list">
        {visible.map((item) => (
          <LimitRow
            key={item.itemId}
            item={item}
            outletId={outletId}
            onSaved={async () => {
              setMessage('Stock limit saved. Low-stock status has been checked.');
              await refresh();
            }}
          />
        ))}
        {visible.length === 0 ? (
          <div className="card muted">
            {items.length
              ? 'No items match these filters.'
              : 'No active stock items are available yet.'}
          </div>
        ) : null}
      </div>
    </>
  );
}

function LimitRow({
  item,
  outletId,
  onSaved,
}: {
  item: LowStockItem;
  outletId: string;
  onSaved: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [quantity, setQuantity] = useState(item.threshold ?? '');
  const [unit, setUnit] = useState(item.baseUnit);
  const [enabled, setEnabled] = useState(item.enabled || item.threshold === null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const units =
    item.baseUnit === 'g'
      ? ['g', 'kg']
      : item.baseUnit === 'ml'
        ? ['ml', 'l']
        : item.baseUnit === 'each'
          ? ['each', 'dozen']
          : [item.baseUnit];
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/v1/stock/outlets/${outletId}/alerts`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ itemId: item.itemId, quantity, unit, enabled }),
      });
      const body = (await res.json()) as { message?: string };
      if (!res.ok) throw new Error(body.message ?? 'Could not save this stock limit.');
      setEditing(false);
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save. Please retry.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="card stock-limit-row">
      <div>
        <strong>{item.name}</strong>
        <div className="muted">{item.sku}</div>
        <span className={`pill ${item.low ? 'danger' : item.enabled ? 'ok' : ''}`}>
          {!item.trackingStarted
            ? 'Awaiting first count or delivery'
            : item.low
              ? 'Low stock'
              : item.enabled
                ? 'Above limit'
                : item.threshold === null
                  ? 'No limit set'
                  : 'Paused'}
        </span>
      </div>
      <div>
        <div className="muted">Available now</div>
        <strong>
          {item.trackingStarted ? `${number(item.quantity)} ${item.baseUnit}` : 'Not counted yet'}
        </strong>
      </div>
      <div>
        <div className="muted">Alert at or below</div>
        <strong>
          {item.threshold === null ? 'Set a limit' : `${number(item.threshold)} ${item.baseUnit}`}
        </strong>
        {item.checkedAt ? (
          <div className="muted" style={{ fontSize: 11 }}>
            Checked {new Date(item.checkedAt).toLocaleString()}
          </div>
        ) : null}
      </div>
      <div className="row">
        <button
          className="secondary sm"
          onClick={() => {
            setQuantity(item.threshold ?? '');
            setUnit(item.baseUnit);
            setEnabled(item.enabled || item.threshold === null);
            setError('');
            setEditing(!editing);
          }}
        >
          {editing ? 'Close' : item.threshold === null ? 'Set limit' : 'Edit limit'}
        </button>
        {item.low ? (
          <Link href={`/stock/${outletId}/order?item=${item.itemId}`}>Order stock →</Link>
        ) : null}
      </div>
      {editing ? (
        <form className="stock-limit-editor" onSubmit={(e) => void save(e)}>
          <label>
            Minimum quantity
            <input
              type="number"
              min="0"
              step="any"
              required
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              disabled={busy}
            />
          </label>
          <label>
            Unit
            <select value={unit} onChange={(e) => setUnit(e.target.value)} disabled={busy}>
              {units.map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
          </label>
          <label className="row">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              disabled={busy}
            />{' '}
            Alerts enabled
          </label>
          <button disabled={busy}>{busy ? 'Saving…' : 'Save limit'}</button>
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      ) : null}
    </article>
  );
}
