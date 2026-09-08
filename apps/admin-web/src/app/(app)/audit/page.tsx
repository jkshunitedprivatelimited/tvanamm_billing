'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuditEventView } from '@jksh/identity';
import { DataTable, type Column } from '@/components/DataTable';

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

/** "sale.refunded" -> "Sale refunded" */
function pretty(action: string): string {
  const s = action.replace(/[._]/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function compactMeta(meta: Record<string, unknown>): string {
  const entries = Object.entries(meta).filter(([k]) => k !== 'result' && k !== 'correlationId');
  if (entries.length === 0) return '—';
  return entries
    .map(([k, v]) => {
      const val =
        v === null || v === undefined
          ? ''
          : typeof v === 'object'
            ? JSON.stringify(v)
            : typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
              ? String(v)
              : '';
      return `${k}: ${val}`;
    })
    .join('  ·  ');
}

const columns: Column<AuditEventView>[] = [
  {
    key: 'occurredAt',
    header: 'When',
    width: '170px',
    nowrap: true,
    sortValue: (e) => e.occurredAt,
    render: (e) => new Date(e.occurredAt).toLocaleString(),
  },
  {
    key: 'action',
    header: 'Action',
    width: 'minmax(180px, 1.3fr)',
    nowrap: true,
    sortValue: (e) => e.action,
    render: (e) => (
      <span title={e.action}>
        {pretty(e.action)}{' '}
        <span className="muted mono" style={{ fontSize: 10 }}>
          {e.action}
        </span>
      </span>
    ),
  },
  {
    key: 'result',
    header: 'Result',
    width: '96px',
    sortValue: (e) => e.result ?? '',
    render: (e) => (
      <span
        className={`pill ${e.result === 'success' ? 'ok' : e.result === 'denied' || e.result === 'failure' ? 'danger' : ''}`}
      >
        {e.result ?? '—'}
      </span>
    ),
  },
  {
    key: 'actor',
    header: 'Actor',
    width: '150px',
    nowrap: true,
    sortValue: (e) => e.actorName ?? '',
    render: (e) => e.actorName ?? <span className="muted">system</span>,
  },
  {
    key: 'outlet',
    header: 'Outlet',
    width: '130px',
    nowrap: true,
    render: (e) => e.outletName ?? '—',
  },
  {
    key: 'detail',
    header: 'Detail',
    width: 'minmax(160px, 1.6fr)',
    nowrap: true,
    render: (e) => compactMeta(e.metadata),
  },
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
        Every security- and money-relevant action. Franchise Owners see their own franchise; Central
        and Accountant see the whole organisation. Click a column header to sort.
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

      <DataTable
        columns={columns}
        rows={events}
        rowKey={(e) => e.id}
        initialSort={{ key: 'occurredAt', dir: 'desc' }}
        empty={loading ? 'Loading…' : 'No matching events.'}
      />

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
