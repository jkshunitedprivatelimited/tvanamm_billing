'use client';

import { useEffect, useRef, useState } from 'react';
import type { PosRecipeHelp } from '@jksh/contracts';
import styles from './recipe-help.module.css';

export function RecipeHelp({
  item,
  onClose,
}: {
  item: { id: string; name: string };
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [help, setHelp] = useState<PosRecipeHelp | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement;
    element?.showModal();
    return () => {
      element?.close();
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setHelp(null);
      setError('');
      try {
        const response = await fetch(
          `/api/v1/catalog-items/${encodeURIComponent(item.id)}/recipe-help`,
          {
            cache: 'no-store',
            signal: controller.signal,
          },
        );
        if (!response.ok)
          throw new Error(
            response.status === 401
              ? 'Your session expired. Sign in again to view recipes.'
              : 'Recipe help could not be loaded. Check your connection and try again.',
          );
        const data = (await response.json()) as PosRecipeHelp;
        if (!controller.signal.aborted) setHelp(data);
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : 'Recipe help is unavailable.');
      }
    }
    void load();
    return () => controller.abort();
  }, [item.id, attempt]);

  const draft = help?.status === 'ready' ? help.draft : null;
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby="recipe-help-title"
      onCancel={onClose}
    >
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Recipe &amp; SOP</p>
          <h2 id="recipe-help-title">{item.name}</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close recipe help">
          Close ✕
        </button>
      </header>
      <div className={styles.body}>
        {!help && !error ? <p role="status">Loading recipe…</p> : null}
        {error ? (
          <div role="alert">
            <p>{error}</p>
            <button type="button" onClick={() => setAttempt((value) => value + 1)}>
              Try again
            </button>
          </div>
        ) : null}
        {help?.status === 'missing' ? (
          <p>No SOP is available for this item yet. Ask Central to add its recipe.</p>
        ) : null}
        {help?.status === 'not_ready' ? (
          <p>This item’s SOP is still being completed. Ask Central for the finished recipe.</p>
        ) : null}
        {draft && help?.status === 'ready' ? (
          <>
            <p className={styles.source}>
              Chef marked ready · Revision {help.revision} · Updated{' '}
              {new Date(help.updatedAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}
            </p>
            <section className={styles.summary}>
              <h3>Serving details</h3>
              <p>
                {draft.portionName || 'Serving'} · {draft.servingQuantity} {draft.servingUnit}
              </p>
              <p>
                Ingredient quantities below are for{' '}
                {draft.basis === 'batch'
                  ? `one batch: ${draft.batchYield} ${draft.batchUnit}, yielding ${draft.servingsPerBatch} servings`
                  : 'one serving'}
                .
              </p>
            </section>
            <section>
              <h3>Ingredients</h3>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Ingredient</th>
                      <th>Quantity</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draft.ingredients.map((ingredient, index) => (
                      <tr key={index}>
                        <td>{ingredient.name}</td>
                        <td>
                          {ingredient.quantity} {ingredient.unit}
                        </td>
                        <td>{ingredient.note || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            {(
              [
                ['Preparation', draft.method],
                ['Packaging & serving', draft.packaging],
                ['Measurement notes', draft.measurements],
                ['Variations', draft.variations],
              ] as const
            ).map(([title, content]) =>
              content ? (
                <section key={title}>
                  <h3>{title}</h3>
                  <p className={styles.text}>{content}</p>
                </section>
              ) : null,
            )}
          </>
        ) : null}
      </div>
    </dialog>
  );
}
