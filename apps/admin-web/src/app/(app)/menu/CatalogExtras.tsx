'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MasterMenuView } from '@jksh/identity';

interface ItemOpt {
  id: string;
  name: string;
}

async function post(url: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.ok) return { ok: true };
  const d = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
  return { ok: false, error: d.message ?? d.error ?? `HTTP ${String(res.status)}` };
}

export function CatalogExtras({
  brandId,
  addonGroups,
  combos,
  items,
}: {
  brandId: string;
  addonGroups: MasterMenuView['addonGroups'];
  combos: MasterMenuView['combos'];
  items: ItemOpt[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  // Add-on group draft
  const [gName, setGName] = useState('');
  const [gMin, setGMin] = useState('0');
  const [gMax, setGMax] = useState('1');
  const [gReq, setGReq] = useState(false);
  const [gAddons, setGAddons] = useState<{ name: string; price: string }[]>([
    { name: '', price: '' },
  ]);

  // Combo draft
  const [cName, setCName] = useState('');
  const [cPrice, setCPrice] = useState('');
  const [cComps, setCComps] = useState<{ catalogItemId: string; quantity: string }[]>([
    { catalogItemId: '', quantity: '1' },
    { catalogItemId: '', quantity: '1' },
  ]);

  async function createGroup(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const addons = gAddons
      .filter((a) => a.name.trim() && a.price.trim())
      .map((a) => ({ name: a.name.trim(), price: a.price.trim(), gstRate: '5' }));
    if (addons.length === 0) {
      setMsg({ kind: 'error', text: 'Add at least one add-on with a price.' });
      setBusy(false);
      return;
    }
    const r = await post('/api/v1/catalog/addon-groups', {
      brandId,
      name: gName.trim(),
      minSelect: Number(gMin) || 0,
      maxSelect: Number(gMax) || 1,
      isRequired: gReq,
      addons,
    });
    setBusy(false);
    if (!r.ok) return setMsg({ kind: 'error', text: r.error ?? 'Failed' });
    setGName('');
    setGAddons([{ name: '', price: '' }]);
    setMsg({ kind: 'ok', text: 'Add-on group created. Attach it to items from the item row.' });
    router.refresh();
  }

  async function createComboFn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const components = cComps
      .filter((c) => c.catalogItemId)
      .map((c) => ({ catalogItemId: c.catalogItemId, quantity: Number(c.quantity) || 1 }));
    if (components.length < 2) {
      setMsg({ kind: 'error', text: 'A combo needs at least two component items.' });
      setBusy(false);
      return;
    }
    const r = await post('/api/v1/catalog/combos', {
      brandId,
      name: cName.trim(),
      price: cPrice.trim(),
      components,
    });
    setBusy(false);
    if (!r.ok) return setMsg({ kind: 'error', text: r.error ?? 'Failed' });
    setCName('');
    setCPrice('');
    setCComps([
      { catalogItemId: '', quantity: '1' },
      { catalogItemId: '', quantity: '1' },
    ]);
    setMsg({ kind: 'ok', text: 'Combo created. Publish the menu to push it to outlets.' });
    router.refresh();
  }

  const nameById = new Map(items.map((i) => [i.id, i.name]));

  return (
    <>
      <h2 className="section-label">Add-on groups</h2>
      {msg ? <p className={msg.kind}>{msg.text}</p> : null}

      <div className="card">
        {addonGroups.length > 0 ? (
          <div className="menu-rows" style={{ marginBottom: 12 }}>
            {addonGroups.map((g) => (
              <div key={g.id} className="menu-row" style={{ gridTemplateColumns: '1fr 2fr auto' }}>
                <span className="menu-row-name">{g.name}</span>
                <span className="muted" style={{ fontSize: 12 }}>
                  {g.addons.map((a) => `${a.name} ₹${a.price}`).join(' · ')}
                </span>
                <span className="pill">
                  {g.isRequired ? 'required · ' : ''}
                  {g.minSelect}–{g.maxSelect}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
            No add-on groups yet.
          </p>
        )}

        <form onSubmit={createGroup}>
          <strong>New group</strong>
          <div className="toolbar" style={{ marginTop: 8 }}>
            <label className="grow">
              Group name
              <input
                value={gName}
                onChange={(e) => setGName(e.target.value)}
                placeholder="e.g. Milk choice"
                required
              />
            </label>
            <label style={{ width: 80 }}>
              Min
              <input value={gMin} onChange={(e) => setGMin(e.target.value)} inputMode="numeric" />
            </label>
            <label style={{ width: 80 }}>
              Max
              <input value={gMax} onChange={(e) => setGMax(e.target.value)} inputMode="numeric" />
            </label>
            <label className="check" style={{ alignSelf: 'end', paddingBottom: 6 }}>
              <input type="checkbox" checked={gReq} onChange={(e) => setGReq(e.target.checked)} />
              Required
            </label>
          </div>
          {gAddons.map((a, i) => (
            <div key={i} className="row" style={{ gap: 8, marginBottom: 6 }}>
              <input
                value={a.name}
                onChange={(e) =>
                  setGAddons((rows) =>
                    rows.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)),
                  )
                }
                placeholder="Add-on name"
                style={{ margin: 0 }}
              />
              <input
                value={a.price}
                onChange={(e) =>
                  setGAddons((rows) =>
                    rows.map((r, j) => (j === i ? { ...r, price: e.target.value } : r)),
                  )
                }
                placeholder="₹ price"
                inputMode="decimal"
                style={{ margin: 0, width: 110 }}
              />
              {i === gAddons.length - 1 ? (
                <button
                  type="button"
                  className="ghost sm"
                  onClick={() => setGAddons((r) => [...r, { name: '', price: '' }])}
                >
                  + row
                </button>
              ) : null}
            </div>
          ))}
          <button type="submit" disabled={busy || !gName.trim()} style={{ marginTop: 6 }}>
            Create group
          </button>
        </form>
      </div>

      <h2 className="section-label">Combos</h2>
      <div className="card">
        {combos.length > 0 ? (
          <div className="menu-rows" style={{ marginBottom: 12 }}>
            {combos.map((c) => (
              <div key={c.id} className="menu-row" style={{ gridTemplateColumns: '1fr auto 2fr' }}>
                <span className="menu-row-name">{c.name}</span>
                <span className="num">₹{c.price}</span>
                <span className="muted" style={{ fontSize: 12 }}>
                  {c.components
                    .map((x) => `${String(x.quantity)}× ${nameById.get(x.catalogItemId) ?? x.name}`)
                    .join(' + ')}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
            No combos yet.
          </p>
        )}

        <form onSubmit={createComboFn}>
          <strong>New combo</strong>
          <div className="toolbar" style={{ marginTop: 8 }}>
            <label className="grow">
              Combo name
              <input
                value={cName}
                onChange={(e) => setCName(e.target.value)}
                placeholder="e.g. Tea + Samosa"
                required
              />
            </label>
            <label style={{ width: 130 }}>
              Price ₹ (incl. GST)
              <input
                value={cPrice}
                onChange={(e) => setCPrice(e.target.value)}
                inputMode="decimal"
                required
              />
            </label>
          </div>
          {cComps.map((c, i) => (
            <div key={i} className="row" style={{ gap: 8, marginBottom: 6 }}>
              <select
                value={c.catalogItemId}
                onChange={(e) =>
                  setCComps((rows) =>
                    rows.map((r, j) => (j === i ? { ...r, catalogItemId: e.target.value } : r)),
                  )
                }
                style={{ margin: 0 }}
              >
                <option value="">— item —</option>
                {items.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.name}
                  </option>
                ))}
              </select>
              <input
                value={c.quantity}
                onChange={(e) =>
                  setCComps((rows) =>
                    rows.map((r, j) => (j === i ? { ...r, quantity: e.target.value } : r)),
                  )
                }
                inputMode="numeric"
                style={{ margin: 0, width: 70 }}
              />
              {i === cComps.length - 1 ? (
                <button
                  type="button"
                  className="ghost sm"
                  onClick={() => setCComps((r) => [...r, { catalogItemId: '', quantity: '1' }])}
                >
                  + item
                </button>
              ) : null}
            </div>
          ))}
          <button
            type="submit"
            disabled={busy || !cName.trim() || !cPrice.trim()}
            style={{ marginTop: 6 }}
          >
            Create combo
          </button>
        </form>
      </div>
    </>
  );
}
