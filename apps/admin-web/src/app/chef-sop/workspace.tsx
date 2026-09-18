'use client';
import { useEffect, useRef, useState } from 'react';
import {
  chefDraftSchema,
  emptyChefDraft,
  type ChefCollection,
  type ChefDraft,
} from '@/server/chef-sop-schema';
import './workbook.css';
export function ChefWorkspace({ reviewId }: { reviewId?: string }) {
  const token = useRef('');
  const [data, setData] = useState<ChefCollection | null>(null);
  const [selected, setSelected] = useState('');
  const [draft, setDraft] = useState<ChefDraft>(emptyChefDraft);
  const [revision, setRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const readOnly = !!reviewId || !!data?.closed || !!data?.submitted;
  useEffect(() => {
    token.current = window.location.hash.slice(1);
    if (!reviewId && !token.current) {
      setMessage('Open the complete link shared with you, including the part after #.');
      return;
    }
    fetch(reviewId ? `/api/v1/sop-collection?id=${reviewId}` : '/api/chef-sop', {
      headers: reviewId ? {} : { Authorization: `Bearer ${token.current}` },
      cache: 'no-store',
    })
      .then(async (r) => {
        const b = (await r.json()) as ChefCollection & { message?: string; revision: number };
        if (!r.ok) throw Error(b.message ?? 'Could not load workbook');
        setData(b);
      })
      .catch((e: unknown) =>
        setMessage(e instanceof Error ? e.message : 'Could not load workbook'),
      );
  }, [reviewId]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  function edit<K extends keyof ChefDraft>(k: K, v: ChefDraft[K]) {
    setDraft((d) => ({ ...d, [k]: v, status: 'draft' }));
    setDirty(true);
    setMessage('Unsaved changes');
  }
  function choose(id: string) {
    if (dirty && !confirm('Discard unsaved changes for this item?')) return;
    const e = data?.entries.find((e) => e.itemId === id);
    setSelected(id);
    setDraft(e?.draft ?? { ...emptyChefDraft(), chefName: draft.chefName });
    setRevision(e?.revision ?? 0);
    setDirty(false);
    setMessage('');
  }
  async function save(status: 'draft' | 'ready') {
    const next = { ...draft, status };
    const valid = chefDraftSchema.safeParse(next);
    if (!valid.success) {
      setMessage(valid.error.issues.map((i) => i.message).join(' '));
      return;
    }
    setBusy(true);
    try {
      const r = await fetch('/api/chef-sop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.current}` },
        body: JSON.stringify({ action: 'save', itemId: selected, revision, draft: next }),
      });
      const b = (await r.json()) as ChefCollection & { message?: string; revision: number };
      if (!r.ok) throw Error(b.message ?? 'Could not save');
      setRevision(b.revision);
      setDraft(next);
      setDirty(false);
      setData((d) =>
        d
          ? {
              ...d,
              entries: [
                ...d.entries.filter((e) => e.itemId !== selected),
                { itemId: selected, draft: next, revision: b.revision },
              ],
            }
          : d,
      );
      setMessage(
        status === 'ready'
          ? 'Saved · ready for review'
          : 'Draft saved. You can return using this same link.',
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not save. Your changes are still here.');
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    if (dirty) {
      setMessage('Save this recipe first.');
      return;
    }
    if (!confirm('Submit all recipes for review? Editing will close, and your work will be kept.'))
      return;
    setBusy(true);
    try {
      const r = await fetch('/api/chef-sop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.current}` },
        body: JSON.stringify({ action: 'submit' }),
      });
      const b = (await r.json()) as ChefCollection & { message?: string; revision: number };
      if (!r.ok) throw Error(b.message ?? 'Could not submit');
      setData((d) => (d ? { ...d, submitted: true } : d));
      setMessage('Submitted. Thank you—your recipes are stored for review.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not submit');
    } finally {
      setBusy(false);
    }
  }
  const ready = data?.entries.filter((e) => e.draft.status === 'ready').length ?? 0;
  const current = data?.menu.find((i) => i.id === selected);
  return (
    <main className="chef-workbook">
      <header className="chef-heading">
        <div>
          <span className="chef-kicker">T VANAMM · RECIPE STANDARDS</span>
          <h1>Chef SOP workbook</h1>
          <p>Measure once. Make every serving consistent.</p>
        </div>
        {data ? (
          <div className="chef-progress">
            <strong>
              {ready} / {data.menu.length}
            </strong>
            <span>recipes ready for review</span>
          </div>
        ) : null}
      </header>
      <section className="chef-guide">
        <strong>How to complete this workbook</strong>
        <p>
          Choose a menu item. Enter measured ingredient amounts, the finished serving size and
          preparation steps. Save a draft if a measurement is still missing, or mark it ready when
          checked. Your saved work stays here when you return.
        </p>
        <p>
          Use grams (g), millilitres (ml) or pieces. Weigh each spoon or scoop separately. Do not
          guess missing values. These entries do not change live billing or stock.
        </p>
      </section>
      {message ? (
        <p className="chef-message" role="status">
          {message}
        </p>
      ) : null}
      {data?.submitted ? (
        <p className="chef-message">Submitted for review. Editing is closed.</p>
      ) : null}
      {data ? (
        <div className="chef-layout">
          <aside className="chef-menu">
            <label>
              Find a menu item
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search tea, shake, snack…"
              />
            </label>
            <label>
              Category
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                <option>All</option>
                {[...new Set(data.menu.map((i) => i.category))].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <div className="chef-item-list">
              {data.menu
                .filter(
                  (i) =>
                    (category === 'All' || i.category === category) &&
                    i.name.toLowerCase().includes(search.toLowerCase()),
                )
                .map((i) => (
                  <button
                    disabled={busy}
                    key={i.id}
                    className={selected === i.id ? 'selected' : ''}
                    onClick={() => choose(i.id)}
                  >
                    <span>{i.name}</span>
                    <small>
                      {data.entries.find((e) => e.itemId === i.id)?.draft.status === 'ready'
                        ? 'Ready'
                        : data.entries.some((e) => e.itemId === i.id)
                          ? 'Draft'
                          : 'Not started'}
                    </small>
                  </button>
                ))}
            </div>
          </aside>
          <section className="chef-editor">
            {current ? (
              <>
                <span className="chef-kicker">{current.category}</span>
                <h2>{current.name}</h2>
                <fieldset disabled={readOnly || busy}>
                  <h3>1. Serving standard</h3>
                  <div className="chef-fields">
                    <label>
                      Chef / prepared by
                      <input
                        value={draft.chefName}
                        onChange={(e) => edit('chefName', e.target.value)}
                        maxLength={120}
                      />
                    </label>
                    <label>
                      Portion name
                      <input
                        value={draft.portionName}
                        onChange={(e) => edit('portionName', e.target.value)}
                        placeholder="Regular / large"
                        maxLength={100}
                      />
                    </label>
                    <label>
                      Final serving quantity
                      <input
                        type="number"
                        min="0.001"
                        step="any"
                        value={draft.servingQuantity}
                        onChange={(e) => edit('servingQuantity', e.target.value)}
                        placeholder="Finished drink or food"
                      />
                    </label>
                    <label>
                      Serving unit
                      <select
                        value={draft.servingUnit}
                        onChange={(e) =>
                          edit('servingUnit', e.target.value as ChefDraft['servingUnit'])
                        }
                      >
                        <option value="ml">ml</option>
                        <option value="g">g</option>
                        <option value="pieces">pieces</option>
                      </select>
                    </label>
                    <label>
                      Ingredient amounts below are for
                      <select
                        value={draft.basis}
                        onChange={(e) => edit('basis', e.target.value as ChefDraft['basis'])}
                      >
                        <option value="serving">One serving</option>
                        <option value="batch">One full batch</option>
                      </select>
                    </label>
                  </div>
                  {draft.basis === 'batch' ? (
                    <div className="chef-fields">
                      <label>
                        Finished batch yield
                        <input
                          type="number"
                          min="0.001"
                          step="any"
                          value={draft.batchYield}
                          onChange={(e) => edit('batchYield', e.target.value)}
                          placeholder="After cooking and straining"
                        />
                      </label>
                      <label>
                        Yield unit
                        <select
                          value={draft.batchUnit}
                          onChange={(e) =>
                            edit('batchUnit', e.target.value as ChefDraft['batchUnit'])
                          }
                        >
                          <option value="ml">ml</option>
                          <option value="g">g</option>
                          <option value="pieces">pieces</option>
                        </select>
                      </label>
                      <label>
                        Servings from this batch
                        <input
                          type="number"
                          min="0.001"
                          step="any"
                          value={draft.servingsPerBatch}
                          onChange={(e) => edit('servingsPerBatch', e.target.value)}
                        />
                      </label>
                    </div>
                  ) : null}
                  <h3>2. Ingredients & exact quantities</h3>
                  <p>
                    Include water, sugar, ice, toppings and garnishes. For a prepared base, give its
                    name and amount; explain its own recipe below.
                  </p>
                  {draft.ingredients.map((i, n) => (
                    <div className="chef-ingredient" key={n}>
                      <label>
                        Ingredient
                        <input
                          aria-label={`Ingredient ${String(n + 1)}`}
                          value={i.name}
                          maxLength={160}
                          onChange={(e) =>
                            edit(
                              'ingredients',
                              draft.ingredients.map((r, j) =>
                                j === n ? { ...r, name: e.target.value } : r,
                              ),
                            )
                          }
                        />
                      </label>
                      <label>
                        Quantity
                        <input
                          type="number"
                          min="0.001"
                          step="any"
                          value={i.quantity}
                          onChange={(e) =>
                            edit(
                              'ingredients',
                              draft.ingredients.map((r, j) =>
                                j === n ? { ...r, quantity: e.target.value } : r,
                              ),
                            )
                          }
                        />
                      </label>
                      <label>
                        Unit
                        <select
                          value={i.unit}
                          onChange={(e) =>
                            edit(
                              'ingredients',
                              draft.ingredients.map((r, j) =>
                                j === n ? { ...r, unit: e.target.value as typeof i.unit } : r,
                              ),
                            )
                          }
                        >
                          <option>g</option>
                          <option>ml</option>
                          <option>pieces</option>
                        </select>
                      </label>
                      <label>
                        Brand / preparation note
                        <input
                          value={i.note}
                          maxLength={250}
                          onChange={(e) =>
                            edit(
                              'ingredients',
                              draft.ingredients.map((r, j) =>
                                j === n ? { ...r, note: e.target.value } : r,
                              ),
                            )
                          }
                        />
                      </label>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() =>
                          edit(
                            'ingredients',
                            draft.ingredients.filter((_, j) => j !== n),
                          )
                        }
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="secondary"
                    disabled={draft.ingredients.length >= 60}
                    onClick={() =>
                      edit('ingredients', [
                        ...draft.ingredients,
                        { name: '', quantity: '', unit: 'g', note: '' },
                      ])
                    }
                  >
                    + Add ingredient
                  </button>
                  <h3>3. Preparation & serving</h3>
                  {(
                    [
                      [
                        'method',
                        'Step-by-step method',
                        'Write each step on a new line. Include boiling, blending, straining and measured base preparation.',
                      ],
                      [
                        'measurements',
                        'Spoon, scoop and pump measurements',
                        'Example format: sugar spoon = __ g; syrup pump = __ ml. Measure separately for every ingredient.',
                      ],
                      [
                        'packaging',
                        'Cup, glass & packaging',
                        'Cup capacity, actual fill, ice amount, lid, straw, spoon, tissue and bag. Note dine-in versus takeaway.',
                      ],
                      [
                        'variations',
                        'Other sizes & customer options',
                        'Give exact quantities for additional sizes, less/no sugar, milk alternatives or optional toppings. Write None if there are no variations.',
                      ],
                      [
                        'questions',
                        'Measurements still to confirm',
                        'List anything you could not measure. Keep as Draft until resolved.',
                      ],
                    ] as const
                  ).map(([key, label, hint]) => (
                    <label className="chef-long" key={key}>
                      {label}
                      <small>{hint}</small>
                      <textarea
                        rows={key === 'method' ? 6 : 3}
                        maxLength={3000}
                        value={draft[key]}
                        onChange={(e) => edit(key, e.target.value)}
                      />
                    </label>
                  ))}
                </fieldset>
                {!readOnly ? (
                  <div className="chef-actions">
                    <button
                      disabled={busy}
                      className="secondary"
                      onClick={() => void save('draft')}
                    >
                      Save draft
                    </button>
                    <button disabled={busy} onClick={() => void save('ready')}>
                      Save & mark ready
                    </button>
                    <span>{dirty ? 'Unsaved changes' : revision ? 'Saved' : 'Not saved yet'}</span>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="chef-empty">
                <h2>Start with any menu item</h2>
                <p>Choose an item from the menu to enter its recipe.</p>
              </div>
            )}
          </section>
        </div>
      ) : null}
      {data && !readOnly ? (
        <footer className="chef-footer">
          <p>
            {ready} of {data.menu.length} recipes ready. Save drafts whenever needed; submit after
            every item is complete.
          </p>
          <button
            disabled={busy || dirty || ready !== data.menu.length}
            onClick={() => void submit()}
          >
            Submit complete workbook
          </button>
        </footer>
      ) : null}
    </main>
  );
}
