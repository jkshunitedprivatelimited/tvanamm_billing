'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { aiPersona } from '@/server/ai-persona';
import type { AiDraft } from '@/server/ai-draft-schema';
const blank: AiDraft = {
  name: '',
  kind: 'menu_item',
  serving: null,
  batchYield: null,
  ingredients: [],
  steps: [],
  checks: [],
  missingMeasurements: [],
};
export function AiWorkspace({
  enabled,
  role,
  outlets,
  central,
  savedDrafts,
}: {
  enabled: boolean;
  role: string;
  outlets: { id: string; name: string }[];
  central: boolean;
  savedDrafts: { id: string; draft: AiDraft }[];
}) {
  const router = useRouter();
  const persona = aiPersona(role);
  const [outletId, setOutletId] = useState('');
  const [mode, setMode] = useState<'analysis' | 'recipe'>('analysis');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [draft, setDraft] = useState<AiDraft | null>(null);
  const [id, setId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function ask(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage('');
    setAnswer('');
    try {
      const res = await fetch('/api/v1/assistant', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question, mode, ...(outletId ? { outletId } : {}) }),
      });
      const body = (await res.json()) as { answer?: string; draft?: AiDraft; error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Could not complete this request.');
      if (body.draft) {
        setDraft(body.draft);
        setId(undefined);
      } else setAnswer(body.answer ?? 'No answer returned.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!draft || busy) return;
    setBusy(true);
    setMessage('');
    try {
      const res = await fetch('/api/v1/assistant/draft', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id,
          draft: {
            ...draft,
            steps: draft.steps.filter((s) => s.trim()),
            checks: draft.checks.filter((s) => s.trim()),
            missingMeasurements: draft.missingMeasurements.filter((s) => s.trim()),
          },
        }),
      });
      const body = (await res.json()) as { id?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Could not save draft.');
      setId(body.id);
      setMessage(
        'Draft saved. Review its measurements and link stock items before publishing in Recipes.',
      );
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <nav className="section-tabs" aria-label="AI modes">
        <button
          className="ghost"
          aria-pressed={mode === 'analysis'}
          onClick={() => setMode('analysis')}
        >
          {role === 'franchise_owner' ? 'My outlet questions' : 'Business questions'}
        </button>
        {central ? (
          <button
            className="ghost"
            aria-pressed={mode === 'recipe'}
            onClick={() => setMode('recipe')}
          >
            Recipe & SOP drafts
          </button>
        ) : null}
      </nav>
      <section className="card">
        <strong>{role === 'franchise_owner' ? 'Your franchise workspace' : 'Report scope'}</strong>
        <p className="muted">{persona.scope}</p>
        {outlets.length > 1 ? (
          <label>
            Outlet
            <select
              value={outletId}
              disabled={busy || mode === 'recipe'}
              onChange={(e) => {
                setOutletId(e.target.value);
                setAnswer('');
              }}
            >
              <option value="">
                {role === 'franchise_owner' ? 'All my outlets' : 'All permitted outlets'}
              </option>
              {outlets.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p>{outlets[0]?.name ?? 'No outlets available yet'}</p>
        )}
      </section>
      {mode === 'analysis' ? (
        <div className="grid" style={{ marginBottom: 20 }}>
          {persona.questions.map((q) => (
            <button
              className="secondary"
              style={{ textAlign: 'left' }}
              disabled={busy}
              key={q}
              onClick={() => setQuestion(q)}
            >
              {q}
            </button>
          ))}
        </div>
      ) : null}
      {!enabled ? (
        <div className="notice">
          AI answers are not connected yet.{' '}
          {central
            ? 'Configure the AI service to enable generation. You can still write and save recipe drafts below.'
            : 'Ask central admin to connect JKSH AI.'}
        </div>
      ) : null}
      <form className="card" onSubmit={(e) => void ask(e)}>
        <label>
          <strong>
            {mode === 'recipe'
              ? 'Your recipe or preparation notes'
              : 'What would you like to understand?'}
          </strong>
          <textarea
            rows={5}
            maxLength={12000}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={
              mode === 'recipe'
                ? 'Paste ingredients, measured quantities, batch yield, portion size and preparation steps. Unknown measurements can stay blank.'
                : persona.questions[0]
            }
          />
        </label>
        <p className="muted">
          {mode === 'recipe'
            ? 'AI drafts require your review. Missing measurements stay unconfirmed; saving a draft does not change stock deductions.'
            : 'Answers use the selected outlet scope. Check the linked reports before acting; AI does not make changes for you.'}
        </p>
        <button disabled={!enabled || busy || question.trim().length < 2}>
          {busy ? 'Working…' : mode === 'recipe' ? 'Generate draft' : 'Ask JKSH'}
        </button>
        {central && mode === 'recipe' ? (
          <button
            type="button"
            className="secondary"
            style={{ marginLeft: 12 }}
            disabled={busy}
            onClick={() => {
              setDraft({ ...blank });
              setId(undefined);
            }}
          >
            Write a draft
          </button>
        ) : null}
      </form>
      {message ? (
        <p role="status" className="notice">
          {message}
        </p>
      ) : null}
      {answer ? (
        <section className="card">
          <h2>JKSH AI answer</h2>
          <p style={{ whiteSpace: 'pre-wrap' }}>{answer}</p>
          <Link href="/reports">View reports →</Link>
        </section>
      ) : null}
      {mode === 'recipe' && draft ? (
        <section className="card">
          <h2>Review draft</h2>
          <div className="grid">
            <label>
              Name
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label>
              Type
              <select
                value={draft.kind}
                disabled={!!id}
                onChange={(e) => setDraft({ ...draft, kind: e.target.value as AiDraft['kind'] })}
              >
                <option value="menu_item">Menu item</option>
                <option value="addon">Add-on</option>
                <option value="intermediate">Prepared base</option>
              </select>
            </label>
            <label>
              Serving size
              <input
                value={draft.serving ?? ''}
                placeholder="Needs measurement"
                onChange={(e) => setDraft({ ...draft, serving: e.target.value || null })}
              />
            </label>
            <label>
              Usable batch yield
              <input
                value={draft.batchYield ?? ''}
                placeholder="Needs measurement"
                onChange={(e) => setDraft({ ...draft, batchYield: e.target.value || null })}
              />
            </label>
          </div>
          <h3>Ingredients & packaging</h3>
          {draft.ingredients.map((ingredient, index) => (
            <div className="grid" key={index} style={{ marginBottom: 12 }}>
              {(['name', 'quantity', 'unit'] as const).map((key) => (
                <label key={key}>
                  {key}
                  <input
                    value={ingredient[key] ?? ''}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        ingredients: draft.ingredients.map((v, i) =>
                          i === index ? { ...v, [key]: e.target.value || null } : v,
                        ),
                      })
                    }
                  />
                </label>
              ))}
              <label>
                Quantity applies to
                <select
                  value={ingredient.basis}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      ingredients: draft.ingredients.map((v, i) =>
                        i === index ? { ...v, basis: e.target.value as typeof v.basis } : v,
                      ),
                    })
                  }
                >
                  <option value="per_serving">One serving</option>
                  <option value="per_batch">Whole batch</option>
                  <option value="unconfirmed">Needs confirmation</option>
                </select>
              </label>
              <button
                className="ghost"
                onClick={() =>
                  setDraft({
                    ...draft,
                    ingredients: draft.ingredients.filter((_, i) => i !== index),
                  })
                }
              >
                Remove
              </button>
            </div>
          ))}
          <button
            className="secondary"
            onClick={() =>
              setDraft({
                ...draft,
                ingredients: [
                  ...draft.ingredients,
                  { name: '', quantity: null, unit: null, basis: 'unconfirmed' },
                ],
              })
            }
          >
            Add ingredient
          </button>
          {(
            [
              { key: 'steps', label: 'Preparation steps' },
              { key: 'checks', label: 'Serving & quality checks' },
              { key: 'missingMeasurements', label: 'Measurements to confirm' },
            ] as const
          ).map(({ key, label }) => (
            <label key={key} style={{ display: 'block', marginTop: 18 }}>
              {label} · one per line
              <textarea
                rows={4}
                value={draft[key].join('\n')}
                onChange={(e) => setDraft({ ...draft, [key]: e.target.value.split('\n') })}
              />
            </label>
          ))}
          <div className="row" style={{ marginTop: 18, gap: 20 }}>
            <button disabled={busy || !draft.name.trim()} onClick={() => void save()}>
              Save draft
            </button>
            <Link href="/stock/ops/recipes">Review & publish in Recipes →</Link>
          </div>
        </section>
      ) : null}
      {central && mode === 'recipe' ? (
        <section className="card">
          <h2>Saved drafts</h2>
          {savedDrafts.length ? (
            savedDrafts.map((r) => (
              <button
                key={r.id}
                className="secondary"
                style={{ margin: 6 }}
                disabled={busy}
                onClick={() => {
                  setDraft(r.draft);
                  setId(r.id);
                  setMessage('');
                }}
              >
                {r.draft.name}
              </button>
            ))
          ) : (
            <p className="muted">No saved drafts yet.</p>
          )}
        </section>
      ) : null}
    </>
  );
}
