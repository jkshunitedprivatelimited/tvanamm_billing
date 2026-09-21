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
  method: 'POST' | 'PATCH' | 'PUT',
  body: unknown,
): Promise<{ ok: boolean; data: unknown }> {
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, data: await res.json().catch(() => ({})) };
  } catch {
    return {
      ok: false,
      data: {
        message:
          'Could not connect. Refresh the menu to check whether your change was saved before trying again.',
      },
    };
  }
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
  initialOwnerOutletId,
}: {
  role: string;
  brandId: string;
  master: MasterMenuView;
  outlets: OutletRow[];
  /** Which outlet's pricing `master` was already fetched for (server-side,
   *  from the `?outlet=` search param) — seeds the selector so it matches
   *  what's on screen instead of silently defaulting to outlets[0]. */
  initialOwnerOutletId?: string;
}) {
  const router = useRouter();
  const isCentral = role === 'central_admin';
  const canAdd = isCentral || (role === 'franchise_owner' && !!initialOwnerOutletId);
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
  const [outletForFo, setOutletForFo] = useState(initialOwnerOutletId ?? outlets[0]?.id ?? '');

  /** Switching outlets for a Franchise Owner re-fetches that outlet's own
   *  pricing (server-side, via the `?outlet=` param) rather than just
   *  changing the publish target — the item list on screen must match. */
  function selectOwnerOutlet(id: string) {
    setBusy(true);
    setOutletForFo(id);
    router.push(`/menu?outlet=${id}`);
  }

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
    if (!canAdd || !draft.name.trim() || !draft.price.trim()) return;
    if (!isCentral && !outletForFo) {
      setMsg({ kind: 'error', text: 'Select an outlet before adding an item.' });
      return;
    }
    setBusy(true);
    setMsg(null);
    const { ok, data } = await req('/api/v1/catalog/items', 'POST', {
      brandId,
      name: draft.name.trim(),
      price: draft.price.trim(),
      ...(isCentral ? { gstRate: '5' } : { outletId: outletForFo }),
      ...(draft.categoryId ? { categoryId: draft.categoryId } : {}),
    });
    setBusy(false);
    if (!ok) return setMsg({ kind: 'error', text: errText(data) });
    setDraft({ categoryId: draft.categoryId, name: '', price: '' });
    setMsg({
      kind: 'ok',
      text: isCentral
        ? 'Item added.'
        : 'Item added to this outlet only. Publish to update billing.',
    });
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
    const { ok, data } =
      isCentral || master.items.find((i) => i.id === id)?.ownerScope === 'outlet'
        ? await req(`/api/v1/catalog/items/${id}`, 'PATCH', body)
        : await req(`/api/v1/catalog/items/${id}/outlet-override`, 'PUT', {
            outletId: outletForFo,
            ...body,
          });
    setBusy(false);
    if (!ok) {
      setMsg({ kind: 'error', text: errText(data) });
      return false;
    }
    setMsg({
      kind: 'ok',
      text: isCentral
        ? 'Saved. Publish to update the selected outlets.'
        : 'Saved for this outlet only. Publish to update billing.',
    });
    router.refresh();
    return true;
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
            <select value={outletForFo} onChange={(e) => selectOwnerOutlet(e.target.value)}>
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

      {(isCentral || outlets.length > 0) && (
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
            {canAdd ? (
              <button type="button" className="secondary sm" onClick={() => setAdding((v) => !v)}>
                {adding ? 'Close' : '+ Add item'}
              </button>
            ) : null}
          </div>

          {canAdd && adding && (
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
                  Price ₹ (GST included)
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
              {!isCentral && (
                <p className="muted">
                  This item will appear only in the selected outlet after you publish.
                </p>
              )}
              {isCentral && (
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
              )}
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
                      <ItemRow
                        key={`${outletForFo}:${it.id}:${it.name}:${it.price}:${it.categoryId ?? 'none'}:${String(it.isAvailable)}`}
                        item={it}
                        busy={busy}
                        categories={categories}
                        outletOnly={!isCentral}
                        onPatch={patchItem}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
          {grouped.length === 0 && (
            <div className="empty-state">
              <h3>No items {query ? 'match your search' : 'yet'}</h3>
              <p>
                {query
                  ? 'Try a different term.'
                  : isCentral
                    ? 'Use “Add item” to build the menu.'
                    : 'Use “Add item” to create an item for this outlet.'}
              </p>
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
  categories,
  outletOnly,
  onPatch,
}: {
  item: MasterMenuView['items'][number];
  busy: boolean;
  categories: MasterMenuView['categories'];
  outletOnly: boolean;
  onPatch: (id: string, body: Record<string, unknown>) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const [price, setPrice] = useState(item.price);
  const [categoryId, setCategoryId] = useState(item.categoryId ?? '');
  const [removing, setRemoving] = useState(false);
  return (
    <div className="card" style={{ margin: 0, borderRadius: 0, boxShadow: 'none' }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
        <div>
          <strong>{item.name}</strong>
          <p className="muted" style={{ margin: '4px 0' }}>
            ₹{item.price} · GST {item.gstRate}% ·{' '}
            {item.isAvailable ? 'Available' : 'Removed from sale'}
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="secondary sm" disabled={busy} onClick={() => setEditing(!editing)}>
            {editing ? 'Cancel' : 'Edit item'}
          </button>
          <button
            className="ghost sm"
            disabled={busy}
            onClick={() => {
              if (item.isAvailable) setRemoving(true);
              else void onPatch(item.id, { isAvailable: true });
            }}
          >
            {item.isAvailable ? 'Remove from sale' : 'Restore item'}
          </button>
        </div>
      </div>
      {removing ? (
        <div className="notice">
          <p>
            Remove {item.name} from {outletOnly ? 'this outlet’s' : 'the master'} menu? Past bills
            are kept. You can restore the item later. Publish afterward to update billing.
          </p>
          <div className="row" style={{ gap: 12 }}>
            <button
              disabled={busy}
              onClick={() =>
                void onPatch(item.id, { isAvailable: false }).then((ok) => {
                  if (ok) setRemoving(false);
                })
              }
            >
              Remove from sale
            </button>
            <button className="secondary" disabled={busy} onClick={() => setRemoving(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onPatch(item.id, {
              name: name.trim(),
              price: price.trim(),
              categoryId: categoryId || null,
            }).then((ok) => {
              if (ok) setEditing(false);
            });
          }}
        >
          <div className="grid" style={{ marginTop: 16 }}>
            <label>
              Item name
              <input
                required
                maxLength={160}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Price ₹
              <input
                required
                inputMode="decimal"
                pattern="[0-9]+([.][0-9]{1,2})?"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </label>
            <label>
              Category
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">{outletOnly ? 'Use original category' : 'Uncategorised'}</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="muted">
            {outletOnly
              ? 'Changes apply only to this outlet. Publish when ready.'
              : 'Publish when ready to update outlets.'}
          </p>
          <button disabled={busy || !name.trim() || !price.trim()}>Save changes</button>
        </form>
      ) : null}
    </div>
  );
}
