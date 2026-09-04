'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MasterMenuView } from '@jksh/identity';

interface OutletRow {
  id: string;
  name: string;
  status: string;
}

async function post(url: string, body: unknown): Promise<{ ok: boolean; data: unknown }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, data: await res.json().catch(() => ({})) };
}

export function MenuManager({
  role,
  brandId,
  master,
  outlets,
}: {
  role: string;
  brandId: string;
  master: MasterMenuView;
  outlets: OutletRow[];
}) {
  const router = useRouter();
  const isCentral = role === 'central_admin';
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // New master item form
  const [item, setItem] = useState({ name: '', price: '', gstRate: '5' });
  // Publish form
  const [overwritePrice, setOverwritePrice] = useState(false);
  const [targets, setTargets] = useState<string[]>([]);
  const [outletForFo, setOutletForFo] = useState(outlets[0]?.id ?? '');

  async function addItem(e: React.SyntheticEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const { ok, data } = await post('/api/v1/catalog/items', {
      brandId,
      name: item.name,
      price: item.price,
      gstRate: item.gstRate,
    });
    setBusy(false);
    if (!ok) {
      setMsg((data as { message?: string }).message ?? 'Could not add item.');
      return;
    }
    setItem({ name: '', price: '', gstRate: '5' });
    router.refresh();
  }

  async function publish(e: React.SyntheticEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const body = isCentral
      ? {
          brandId,
          scope: 'master',
          overwritePrice,
          forcedFields: [],
          ...(targets.length > 0 ? { targetOutletIds: targets } : {}),
        }
      : { brandId, scope: 'outlet', originOutletId: outletForFo, overwritePrice, forcedFields: [] };
    const { ok, data } = await post('/api/v1/menu-publications', body);
    setBusy(false);
    if (!ok) {
      setMsg((data as { message?: string }).message ?? 'Publish failed.');
      return;
    }
    const r = data as { status: string; targets: { outletId: string; status: string }[] };
    setMsg(`Publication ${r.status}: ${r.targets.map((t) => t.status).join(', ')}`);
    router.refresh();
  }

  return (
    <>
      {isCentral && (
        <section className="card">
          <h3>Master items ({master.items.length})</h3>
          <ul>
            {master.items.map((i) => (
              <li key={i.id}>
                {i.name} — ₹{i.price} (GST {i.gstRate}%){i.isAvailable ? '' : ' · out of stock'}
              </li>
            ))}
          </ul>
          <form onSubmit={addItem} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              placeholder="Item name"
              value={item.name}
              onChange={(e) => setItem({ ...item, name: e.target.value })}
              required
            />
            <input
              placeholder="Price (incl. GST)"
              inputMode="decimal"
              value={item.price}
              onChange={(e) => setItem({ ...item, price: e.target.value })}
              required
            />
            <input
              placeholder="GST %"
              inputMode="decimal"
              value={item.gstRate}
              onChange={(e) => setItem({ ...item, gstRate: e.target.value })}
              required
              style={{ width: 80 }}
            />
            <button type="submit" disabled={busy}>
              Add item
            </button>
          </form>
        </section>
      )}

      <section className="card">
        <h3>Publish</h3>
        <form onSubmit={publish}>
          {isCentral ? (
            <fieldset style={{ border: 0, padding: 0 }}>
              <legend className="muted">Target outlets (none selected = all active)</legend>
              {outlets.map((o) => (
                <label key={o.id} style={{ display: 'block' }}>
                  <input
                    type="checkbox"
                    checked={targets.includes(o.id)}
                    onChange={(e) =>
                      setTargets((t) =>
                        e.target.checked ? [...t, o.id] : t.filter((x) => x !== o.id),
                      )
                    }
                  />{' '}
                  {o.name} <span className="muted">({o.status})</span>
                </label>
              ))}
            </fieldset>
          ) : (
            <label>
              Outlet{' '}
              <select value={outletForFo} onChange={(e) => setOutletForFo(e.target.value)}>
                {outlets.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label style={{ display: 'block', marginTop: 8 }}>
            <input
              type="checkbox"
              checked={overwritePrice}
              onChange={(e) => setOverwritePrice(e.target.checked)}
            />{' '}
            Overwrite outlet prices with the standard price
          </label>
          <button type="submit" disabled={busy} style={{ marginTop: 8 }}>
            {busy ? 'Publishing…' : 'Publish menu version'}
          </button>
        </form>
        {msg ? <p className="ok">{msg}</p> : null}
      </section>
    </>
  );
}
