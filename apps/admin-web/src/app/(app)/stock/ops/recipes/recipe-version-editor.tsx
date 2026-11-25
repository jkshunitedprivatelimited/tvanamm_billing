'use client';
import { useEffect, useState } from 'react';
import {
  recipeEditorDraftSchema,
  recipeServingQuantity,
  recipeYieldPreview,
} from '@jksh/contracts';
import { apiPost } from '../api';
import type { ChefDraft } from '@/server/chef-sop-schema';
export interface RecipeItemOption {
  id: string;
  name: string;
  baseUnit: string;
}
type ComponentKind = 'fixed' | 'packaging' | 'optional' | 'alternative' | 'addon';
interface Line {
  key: number;
  itemId: string;
  quantity: string;
  kind: ComponentKind;
  group: string;
  isDefault: boolean;
  sourceName?: string | undefined;
  sourceUnit?: string | undefined;
  sourceQuantity?: string | undefined;
}
const emptyLine = (key: number): Line => ({
  key,
  itemId: '',
  quantity: '',
  kind: 'fixed',
  group: '',
  isDefault: true,
});

export function RecipeVersionEditor({
  recipeId,
  recipeName,
  items,
  onPublished,
  chefDraft,
}: {
  recipeId: string;
  recipeName: string;
  items: RecipeItemOption[];
  onPublished: () => void;
  chefDraft?: ChefDraft | undefined;
}) {
  const [basis, setBasis] = useState<string>(chefDraft?.basis ?? 'serving');
  const scoopServing = chefDraft?.servingUnit === 'scoops';
  const [serving, setServing] = useState(scoopServing ? '' : (chefDraft?.servingQuantity ?? ''));
  const [unit, setUnit] = useState<string>(
    scoopServing
      ? 'g'
      : chefDraft?.servingUnit === 'pieces'
        ? 'each'
        : (chefDraft?.servingUnit ?? 'ml'),
  );
  const [yieldQty, setYieldQty] = useState(
    !scoopServing && chefDraft?.batchUnit === chefDraft?.servingUnit
      ? (chefDraft?.batchYield ?? '')
      : '',
  );
  const [lines, setLines] = useState<Line[]>(
    chefDraft
      ? chefDraft.ingredients.map((i, n) => ({
          ...emptyLine(n + 1),
          quantity: i.quantity,
          sourceName: i.name,
          sourceUnit: i.unit === 'pieces' ? 'each' : i.unit,
          sourceQuantity: i.quantity,
        }))
      : [emptyLine(1)],
  );
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [draftRevision, setDraftRevision] = useState(0);
  const [baseVersion, setBaseVersion] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    void fetch(`/api/v1/stock/recipes/${recipeId}/draft`, {
      cache: 'no-store',
      signal: abort.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw new Error('Could not load the saved draft. Reopen this editor to retry.');
        const b = (await r.json()) as {
          draft: unknown;
          revision: number;
          currentVersion: number;
          baseVersion: number;
        };
        if (abort.signal.aborted) return;
        setDraftRevision(b.revision);
        setBaseVersion(b.currentVersion);
        if (b.draft) {
          const d = recipeEditorDraftSchema.parse(b.draft);
          setBasis(d.basis);
          setServing(d.serving);
          setUnit(d.unit);
          setYieldQty(d.yieldQty);
          setLines(d.lines);
          setMessage(
            b.baseVersion === b.currentVersion
              ? 'Saved draft restored.'
              : 'A newer recipe version was published. Review this saved draft against it before publishing.',
          );
        }
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (!abort.signal.aborted)
          setMessage(e instanceof Error ? e.message : 'Could not load draft.');
      });
    return () => abort.abort();
  }, [recipeId]);
  async function saveDraft() {
    if (busy || loading) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/v1/stock/recipes/${recipeId}/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          revision: draftRevision,
          baseVersion,
          draft: { basis, serving, unit, yieldQty, lines },
        }),
      });
      const b = (await r.json()) as { revision: number; message?: string };
      if (!r.ok) throw new Error(b.message ?? 'Could not save draft');
      setDraftRevision(b.revision);
      setMessage('Mapped draft saved. You can return to this recipe later.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not save draft');
    } finally {
      setBusy(false);
    }
  }
  const change = (key: number, patch: Partial<Line>) => {
    setLines((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setVerified(false);
  };
  let error = '';
  let yieldSummary = '';
  let components: {
    itemId: string;
    qtyBase: string;
    componentType: ComponentKind;
    alternativeGroup: string | null;
    isDefault: boolean;
  }[] = [];
  try {
    recipeYieldPreview(serving, serving);
    if (basis === 'batch') {
      const p = recipeYieldPreview(yieldQty, serving);
      yieldSummary = `${p.fullServings} full servings · ${String(Number(p.remainder))} ${unit} remainder`;
    }
    if (lines.length === 0) throw new Error('Add at least one ingredient.');
    components = lines.map((l) => {
      if (!items.some((i) => i.id === l.itemId))
        throw new Error('Choose a stock item for every row.');
      if (l.kind === 'alternative' && !l.group.trim())
        throw new Error('Name the choice group for alternative ingredients.');
      return {
        itemId: l.itemId,
        qtyBase: recipeServingQuantity(
          l.quantity,
          basis === 'batch' && l.kind !== 'packaging' ? yieldQty : serving,
          serving,
        ),
        componentType: l.kind,
        alternativeGroup: l.kind === 'alternative' ? l.group.trim() : null,
        isDefault: l.isDefault,
      };
    });
    for (const group of new Set(
      components.filter((c) => c.componentType === 'alternative').map((c) => c.alternativeGroup),
    )) {
      if (components.filter((c) => c.alternativeGroup === group && c.isDefault).length !== 1)
        throw new Error('Choose exactly one default ingredient in each alternative group.');
    }
  } catch (e) {
    error = e instanceof Error ? e.message : 'Check recipe quantities.';
  }
  async function publish(e: React.FormEvent) {
    e.preventDefault();
    if (busy || loading || error || !verified) return;
    setBusy(true);
    setMessage('');
    const result = await apiPost(`/api/v1/stock/recipes/${recipeId}/versions`, {
      expectedDraftRevision: draftRevision,
      expectedCurrentVersion: baseVersion,
      servingQtyBase: serving,
      servingUnit: unit,
      ...(basis === 'batch' ? { batchYieldBase: yieldQty } : {}),
      yieldUnverified: false,
      components,
    });
    setBusy(false);
    if (result.ok) onPublished();
    else setMessage(result.error);
  }
  return (
    <form className="card" onSubmit={publish}>
      <h2>Prepare a new version · {recipeName}</h2>
      <p className="muted">
        Use measured quantities. Spoon sizes, ranges and “as required” must be standardized before
        publishing.
      </p>
      {loading && !message ? <p role="status">Loading saved draft…</p> : null}
      <fieldset disabled={busy || loading}>
        <div className="grid">
          <label>
            Ingredient quantities describe
            <select
              value={basis}
              onChange={(e) => {
                setBasis(e.target.value);
                setVerified(false);
              }}
            >
              <option value="serving">One serving</option>
              <option value="batch">A measured batch</option>
            </select>
          </label>
          <label>
            Serving quantity
            {scoopServing ? (
              <small>
                Chef: {chefDraft.servingQuantity} scoops. Enter the measured serving quantity in the
                selected stock unit.
              </small>
            ) : null}
            <input
              required
              type="number"
              min="0.000001"
              step="0.000001"
              value={serving}
              onChange={(e) => {
                setServing(e.target.value);
                setVerified(false);
              }}
            />
          </label>
          <label>
            Serving unit
            <select
              value={unit}
              onChange={(e) => {
                setUnit(e.target.value);
                setVerified(false);
              }}
            >
              <option value="ml">Millilitres (ml)</option>
              <option value="g">Grams (g)</option>
              <option value="each">Pieces / servings (each)</option>
            </select>
          </label>
          {basis === 'batch' ? (
            <label>
              Usable finished yield ({unit})
              <input
                required
                type="number"
                min="0.000001"
                step="0.000001"
                value={yieldQty}
                onChange={(e) => {
                  setYieldQty(e.target.value);
                  setVerified(false);
                }}
              />
              <small>Measure after boiling, straining or trimming.</small>
            </label>
          ) : null}
        </div>
        {yieldSummary ? <p className="ok">{yieldSummary}</p> : null}
        <h3>Ingredients & packaging</h3>
        <p className="muted">
          Packaging quantities are always per serving. All other rows follow your selected
          serving/batch basis.
        </p>
        {lines.map((line, index) => (
          <div className="recipe-ingredient-row" key={line.key}>
            <label>
              Stock item
              {line.sourceName ? (
                <small>
                  Chef: {line.sourceName} · {line.sourceQuantity} {line.sourceUnit}
                </small>
              ) : null}
              <select
                required
                value={line.itemId}
                onChange={(e) => {
                  const item = items.find((i) => i.id === e.target.value);
                  change(line.key, {
                    itemId: e.target.value,
                    ...(line.sourceUnit
                      ? {
                          quantity:
                            item?.baseUnit === line.sourceUnit ? (line.sourceQuantity ?? '') : '',
                        }
                      : {}),
                  });
                }}
              >
                <option value="">Choose ingredient</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} · {i.baseUnit}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Usage
              <select
                value={line.kind}
                onChange={(e) => change(line.key, { kind: e.target.value as ComponentKind })}
              >
                <option value="fixed">Required ingredient</option>
                <option value="packaging">Packaging per serving</option>
                <option value="optional">Optional ingredient</option>
                <option value="alternative">Alternative ingredient</option>
                <option value="addon">Add-on</option>
              </select>
            </label>
            <label>
              Quantity ({items.find((i) => i.id === line.itemId)?.baseUnit ?? 'base unit'})
              <input
                required
                type="number"
                min="0.000001"
                step="0.000001"
                value={line.quantity}
                onChange={(e) => change(line.key, { quantity: e.target.value })}
              />
            </label>
            <div>
              <small>Per serving</small>
              <strong className="recipe-preview-quantity">
                {components[index]?.qtyBase ? Number(components[index].qtyBase) : '—'}{' '}
                {items.find((i) => i.id === line.itemId)?.baseUnit}
              </strong>
            </div>
            <button
              type="button"
              className="ghost"
              aria-label={`Remove ingredient ${String(index + 1)}`}
              onClick={() => {
                setLines((rows) => rows.filter((r) => r.key !== line.key));
                setVerified(false);
              }}
            >
              Remove
            </button>
            {line.kind === 'alternative' ? (
              <label>
                Alternative group
                <input
                  required
                  maxLength={60}
                  value={line.group}
                  onChange={(e) => change(line.key, { group: e.target.value })}
                />
              </label>
            ) : null}
            {line.kind === 'alternative' || line.kind === 'optional' ? (
              <label>
                <input
                  type="checkbox"
                  checked={line.isDefault}
                  onChange={(e) => change(line.key, { isDefault: e.target.checked })}
                />{' '}
                Included by default
              </label>
            ) : null}
          </div>
        ))}
        <button
          type="button"
          className="secondary"
          onClick={() => {
            setLines((rows) => [...rows, emptyLine(Math.max(0, ...rows.map((r) => r.key)) + 1)]);
            setVerified(false);
          }}
        >
          + Add ingredient or packaging
        </button>
        {error ? (
          <p className="muted" role="status">
            {error}
          </p>
        ) : null}
        <p>
          <label>
            <input
              type="checkbox"
              checked={verified}
              onChange={(e) => setVerified(e.target.checked)}
            />{' '}
            I have verified the portion, ingredient measurements, packaging and any SOP conflicts.
          </label>
        </p>
        <p className="muted">
          Publishing creates a new version. Historical bills keep their original recipe. Quantities
          are stored to six decimal places.
        </p>
        <button
          type="button"
          className="secondary"
          disabled={busy || loading}
          onClick={() => void saveDraft()}
        >
          Save mapped draft
        </button>
        <button disabled={busy || loading || !!error || !verified}>
          {busy ? 'Publishing…' : 'Publish verified version'}
        </button>
      </fieldset>
      {message ? (
        <p role="status" className="muted">
          {message}
        </p>
      ) : null}
    </form>
  );
}
