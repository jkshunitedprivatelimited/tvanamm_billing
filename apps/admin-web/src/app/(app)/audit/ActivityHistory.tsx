'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuditEventView } from '@jksh/identity';
import Link from 'next/link';
import { ACTIVITY_CATEGORIES } from '@jksh/contracts';

const TITLES: Record<string, string> = {
  'sale.created': 'Bill created',
  'sale.refunded': 'Refund issued',
  'attendance.checked_in': 'Team member checked in',
  'attendance.checked_out': 'Team member checked out',
  'attendance.corrected': 'Attendance corrected',
  'shift.started': 'Billing shift started',
  'shift.ended': 'Billing shift ended',
  'shift.force_closed': 'Billing shift closed by manager',
  'cash_session.opened': 'Cash counter opened',
  'cash_session.closed': 'Cash counter closed',
  'expense.recorded': 'Expense added',
  'expense.reviewed': 'Expense reviewed',
  'expense.reversed': 'Expense reversed',
  'workspace.selected': 'Workspace opened',
  'login.succeeded': 'Signed in',
  'login.failed': 'Sign-in unsuccessful',
  'catalog.item_created': 'Menu item added',
  'catalog.item_updated': 'Menu item updated',
  'menu.publication_applied': 'Menu update applied',
  'employee.created': 'Team member added',
};
function pretty(text: string) {
  const words = text.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[._]/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
function display(value: unknown): string {
  if (value == null) return 'Not recorded';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return JSON.stringify(value);
}
function ActivityCard({ event, isCentral }: { event: AuditEventView; isCentral: boolean }) {
  const attention = event.result === 'failure' || event.result === 'denied';
  const entries = Object.entries(event.metadata).filter(
    ([key]) => !['result', 'correlationId'].includes(key),
  );
  const facts = entries.filter(([key, value]) => !/id$/i.test(key) && typeof value !== 'object');
  const references = entries.filter(
    ([key, value]) => /id$/i.test(key) || typeof value === 'object',
  );
  const section = /^(attendance|shift|employee|login|operator|pin)\./.test(event.action)
    ? 'Team'
    : /^(sale|expense|cash_session|bill)\./.test(event.action)
      ? 'Sales & money'
      : /^(menu|catalog|offer)\./.test(event.action)
        ? 'Menu'
        : 'Account & devices';
  return (
    <article className={`activity-card ${attention ? 'activity-attention' : ''}`}>
      <div className="activity-marker" aria-hidden="true">
        {section === 'Sales & money'
          ? '₹'
          : section === 'Team'
            ? '◎'
            : section === 'Menu'
              ? '≡'
              : '◇'}
      </div>
      <div className="activity-content">
        <div className="activity-topline">
          <span className="activity-category">{section}</span>
          <time dateTime={event.occurredAt}>
            {new Date(event.occurredAt).toLocaleString('en-IN', {
              day: 'numeric',
              month: 'short',
              hour: 'numeric',
              minute: '2-digit',
            })}
          </time>
        </div>
        <h3>{TITLES[event.action] ?? pretty(event.action)}</h3>
        <p className="activity-context">
          <strong>{event.actorName ?? 'Automatic system action'}</strong>
          <span> · </span>
          {event.outletName ?? (isCentral ? 'Organization account' : 'Your account')}
        </p>
        {attention ? (
          <span className="pill danger">
            {event.result === 'denied' ? 'Action not permitted' : 'Unsuccessful'}
          </span>
        ) : null}
        {facts.length ? (
          <dl className="activity-facts">
            {facts.slice(0, 4).map(([key, value]) => (
              <div key={key}>
                <dt>{pretty(key)}</dt>
                <dd>{display(value)}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        <details className="activity-details">
          <summary>Full activity details</summary>
          <dl className="activity-facts">
            <div>
              <dt>Recorded at</dt>
              <dd>{new Date(event.occurredAt).toLocaleString()}</dd>
            </div>
            <div>
              <dt>Outcome</dt>
              <dd>{event.result ? pretty(event.result) : 'Recorded'}</dd>
            </div>
            {facts.slice(4).map(([key, value]) => (
              <div key={key}>
                <dt>{pretty(key)}</dt>
                <dd>{display(value)}</dd>
              </div>
            ))}
          </dl>
          {event.outletId ? (
            <Link
              href={`/outlets/${event.outletId}?section=${event.action.startsWith('expense.') ? 'expenses' : section === 'Team' ? 'attendance' : 'billing'}`}
            >
              Open outlet →
            </Link>
          ) : null}
          <details className="activity-reference">
            <summary>Support reference</summary>
            <dl>
              {references.map(([key, value]) => (
                <div key={key}>
                  <dt>{pretty(key)}</dt>
                  <dd>{display(value)}</dd>
                </div>
              ))}
              <div>
                <dt>Event reference</dt>
                <dd>{event.id}</dd>
              </div>
              {isCentral ? (
                <>
                  <div>
                    <dt>Event type</dt>
                    <dd>{event.action}</dd>
                  </div>
                  <div>
                    <dt>Correlation reference</dt>
                    <dd>{event.correlationId}</dd>
                  </div>
                </>
              ) : null}
            </dl>
          </details>
        </details>
      </div>
    </article>
  );
}

export function ActivityHistory({
  outlets,
  isCentral,
}: {
  outlets: { id: string; name: string }[];
  isCentral: boolean;
}) {
  const [outletId, setOutletId] = useState(outlets.length === 1 ? (outlets[0]?.id ?? '') : '');
  const requestRef = useRef<AbortController | null>(null);
  const [group, setGroup] = useState(isCentral ? 'all' : 'business');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [events, setEvents] = useState<AuditEventView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const cursorRef = useRef<string | null>(null);

  const load = useCallback(
    async (append: boolean) => {
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      if (!append) {
        setEvents([]);
        setCursor(null);
      }
      if (from && to && from > to) {
        setErr('Choose an end date on or after the start date.');
        setLoading(false);
        return;
      }
      setLoading(true);
      setErr(null);
      const qs = new URLSearchParams();
      if (outletId) qs.set('outletId', outletId);
      if (group !== 'all') qs.set('category', group);
      if (from) qs.set('from', from);
      if (to) qs.set('to', to);
      if (append && cursorRef.current) qs.set('cursor', cursorRef.current);
      try {
        const res = await fetch(`/api/v1/audit?${qs.toString()}`, { signal: controller.signal });
        const body = (await res.json()) as {
          events?: AuditEventView[];
          nextCursor?: string | null;
          message?: string;
        };
        if (controller.signal.aborted) return;
        if (!res.ok) {
          setErr(body.message ?? 'Could not load the audit log.');
          return;
        }
        setEvents((prev) => (append ? [...prev, ...(body.events ?? [])] : (body.events ?? [])));
        cursorRef.current = body.nextCursor ?? null;
        setCursor(body.nextCursor ?? null);
      } catch {
        if (!controller.signal.aborted) setErr('Could not load activity history. Please retry.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [group, from, to, outletId],
  );

  useEffect(() => {
    cursorRef.current = null;
    void load(false);
    return () => requestRef.current?.abort();
  }, [load]);

  return (
    <main>
      <div className="workspace-heading">
        <div>
          <p className="eyebrow">
            {isCentral ? 'Central admin · Oversight' : 'Your business · Recent changes'}
          </p>
          <h1>{isCentral ? 'Organization change history' : 'Outlet change history'}</h1>
        </div>
        <button className="secondary" disabled={loading} onClick={() => void load(false)}>
          Refresh activity
        </button>
      </div>
      <p className="page-intro">
        {isCentral
          ? 'Review business changes, team access and account activity across all outlets.'
          : 'Follow sales, spending and team activity across your outlets. Open an event to see who did what and when.'}
      </p>
      <div className="activity-category-bar" aria-label="Activity categories">
        {(isCentral
          ? [
              { key: 'all', label: 'All activity' },
              ...Object.entries(ACTIVITY_CATEGORIES)
                .filter(([key]) => key !== 'business')
                .map(([key, value]) => ({ key, label: value.label })),
            ]
          : Object.entries(ACTIVITY_CATEGORIES).map(([key, value]) => ({ key, label: value.label }))
        ).map((g) => (
          <button
            key={g.key}
            className="activity-filter"
            aria-pressed={group === g.key}
            onClick={() => setGroup(g.key)}
          >
            {g.label}
          </button>
        ))}
      </div>
      <div className="toolbar card">
        {outlets.length === 1 ? (
          <div className="single-outlet-context">
            <span className="muted">Outlet</span>
            <strong>{outlets[0]?.name}</strong>
          </div>
        ) : (
          <label>
            Outlet
            <select value={outletId} onChange={(e) => setOutletId(e.target.value)}>
              <option value="">All accessible outlets</option>
              {outlets.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          To
          <input type="date" min={from} value={to} onChange={(e) => setTo(e.target.value)} />
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

      {err ? (
        <div role="alert" className="error">
          {err}{' '}
          <button className="secondary sm" onClick={() => void load(false)}>
            Retry
          </button>
        </div>
      ) : null}

      <div className="activity-feed" aria-busy={loading}>
        {events.map((event) => (
          <ActivityCard key={event.id} event={event} isCentral={isCentral} />
        ))}
        {!events.length ? (
          <div className="activity-empty card">
            <div className="activity-marker" aria-hidden="true">
              ◎
            </div>
            <h2>{loading ? 'Loading activity…' : 'No activity in this view yet'}</h2>
            <p className="muted">
              {loading
                ? 'Finding events for the selected outlets.'
                : 'Bills, expenses and team changes appear here as they happen. Try another category or date range.'}
            </p>
            {!loading && group === 'business' ? (
              <button className="secondary" onClick={() => setGroup('team')}>
                View team sign-ins & attendance
              </button>
            ) : null}
          </div>
        ) : null}
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
