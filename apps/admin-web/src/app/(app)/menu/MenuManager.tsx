'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MasterMenuView } from '@jksh/identity';

interface OutletRow {
  id: string;
  name: string;
  status: string;
}

async function req(
  url: string,
  method: 'POST' | 'PATCH',
  body: unknown,
): Promise<{ ok: boolean; data: unknown }> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, data: await res.json().catch(() => ({})) };
}

function errText(data: unknown): string {
  return (
    (data as { message?: string; error?: string }).message ??
    (data as { error?: string }).error ??
    'Something went wrong.'
  );
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
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ categoryId: '', name: '', price: '' });
  const [newCategory, setNewCategory] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function jump(id: string) {
    setCollapsed((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    });
    document.getElementById(`cat-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [overwritePrice, setOverwritePrice] = useState(false);
  const [targets, setTargets] = useState<string[]>([]);
  const [outletForFo, setOutletForFo] = useState(outlets[0]?.id ?? '');

  const categories = useMemo(
    () => [...master.categories].sort((a, b) => a.displayOrder - b.displayOrder),
    [master.categories],
  );
  const catName = useMemo(() => {
    const m = new Map(categories.map((c) => [c.id, c.name]));
    return (id: string | null) => (id ? (m.get(id) ?? 'Uncategorised') : 'Uncategorised');
  }, [categories]);

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const buckets = new Map<string, MasterMenuView['items']>();
    for (const it of master.items) {
      if (q && !it.name.toLowerCase().includes(q)) continue;
      const key = it.categoryId ?? '__none__';
      const bucket = buckets.get(key) ?? [];
      bucket.push(it);
      buckets.set(key, bucket);
    }
    const order = [...categories.map((c) => c.id), '__none__'];
    return order
      .map((id) => ({
        id,
        name: id === '__none__' ? 'Uncategorised' : catName(id),
        items: buckets.get(id) ?? [],
      }))
      .filter((g) => g.items.length > 0);
  }, [master.items, categories, catName, query]);

  const shownCount = grouped.reduce((n, g) => n + g.items.length, 0);

  async function addItem(e: React.SyntheticEvent) {
    e.preventDefault();
    if (!draft.name.trim() || !draft.price.trim()) return;
    setBusy(true);
    setMsg(null);
    const { ok, data } = await req('/api/v1/catalog/items', 'POST', {
      brandId,
      name: draft.name.trim(),
      price: draft.price.trim(),
      gstRate: '5',
      ...(draft.categoryId ? { categoryId: draft.categoryId } : {}),
    });
    setBusy(false);
    if (!ok) return setMsg({ kind: 'error', text: errText(data) });
    setDraft({ categoryId: draft.categoryId, name: '', price: '' });
    setMsg({ kind: 'ok', text: 'Item added.' });
    router.refresh();
  }

  async function addCategory(e: React.SyntheticEvent) {
    e.preventDefault();
    if (!newCategory.trim()) return;
    setBusy(true);
    setMsg(null);
    const { ok, data } = await req('/api/v1/catalog/categories', 'POST', {
      brandId,
      name: newCategory.trim(),
      displayOrder: categories.length,
    });
    setBusy(false);
    if (!ok) return setMsg({ kind: 'error', text: errText(data) });
    setNewCategory('');
    setMsg({ kind: 'ok', text: 'Category added.' });
    router.refresh();
  }

  async function patchItem(id: string, body: Record<string, unknown>) {
    setBusy(true);
    setMsg(null);
    const { ok, data } = await req(`/api/v1/catalog/items/${id}`, 'PATCH', body);
    setBusy(false);
    if (!ok) return setMsg({ kind: 'error', text: errText(data) });
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
    const { ok, data } = await req('/api/v1/menu-publications', 'POST', body);
    setBusy(false);
    if (!ok) return setMsg({ kind: 'error', text: errText(data) });
    const r = data as { status: string; targets: { status: string }[] };
    const okCount = r.targets.filter((t) => t.status === 'succeeded').length;
    setMsg({
      kind: 'ok',
      text: `Published to ${String(okCount)} outlet${okCount === 1 ? '' : 's'} — live now.`,
    });
    router.refresh();
  }

  return (
    <>
      {/* ---- Publish bar -------------------------------------------------- */}
      <div className="card publish-bar">
        <div>
          <strong>{isCentral ? 'Master menu' : 'Outlet menu'}</strong>
          <div className="muted" style={{ fontSize: 13 }}>
            {isCentral
              ? `${String(master.items.length)} items · ${String(categories.length)} categories`
              : 'Set your prices and availability, then publish.'}
          </div>
        </div>
        <form onSubmit={publish} className="row wrap" style={{ gap: 8 }}>
          {!isCentral && (
            <select value={outletForFo} onChange={(e) => setOutletForFo(e.target.value)}>
              {outlets.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          )}
          {isCentral && (
            <button type="button" className="ghost sm" onClick={() => setShowAdvanced((v) => !v)}>
              {showAdvanced ? 'Hide options' : 'Options'}
            </button>
          )}
          <button type="submit" disabled={busy}>
            {busy
              ? 'Publishing…'
              : isCentral && targets.length === 0
                ? 'Publish to all outlets'
                : 'Publish menu'}
          </button>
        </form>
      </div>

      {isCentral && showAdvanced && (
        <div className="card">
          <div className="section-label" style={{ margin: '0 0 8px' }}>
            Publish only to
          </div>
          <div className="outlet-grid">
            {outlets.map((o) => (
              <label key={o.id} className="check">
                <input
                  type="checkbox"
                  checked={targets.includes(o.id)}
                  onChange={(e) =>
                    setTargets((t) =>
                      e.target.checked ? [...t, o.id] : t.filter((x) => x !== o.id),
                    )
                  }
                />
                {o.name} <span className="muted">· {o.status}</span>
              </label>
            ))}
          </div>
          <label className="check" style={{ marginTop: 12 }}>
            <input
              type="checkbox"
              checked={overwritePrice}
              onChange={(e) => setOverwritePrice(e.target.checked)}
            />
            Reset outlet prices to the standard price
          </label>
          <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
            Leave everything unchecked to push to every active outlet. Outlet price overrides are
            kept unless you tick the reset box.
          </p>
        </div>
      )}

      {msg ? <p className={msg.kind}>{msg.text}</p> : null}

      {!isCentral ? null : (
        <>
          {/* ---- Toolbar: search + add ---------------------------------- */}
          <div className="card menu-toolbar">
            <input
              type="search"
              placeholder="Search items…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ margin: 0, maxWidth: 280 }}
            />
            <span className="muted" style={{ fontSize: 13 }}>
              {query
                ? `${String(shownCount)} match${shownCount === 1 ? '' : 'es'}`
                : `${String(master.items.length)} items`}
            </span>
            <span className="grow" />
            <button type="button" className="secondary sm" onClick={() => setAdding((v) => !v)}>
              {adding ? 'Close' : '+ Add item'}
            </button>
          </div>

          {adding && (
            <div className="card">
              <form onSubmit={addItem} className="toolbar">
                <label>
                  Category
                  <select
                    value={draft.categoryId}
                    onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}
                  >
                    <option value="">— none —</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grow">
                  Item name
                  <input
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    placeholder="e.g. Ginger Tea"
                    required
                  />
                </label>
                <label style={{ width: 130 }}>
                  Price ₹
                  <input
                    inputMode="decimal"
                    value={draft.price}
                    onChange={(e) => setDraft({ ...draft, price: e.target.value })}
                    placeholder="25"
                    required
                  />
                </label>
                <button type="submit" disabled={busy}>
                  Add
                </button>
              </form>
              <form onSubmit={addCategory} className="row" style={{ marginTop: 10, gap: 8 }}>
                <input
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  placeholder="New category name"
                  style={{ margin: 0, maxWidth: 260 }}
                />
                <button type="submit" className="secondary sm" disabled={busy}>
                  Add category
                </button>
              </form>
            </div>
          )}

          {/* ---- Category jump bar ----------------------------------- */}
          {!query && grouped.length > 1 && (
            <div className="cat-nav">
              {grouped.map((g) => (
                <button key={g.id} type="button" className="cat-chip" onClick={() => jump(g.id)}>
                  {g.name} <span>{g.items.length}</span>
                </button>
              ))}
            </div>
          )}

          {/* ---- Category sections ------------------------------------- */}
          {grouped.map((g) => {
            const isOpen = query.length > 0 || !collapsed.has(g.id);
            return (
              <section key={g.id} id={`cat-${g.id}`} className="card cat-card">
                <button
                  type="button"
                  className="cat-head"
                  onClick={() => toggle(g.id)}
                  aria-expanded={isOpen}
                >
                  <span className="cat-caret">{isOpen ? '▾' : '▸'}</span>
                  <strong>{g.name}</strong>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {g.items.length} item{g.items.length === 1 ? '' : 's'}
                  </span>
                </button>
                {isOpen && (
                  <div className="menu-rows">
                    {g.items.map((it) => (
                      <ItemRow key={it.id} item={it} busy={busy} onPatch={patchItem} />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
          {grouped.length === 0 && (
            <div className="empty-state">
              <h3>No items {query ? 'match your search' : 'yet'}</h3>
              <p>{query ? 'Try a different term.' : 'Use “Add item” to build the menu.'}</p>
            </div>
          )}
        </>
      )}
    </>
  );
}

function ItemRow({
  item,
  busy,
  onPatch,
}: {
  item: MasterMenuView['items'][number];
  busy: boolean;
  onPatch: (id: string, body: Record<string, unknown>) => void;
}) {
  const [price, setPrice] = useState(item.price);
  const dirty = price.trim() !== item.price;
  return (
    <div className="menu-row">
      <span className="menu-row-name">{item.name}</span>
      <span className="menu-row-price">
        ₹
        <input
          inputMode="decimal"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && dirty) onPatch(item.id, { price: price.trim() });
          }}
        />
        {dirty && (
          <button
            type="button"
            className="sm"
            disabled={busy}
            onClick={() => onPatch(item.id, { price: price.trim() })}
          >
            Save
          </button>
        )}
      </span>
      <span className="muted" style={{ fontSize: 12 }}>
        GST {item.gstRate}%
      </span>
      <button
        type="button"
        className={item.isAvailable ? 'ghost sm' : 'secondary sm'}
        disabled={busy}
        onClick={() => onPatch(item.id, { isAvailable: !item.isAvailable })}
        title="Toggle availability"
      >
        {item.isAvailable ? 'Available' : 'Hidden'}
      </button>
    </div>
  );
}
