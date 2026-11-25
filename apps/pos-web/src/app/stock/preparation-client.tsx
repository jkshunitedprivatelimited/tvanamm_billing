'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PreparationRecipe, PreparedBatchView } from '@jksh/stock';
import { isNetworkFailure } from '@/lib/stock-queue';
import { useStockActionQueue } from './stock-queue-panel';

type BigUnit = 'l' | 'kg' | 'each';
const bigUnit = (base: string): BigUnit => (base === 'ml' ? 'l' : base === 'g' ? 'kg' : 'each');
const unitLabel: Record<string, string> = {
  ml: 'ml',
  l: 'litres',
  g: 'g',
  kg: 'kg',
  each: 'pieces',
};

/** "1500.000000" ml → "1.5 litres"; small amounts stay in the base unit. */
function friendly(qtyBase: string, base: string): string {
  const n = Number(qtyBase);
  const big = bigUnit(base);
  if (big !== 'each' && Math.abs(n) >= 1000)
    return `${String(Number((n / 1000).toFixed(3)))} ${unitLabel[big] ?? big}`;
  return `${String(Number(n.toFixed(3)))} ${unitLabel[base] ?? base}`;
}

function toBase(quantity: string, unit: string): string {
  const n = Number(quantity);
  return (unit === 'l' || unit === 'kg' ? n * 1000 : n).toFixed(6).replace(/\.?0+$/, '');
}

interface Pending {
  path: string;
  body: Record<string, unknown>;
  label: string;
}

export function PreparationClient({
  recipes,
  batches,
}: {
  recipes: PreparationRecipe[];
  batches: PreparedBatchView[];
}) {
  const router = useRouter();
  const queue = useStockActionQueue();
  const saving = useRef(false);
  const [recipeId, setRecipeId] = useState('');
  const [quantity, setQuantity] = useState('');
  const recipe = recipes.find((r) => r.recipeId === recipeId);
  const [unit, setUnit] = useState<string>('l');
  const [discardFor, setDiscardFor] = useState<string | null>(null);
  const [discardQty, setDiscardQty] = useState('');
  const [discardReason, setDiscardReason] = useState('');
  // The exact request is kept until it succeeds, so "Retry" resends the same
  // submission id and can never record the batch twice.
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const open = batches.filter((b) => Number(b.qtyBaseRemaining) > 0);

  async function send(req: Pending) {
    if (saving.current) return;
    saving.current = true;
    setPending(req);
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(req.path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body),
      });
      const body = (await res.json().catch(() => ({}))) as {
        message?: string;
        inputs?: { itemName: string; shortfallBase: string; skippedUntracked: boolean }[];
      };
      if (!res.ok) {
        // A rejected entry (bad quantity, not published) will not succeed on
        // retry; drop it so the form can be corrected.
        if (res.status >= 400 && res.status < 500) setPending(null);
        throw new Error(body.message ?? 'Could not save. Retry.');
      }
      setPending(null);
      const short = (body.inputs ?? []).filter((i) => Number(i.shortfallBase) > 0);
      const uncounted = (body.inputs ?? []).filter((i) => i.skippedUntracked);
      setMessage({
        ok: true,
        text: [
          req.label,
          short.length
            ? `Recorded stock was short for ${short.map((i) => i.itemName).join(', ')} — your owner will see it.`
            : '',
          uncounted.length
            ? `${uncounted.map((i) => i.itemName).join(', ')} not deducted: no starting count yet.`
            : '',
        ]
          .filter(Boolean)
          .join(' '),
      });
      setQuantity('');
      setDiscardFor(null);
      setDiscardQty('');
      setDiscardReason('');
      router.refresh();
    } catch (e) {
      if (queue && isNetworkFailure(e) && typeof req.body.submissionId === 'string') {
        await queue.enqueue({
          key: req.body.submissionId,
          path: req.path,
          body: req.body,
          label: req.label.replace(/^Saved /, 'Prepared ').replace(/\.$/, ''),
        });
        setPending(null);
        setQuantity('');
        setDiscardFor(null);
        setMessage({
          ok: true,
          text: 'No internet. Saved on this device — it will send automatically.',
        });
        return;
      }
      setMessage({
        ok: false,
        text: e instanceof Error ? e.message : 'Connection interrupted.',
      });
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  if (!recipes.length && !batches.length) return null;

  return (
    <section className="card" style={{ marginTop: 24 }}>
      <h2>Prepared bases</h2>
      <p>
        Record a base when you make it, for example 2 litres of tea decoction. Its ingredients are
        taken from stock once, and sales then use the base.
      </p>

      {pending ? (
        <p role="alert">
          {pending.label.replace(/\.$/, '')} has not finished saving.{' '}
          <button disabled={busy} onClick={() => void send(pending)}>
            {busy ? 'Saving…' : 'Retry'}
          </button>{' '}
          <button className="ghost" disabled={busy} onClick={() => setPending(null)}>
            Cancel
          </button>
        </p>
      ) : null}

      {recipes.length ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!recipe || busy || pending) return;
            const qtyBase = toBase(quantity, unit);
            void send({
              path: '/api/v1/stock/prepared-batches',
              body: {
                submissionId: crypto.randomUUID(),
                recipeId: recipe.recipeId,
                outputQtyBase: qtyBase,
              },
              label: `Saved ${friendly(qtyBase, recipe.baseUnit)} of ${recipe.outputItemName}.`,
            });
          }}
        >
          <fieldset
            disabled={busy || !!pending}
            style={{ border: 0, padding: 0, display: 'grid', gap: 12 }}
          >
            <label>
              What did you make?
              <select
                value={recipeId}
                onChange={(e) => {
                  setRecipeId(e.target.value);
                  const next = recipes.find((r) => r.recipeId === e.target.value);
                  setUnit(next ? bigUnit(next.baseUnit) : 'l');
                  setMessage(null);
                }}
              >
                <option value="">Choose a base</option>
                {recipes.map((r) => (
                  <option key={r.recipeId} value={r.recipeId}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            {recipe ? (
              <>
                <div className="row" style={{ gap: 12 }}>
                  <label>
                    Quantity made
                    <input
                      required
                      type="number"
                      min="0.001"
                      step="0.001"
                      max="99999"
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                    />
                  </label>
                  <label>
                    Unit
                    <select value={unit} onChange={(e) => setUnit(e.target.value)}>
                      {[bigUnit(recipe.baseUnit), recipe.baseUnit]
                        .filter((u, i, all) => all.indexOf(u) === i)
                        .map((u) => (
                          <option key={u} value={u}>
                            {unitLabel[u] ?? u}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>
                {Number(quantity) > 0 ? (
                  <p className="muted">
                    Uses{' '}
                    {recipe.components
                      .filter((c) => c.componentType !== 'addon')
                      .map((c) => {
                        const factor =
                          Number(toBase(quantity, unit)) / Number(recipe.servingQtyBase);
                        return `${c.itemName} ${String(Number((Number(c.qtyBase) * factor).toFixed(2)))}`;
                      })
                      .join(', ')}{' '}
                    (in base units).
                  </p>
                ) : null}
                <button disabled={!(Number(quantity) > 0)}>
                  {busy ? 'Saving…' : 'Save prepared base'}
                </button>
              </>
            ) : null}
          </fieldset>
        </form>
      ) : (
        <p className="muted">No preparation recipes are published yet.</p>
      )}

      {message ? (
        <p role="status" className={message.ok ? 'ok' : 'error'}>
          {message.text}
        </p>
      ) : null}

      <h3 style={{ marginTop: 20 }}>Bases in use</h3>
      {open.length ? null : <p className="muted">No prepared base is left.</p>}
      {open.map((b) => (
        <div key={b.id} style={{ borderTop: '1px solid var(--border)', padding: '10px 0' }}>
          <strong>{b.itemName}</strong> · {friendly(b.qtyBaseRemaining, b.baseUnit)} left of{' '}
          {friendly(b.qtyBaseInitial, b.baseUnit)}
          <br />
          <small className="muted">Made {new Date(b.recordedAt).toLocaleString()}</small>
          {discardFor === b.id ? (
            <form
              style={{ display: 'grid', gap: 10, marginTop: 10 }}
              onSubmit={(e) => {
                e.preventDefault();
                if (busy || pending) return;
                const qtyBase = discardQty ? toBase(discardQty, bigUnit(b.baseUnit)) : undefined;
                void send({
                  path: '/api/v1/stock/prepared-batches/discard',
                  body: {
                    submissionId: crypto.randomUUID(),
                    preparedBatchId: b.id,
                    ...(qtyBase ? { qtyBase } : {}),
                    reason: discardReason,
                  },
                  label: `Discarded ${qtyBase ? friendly(qtyBase, b.baseUnit) : 'the rest'} of ${b.itemName}.`,
                });
              }}
            >
              <fieldset
                disabled={busy || !!pending}
                style={{ border: 0, padding: 0, display: 'grid', gap: 10 }}
              >
                <label>
                  Amount thrown away ({unitLabel[bigUnit(b.baseUnit)]}) — leave empty for all of it
                  <input
                    type="number"
                    min="0.001"
                    step="0.001"
                    value={discardQty}
                    onChange={(e) => setDiscardQty(e.target.value)}
                  />
                </label>
                <label>
                  Reason
                  <input
                    required
                    maxLength={400}
                    placeholder="End of day, spoiled, spilled…"
                    value={discardReason}
                    onChange={(e) => setDiscardReason(e.target.value)}
                  />
                </label>
                <div className="row" style={{ gap: 10 }}>
                  <button>{busy ? 'Saving…' : 'Save discard'}</button>
                  <button type="button" className="ghost" onClick={() => setDiscardFor(null)}>
                    Cancel
                  </button>
                </div>
              </fieldset>
            </form>
          ) : (
            <div>
              <button
                className="ghost sm"
                disabled={busy || !!pending}
                onClick={() => {
                  setDiscardFor(b.id);
                  setDiscardQty('');
                  setDiscardReason('');
                }}
              >
                Discard leftover
              </button>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
