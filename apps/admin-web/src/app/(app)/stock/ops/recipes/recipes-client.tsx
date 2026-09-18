'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { RecipeRow } from '@jksh/stock';
import { aiDraftSchema } from '@/server/ai-draft-schema';
import { DataTable } from '@/components/DataTable';
import { apiPost } from '../api';
import { RecipeVersionEditor, type RecipeItemOption } from './recipe-version-editor';

const KINDS = ['menu_item', 'addon', 'intermediate'] as const;

export function RecipesClient({
  rows,
  items,
  menuItems,
  addons,
}: {
  rows: RecipeRow[];
  items: RecipeItemOption[];
  menuItems: { id: string; name: string }[];
  addons: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [kind, setKind] = useState<(typeof KINDS)[number]>('menu_item');
  const [billingMenuItemId, setBillingMenuItemId] = useState('');
  const [billingAddonId, setBillingAddonId] = useState('');
  const [outputItemId, setOutputItemId] = useState('');

  const [openRecipe, setOpenRecipe] = useState<string | null>(null);
  async function createRecipe(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setMsg(null);
    const body: Record<string, unknown> = { name: name.trim(), kind };
    if (kind === 'menu_item' && billingMenuItemId.trim())
      body.billingMenuItemId = billingMenuItemId.trim();
    if (kind === 'addon' && billingAddonId.trim()) body.billingAddonId = billingAddonId.trim();
    if (kind === 'intermediate' && outputItemId) body.outputItemId = outputItemId;
    const r = await apiPost('/api/v1/stock/recipes', body);
    setSaving(false);
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
                  {{ menu_item: 'Menu item', addon: 'Add-on', intermediate: 'Prepared base' }[k]}
                </option>
              ))}
            </select>
          </label>
          {kind === 'menu_item' ? (
            <label>
              Menu item (optional)
              <select
                value={billingMenuItemId}
                onChange={(e) => setBillingMenuItemId(e.target.value)}
              >
                <option value="">Link after standardization</option>
                {menuItems.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {kind === 'addon' ? (
            <label>
              Menu add-on (optional)
              <select value={billingAddonId} onChange={(e) => setBillingAddonId(e.target.value)}>
                <option value="">Link after standardization</option>
                {addons.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {kind === 'intermediate' ? (
            <label>
              Prepared stock item
              <select
                required
                value={outputItemId}
                onChange={(e) => setOutputItemId(e.target.value)}
              >
                <option value="">Choose prepared output</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button disabled={pending || saving || !name.trim()}>Create</button>
        </div>
        {msg ? (
          <p className="muted" style={{ marginTop: 8 }}>
            {msg}
          </p>
        ) : null}
      </form>

      <DataTable
        columns={[
          {
            key: 'name',
            header: 'Name',
            width: 'minmax(160px,1fr)',
            nowrap: true,
            sortValue: (r) => r.name,
            render: (r) => r.name,
          },
          {
            key: 'kind',
            header: 'Kind',
            width: '120px',
            sortValue: (r) => r.kind,
            render: (r) => <span className="muted">{r.kind}</span>,
          },
          {
            key: 'status',
            header: 'Status',
            width: '120px',
            sortValue: (r) => r.status,
            render: (r) => <span className={`pill ${r.status}`}>{r.status}</span>,
          },
          {
            key: 'v',
            header: 'Version',
            width: '90px',
            align: 'right',
            sortValue: (r) => r.currentVersion,
            render: (r) => r.currentVersion,
          },
          {
            key: 'link',
            header: 'Billing link',
            width: 'minmax(120px,1fr)',
            nowrap: true,
            render: (r) => (
              <span className="mono" style={{ fontSize: 11 }}>
                {menuItems.find((i) => i.id === r.billingMenuItemId)?.name ??
                  addons.find((i) => i.id === r.billingAddonId)?.name ??
                  (r.billingMenuItemId || r.billingAddonId
                    ? 'Linked outside current master menu'
                    : 'Not linked')}
              </span>
            ),
          },
          {
            key: 'action',
            header: '',
            width: '130px',
            render: (r) => (
              <button
                className="secondary sm"
                onClick={() => setOpenRecipe(openRecipe === r.id ? null : r.id)}
                disabled={pending}
              >
                {openRecipe === r.id ? 'Close editor' : 'Prepare version'}
              </button>
            ),
          },
        ]}
        rows={rows}
        rowKey={(r) => r.id}
        initialSort={{ key: 'name', dir: 'asc' }}
        empty="No recipes yet."
      />

      {openRecipe &&
      aiDraftSchema.safeParse(rows.find((r) => r.id === openRecipe)?.sopDraft).success ? (
        <section className="card">
          <h2>Saved SOP draft</h2>
          <p>
            Use these notes to fill the measured recipe below. Confirm each quantity and match it to
            a stock item before publishing.
          </p>
          <DraftNotes value={rows.find((r) => r.id === openRecipe)?.sopDraft} />
          <a href="/ai">Edit draft in JKSH AI →</a>
        </section>
      ) : null}
      {openRecipe ? (
        <RecipeVersionEditor
          key={openRecipe}
          recipeId={openRecipe}
          recipeName={rows.find((r) => r.id === openRecipe)?.name ?? 'Recipe'}
          items={items}
          onPublished={() => {
            setMsg('Verified recipe version published.');
            setOpenRecipe(null);
            startTransition(() => router.refresh());
          }}
        />
      ) : null}
    </>
  );
}

function DraftNotes({ value }: { value: unknown }) {
  const parsed = aiDraftSchema.safeParse(value);
  if (!parsed.success) return null;
  const d = parsed.data;
  return (
    <>
      <p>
        Serving: {d.serving ?? 'Needs measurement'} · Batch yield:{' '}
        {d.batchYield ?? 'Needs measurement'}
      </p>
      <ul>
        {d.ingredients.map((i, n) => (
          <li key={n}>
            {i.name}: {i.quantity ?? '?'} {i.unit ?? ''} ({i.basis.replaceAll('_', ' ')})
          </li>
        ))}
      </ul>
      <ol>
        {d.steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
      <h3>Quality checks</h3>
      <ul>
        {d.checks.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
      {d.missingMeasurements.length ? (
        <>
          <h3>Confirm before publishing</h3>
          <ul>
            {d.missingMeasurements.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}
