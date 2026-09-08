'use client';
import { useRef, useState } from 'react';

interface Turn {
  q: string;
  a: string | null;
  error?: string;
}

const SUGGESTIONS = [
  'How were sales today vs the last 7 days?',
  'Which outlet has the highest net sales this week?',
  'Are discounts or refunds unusually high anywhere?',
  'How many bills are about to leave the 60-day window?',
];

export function AskJksh({ role }: { role: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  async function ask(question: string) {
    const query = question.trim();
    if (!query || busy) return;
    setBusy(true);
    setQ('');
    setTurns((t) => [...t, { q: query, a: null }]);
    try {
      const res = await fetch('/api/v1/assistant', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: query }),
      });
      const body = (await res.json()) as { answer?: string; error?: string };
      setTurns((t) =>
        t.map((turn, i): Turn =>
          i === t.length - 1
            ? {
                q: turn.q,
                a: body.answer ?? null,
                ...(res.ok ? {} : { error: body.error ?? 'Failed' }),
              }
            : turn,
        ),
      );
    } catch {
      setTurns((t) =>
        t.map((turn, i) => (i === t.length - 1 ? { ...turn, error: 'Network error' } : turn)),
      );
    } finally {
      setBusy(false);
      requestAnimationFrame(() => listRef.current?.scrollTo(0, listRef.current.scrollHeight));
    }
  }

  return (
    <>
      <button className="ask-fab" onClick={() => setOpen(true)} aria-label="Ask JKSH">
        Ask&nbsp;JKSH
      </button>

      {open ? (
        <div className="ask-overlay" onClick={() => setOpen(false)}>
          <aside className="ask-panel" onClick={(e) => e.stopPropagation()}>
            <div
              className="spread"
              style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}
            >
              <strong>Ask JKSH</strong>
              <button className="ghost sm" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>

            <div ref={listRef} className="ask-body">
              {turns.length === 0 ? (
                <div className="muted" style={{ fontSize: 13 }}>
                  <p>
                    Read-only assistant. It answers from a live snapshot of your{' '}
                    {role === 'franchise_owner' ? 'outlets’' : 'organisation’s'} sales and retention
                    data, and says so when it can’t.
                  </p>
                  <div className="stack" style={{ gap: 6, marginTop: 10 }}>
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        className="secondary sm"
                        style={{ textAlign: 'left' }}
                        onClick={() => void ask(s)}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {turns.map((t, i) => (
                <div key={i} style={{ marginBottom: 14 }}>
                  <p className="ask-q">{t.q}</p>
                  {t.a ? (
                    <p className="ask-a">{t.a}</p>
                  ) : t.error ? (
                    <p className="error">{t.error}</p>
                  ) : (
                    <p className="muted">
                      <span className="spinner" /> thinking…
                    </p>
                  )}
                </div>
              ))}
            </div>

            <form
              className="ask-input"
              onSubmit={(e) => {
                e.preventDefault();
                void ask(q);
              }}
            >
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Ask about sales, discounts, refunds…"
                style={{ margin: 0 }}
                autoFocus
              />
              <button disabled={busy || !q.trim()}>Ask</button>
            </form>
          </aside>
        </div>
      ) : null}
    </>
  );
}
