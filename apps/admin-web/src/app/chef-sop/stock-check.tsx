'use client';
import {
  suggestChefStockCheck,
  TVANAMM_STOCK_ITEMS,
  type ChefDraft,
  type ChefStockCheck,
} from '@/server/chef-sop-schema';

const CONTAINERS = TVANAMM_STOCK_ITEMS.filter((i) => i.unit === 'pieces').map((i) => i.name);

/**
 * "How much of each TVANAMM item / milk goes into ONE serving?" — one row per
 * item (name, amount, unit), pre-filled from the chef's ingredients, and one
 * button that confirms and saves the whole list.
 */
export function StockCheck({
  draft,
  disabled,
  onChange,
  onConfirm,
}: {
  draft: ChefDraft;
  disabled: boolean;
  onChange: (stock: ChefStockCheck) => void;
  onConfirm: (stock: ChefStockCheck) => void;
}) {
  // Shown pre-filled until the chef changes or confirms it.
  const stock = draft.stock ?? suggestChefStockCheck(draft);
  const change = (next: Partial<ChefStockCheck>) =>
    onChange({ ...stock, ...next, confirmed: false });
  const used = new Set(stock.lines.map((l) => l.item));
  const ready =
    stock.lines.length > 0 && stock.lines.every((l) => l.item && Number(l.quantity) > 0);

  return (
    <section className="stock-check">
      <div className="stock-check-head">
        <h3>4. Stock used for ONE serving</h3>
        <span className={stock.confirmed ? 'stock-badge done' : 'stock-badge todo'}>
          {stock.confirmed ? 'Checked ✓' : 'Not checked yet'}
        </span>
      </div>
      <p className="stock-check-help">
        How much of each item goes into <strong>one cup / glass / plate</strong>? Only TVANAMM items
        and milk — not sugar, water or fruit. Change a number if it is wrong.
      </p>

      <div className="stock-rows">
        {stock.lines.length === 0 ? (
          <p className="stock-empty">No TVANAMM item found in the ingredients. Add one below.</p>
        ) : null}
        {stock.lines.map((l, n) => {
          const setLine = (patch: Partial<typeof l>) =>
            change({ lines: stock.lines.map((r, j) => (j === n ? { ...r, ...patch } : r)) });
          return (
            <div className="stock-row" key={n}>
              {l.item ? (
                <span className="stock-item">{l.item}</span>
              ) : (
                <select
                  className="stock-item"
                  aria-label="Choose item"
                  value=""
                  disabled={disabled}
                  onChange={(e) => {
                    const known = TVANAMM_STOCK_ITEMS.find((i) => i.name === e.target.value);
                    setLine({ item: e.target.value, unit: known?.unit ?? 'g' });
                  }}
                >
                  <option value="">Choose item…</option>
                  {TVANAMM_STOCK_ITEMS.filter((i) => !used.has(i.name)).map((i) => (
                    <option key={i.name} value={i.name}>
                      {i.name}
                    </option>
                  ))}
                </select>
              )}
              <span className="stock-amount">
                <input
                  type="number"
                  inputMode="decimal"
                  min="0.001"
                  step="any"
                  aria-label={`Amount of ${l.item || 'item'} for one serving`}
                  value={l.quantity}
                  disabled={disabled || !l.item}
                  onChange={(e) => setLine({ quantity: e.target.value })}
                />
                <span className="stock-unit">{l.unit === 'pieces' ? 'pcs' : l.unit}</span>
              </span>
              {l.item === 'Tea Powder' && Number(l.quantity) > 5 ? (
                <span className="stock-warn">
                  Is this right? Normal tea is about 2.5 g per cup.
                </span>
              ) : null}
              <button
                type="button"
                className="stock-remove"
                aria-label={`Remove ${l.item || 'item'}`}
                disabled={disabled}
                onClick={() => change({ lines: stock.lines.filter((_, j) => j !== n) })}
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        className="secondary stock-add"
        disabled={disabled || stock.lines.length >= 30 || stock.lines.some((l) => !l.item)}
        onClick={() =>
          change({
            lines: [...stock.lines, { item: '', quantity: '', unit: 'g', confirmed: false }],
          })
        }
      >
        + Add item
      </button>

      <label className="stock-container">
        Cup / glass / box used
        <select
          value={
            CONTAINERS.includes(stock.container) || !stock.container ? stock.container : '__other'
          }
          disabled={disabled}
          onChange={(e) =>
            change({ container: e.target.value === '__other' ? ' ' : e.target.value })
          }
        >
          <option value="">Choose…</option>
          <option value="None">None</option>
          {CONTAINERS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
          <option value="__other">Other (type below)</option>
        </select>
        {stock.container && !CONTAINERS.includes(stock.container) && stock.container !== 'None' ? (
          <input
            placeholder="Type cup / glass name"
            maxLength={160}
            value={stock.container.trim()}
            disabled={disabled}
            onChange={(e) => change({ container: e.target.value || ' ' })}
          />
        ) : null}
      </label>

      <div className="stock-confirm">
        <button
          type="button"
          disabled={disabled || !ready || stock.confirmed}
          onClick={() =>
            onConfirm({
              ...stock,
              container: stock.container.trim(),
              lines: stock.lines.map((l) => ({ ...l, confirmed: true })),
              confirmed: true,
            })
          }
        >
          {stock.confirmed ? 'Checked ✓' : '✓ This is correct — save'}
        </button>
        {!ready && !stock.confirmed ? <small>Fill an amount for every item first.</small> : null}
      </div>
    </section>
  );
}
