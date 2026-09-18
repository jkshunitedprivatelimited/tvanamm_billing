'use client';
import { useState } from 'react';
import { recipeServingQuantity, recipeYieldPreview } from '@jksh/contracts';
import { apiPost } from '../api';
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
}: {
  recipeId: string;
  recipeName: string;
  items: RecipeItemOption[];
  onPublished: () => void;
}) {
  const [basis, setBasis] = useState('serving');
  const [serving, setServing] = useState('');
  const [unit, setUnit] = useState('ml');
  const [yieldQty, setYieldQty] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine(1)]);
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
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
    if (busy || error || !verified) return;
    setBusy(true);
    setMessage('');
    const result = await apiPost(`/api/v1/stock/recipes/${recipeId}/versions`, {
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
      <fieldset disabled={busy}>
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
              <select
                required
                value={line.itemId}
                onChange={(e) => change(line.key, { itemId: e.target.value })}
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
        <button disabled={busy || !!error || !verified}>
          {busy ? 'Publishing…' : 'Publish verified version'}
        </button>
      </fieldset>
      {message ? (
        <p role="alert" className="error">
          {message}
        </p>
      ) : null}
    </form>
  );
}
