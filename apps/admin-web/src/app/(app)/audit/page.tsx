'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuditEventView } from '@jksh/identity';

const GROUPS: { label: string; prefix: string }[] = [
  { label: 'All', prefix: '' },
  { label: 'Login & sessions', prefix: 'login.' },
  { label: 'Sales', prefix: 'sale.' },
  { label: 'Cash sessions', prefix: 'cash_session.' },
  { label: 'Shifts', prefix: 'shift.' },
  { label: 'Menu', prefix: 'menu.' },
  { label: 'Catalog', prefix: 'catalog.' },
  { label: 'Terminals', prefix: 'terminal.' },
  { label: 'Attendance', prefix: 'attendance.' },
  { label: 'Expenses', prefix: 'expense.' },
  { label: 'Exports', prefix: 'billing.export.' },
];

export default function AuditPage() {
  const [group, setGroup] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [events, setEvents] = useState<AuditEventView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const cursorRef = useRef<string | null>(null);

  const load = useCallback(
    async (append: boolean) => {
      setLoading(true);
      setErr(null);
      const qs = new URLSearchParams();
      if (group) qs.set('action', group);
      if (from) qs.set('from', from);
      if (to) qs.set('to', to);
      if (append && cursorRef.current) qs.set('cursor', cursorRef.current);
      try {
        const res = await fetch(`/api/v1/audit?${qs.toString()}`);
        const body = (await res.json()) as {
          events?: AuditEventView[];
          nextCursor?: string | null;
          message?: string;
        };
        if (!res.ok) {
          setErr(body.message ?? 'Could not load the audit log.');
          return;
        }
        setEvents((prev) => (append ? [...prev, ...(body.events ?? [])] : (body.events ?? [])));
        cursorRef.current = body.nextCursor ?? null;
        setCursor(body.nextCursor ?? null);
      } catch {
        setErr('Could not load the audit log.');
      } finally {
        setLoading(false);
      }
    },
    [group, from, to],
  );

  useEffect(() => {
    cursorRef.current = null;
    void load(false);
  }, [load]);

  return (
    <main>
      <h1>Audit log</h1>
      <p className="page-intro">
        Every security- and money-relevant action, newest first. Franchise Owners see their own
        franchise; Central and Accountant see the whole organisation.
      </p>

      <div className="cat-nav">
        {GROUPS.map((g) => (
          <button
            key={g.label}
            type="button"
            className="cat-chip"
            aria-current={group === g.prefix ? 'page' : undefined}
            style={
              group === g.prefix
                ? {
                    background: 'var(--primary-soft)',
                    borderColor: 'var(--primary)',
                    color: 'var(--primary)',
                  }
                : undefined
            }
            onClick={() => setGroup(g.prefix)}
          >
            {g.label}
          </button>
        ))}
      </div>

      <div className="toolbar card">
        <label>
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        {from || to ? (
          <button
            className="ghost sm"
            onClick={() => {
              setFrom('');
              setTo('');
            }}
          >
            Clear
          </button>
        ) : null}
      </div>

      {err ? <p className="error">{err}</p> : null}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Action</th>
              <th>Result</th>
              <th>Actor</th>
              <th>Outlet</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                  {new Date(e.occurredAt).toLocaleString()}
                </td>
                <td className="mono" style={{ fontSize: 12 }}>
                  {e.action}
                </td>
                <td>
                  <span
                    className={`pill ${
                      e.result === 'success'
                        ? 'ok'
                        : e.result === 'denied' || e.result === 'failure'
                          ? 'danger'
                          : ''
                    }`}
                  >
                    {e.result ?? '—'}
                  </span>
                </td>
                <td>{e.actorName ?? <span className="muted">system</span>}</td>
                <td className="muted">{e.outletName ?? '—'}</td>
                <td className="mono" style={{ fontSize: 11, maxWidth: 340, overflow: 'hidden' }}>
                  {Object.keys(e.metadata).length ? JSON.stringify(e.metadata) : '—'}
                </td>
              </tr>
            ))}
            {!loading && events.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  No matching events.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 12 }}>
        {loading ? (
          <span className="muted">
            <span className="spinner" /> loading…
          </span>
        ) : cursor ? (
          <button className="secondary" onClick={() => void load(true)}>
            Load more
          </button>
        ) : events.length > 0 ? (
          <span className="muted">End of results.</span>
        ) : null}
      </div>
    </main>
  );
}
