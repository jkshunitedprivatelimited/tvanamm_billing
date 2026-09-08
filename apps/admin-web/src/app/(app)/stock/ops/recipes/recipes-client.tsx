'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { RecipeRow } from '@jksh/stock';
import { apiPost } from '../api';

interface ItemOpt {
  id: string;
  name: string;
}

const KINDS = ['menu_item', 'addon', 'intermediate'] as const;

export function RecipesClient({ rows, items }: { rows: RecipeRow[]; items: ItemOpt[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [kind, setKind] = useState<(typeof KINDS)[number]>('menu_item');
  const [billingMenuItemId, setBillingMenuItemId] = useState('');
  const [billingAddonId, setBillingAddonId] = useState('');

  const [openRecipe, setOpenRecipe] = useState<string | null>(null);
  const [servingQtyBase, setServingQtyBase] = useState('');
  const [servingUnit, setServingUnit] = useState('ml');
  const [batchYieldBase, setBatchYieldBase] = useState('');
  const [componentsJson, setComponentsJson] = useState(
    '[\n  { "componentType": "fixed", "itemId": "", "qtyBase": "0" }\n]',
  );

  async function createRecipe(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const body: Record<string, unknown> = { name: name.trim(), kind };
    if (billingMenuItemId.trim()) body.billingMenuItemId = billingMenuItemId.trim();
    if (billingAddonId.trim()) body.billingAddonId = billingAddonId.trim();
    const r = await apiPost('/api/v1/stock/recipes', body);
    if (r.ok) {
      setName('');
      setBillingMenuItemId('');
      setBillingAddonId('');
      setMsg('Recipe created as draft.');
      startTransition(() => router.refresh());
    } else {
      setMsg(`Failed: ${r.error}`);
    }
  }

  async function publish(e: React.FormEvent) {
    e.preventDefault();
    if (!openRecipe) return;
    setMsg(null);
    let components: unknown;
    try {
      components = JSON.parse(componentsJson);
    } catch {
      setMsg('Components is not valid JSON.');
      return;
    }
    const body: Record<string, unknown> = {
      servingQtyBase: servingQtyBase.trim(),
      servingUnit: servingUnit.trim(),
      components,
    };
    if (batchYieldBase.trim()) body.batchYieldBase = batchYieldBase.trim();
    const r = await apiPost(`/api/v1/stock/recipes/${openRecipe}/versions`, body);
    if (r.ok) {
      setMsg('Version published.');
      setOpenRecipe(null);
      startTransition(() => router.refresh());
    } else {
      setMsg(`Failed: ${r.error}`);
    }
  }

  return (
    <>
      <form className="card" onSubmit={createRecipe}>
        <strong>New recipe</strong>
        <div style={{ display: 'flex', gap: 8, alignItems: 'end', marginTop: 8, flexWrap: 'wrap' }}>
          <label>
            <div className="muted" style={{ fontSize: 12 }}>
              Name
            </div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={160}
            />
          </label>
          <label>
            <div className="muted" style={{ fontSize: 12 }}>
              Kind
            </div>
            <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <label>
            <div className="muted" style={{ fontSize: 12 }}>
              Billing menu item id
            </div>
            <input
              value={billingMenuItemId}
              onChange={(e) => setBillingMenuItemId(e.target.value)}
              placeholder="optional"
            />
          </label>
          <label>
            <div className="muted" style={{ fontSize: 12 }}>
              Billing addon id
            </div>
            <input
              value={billingAddonId}
              onChange={(e) => setBillingAddonId(e.target.value)}
              placeholder="optional"
            />
          </label>
          <button disabled={pending || !name.trim()}>Create</button>
        </div>
        {msg ? (
          <p className="muted" style={{ marginTop: 8 }}>
            {msg}
          </p>
        ) : null}
      </form>

      <table style={{ marginTop: 12 }}>
        <thead>
          <tr>
            <th>Name</th>
            <th>Kind</th>
            <th>Status</th>
            <th>Version</th>
            <th>Billing link</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.name}</td>
              <td className="muted">{r.kind}</td>
              <td>
                <span className="pill">{r.status}</span>
              </td>
              <td className="num">{r.currentVersion}</td>
              <td className="mono" style={{ fontSize: 11 }}>
                {r.billingMenuItemId ?? r.billingAddonId ?? '—'}
              </td>
              <td>
                <button
                  className="secondary"
                  onClick={() => setOpenRecipe(openRecipe === r.id ? null : r.id)}
                  disabled={pending}
                >
                  {openRecipe === r.id ? 'Cancel' : 'Publish version'}
                </button>
              </td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} className="muted">
                No recipes yet.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      {openRecipe ? (
        <form className="card" onSubmit={publish} style={{ marginTop: 12 }}>
          <strong>Publish a new immutable version</strong>
          <div
            style={{ display: 'flex', gap: 8, alignItems: 'end', marginTop: 8, flexWrap: 'wrap' }}
          >
            <label>
              <div className="muted" style={{ fontSize: 12 }}>
                Serving qty (base)
              </div>
              <input
                value={servingQtyBase}
                onChange={(e) => setServingQtyBase(e.target.value)}
                required
                placeholder="80"
              />
            </label>
            <label>
              <div className="muted" style={{ fontSize: 12 }}>
                Serving unit
              </div>
              <input
                value={servingUnit}
                onChange={(e) => setServingUnit(e.target.value)}
                required
              />
            </label>
            <label>
              <div className="muted" style={{ fontSize: 12 }}>
                Measured batch yield (base, optional)
              </div>
              <input
                value={batchYieldBase}
                onChange={(e) => setBatchYieldBase(e.target.value)}
                placeholder="1000"
              />
            </label>
          </div>
          <div style={{ marginTop: 8 }}>
            <div className="muted" style={{ fontSize: 12 }}>
              Components JSON (componentType, itemId, qtyBase; optional alternativeGroup, isDefault,
              processLossPct)
            </div>
            <textarea
              value={componentsJson}
              onChange={(e) => setComponentsJson(e.target.value)}
              rows={8}
              style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }}
            />
          </div>
          <details style={{ marginTop: 6 }}>
            <summary className="muted" style={{ fontSize: 12 }}>
              Item ids
            </summary>
            <ul className="mono" style={{ fontSize: 11 }}>
              {items.map((i) => (
                <li key={i.id}>
                  {i.id} — {i.name}
                </li>
              ))}
            </ul>
          </details>
          <button style={{ marginTop: 8 }} disabled={pending}>
            Publish version
          </button>
        </form>
      ) : null}
    </>
  );
}
