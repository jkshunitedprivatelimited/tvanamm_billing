'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { NotificationView } from '@jksh/contracts';

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${String(min)}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${String(hr)}h ago`;
  return `${String(Math.floor(hr / 24))}d ago`;
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationView[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/notifications');
      const body = (await res.json().catch(() => null)) as {
        notifications?: NotificationView[];
        unreadCount?: number;
      } | null;
      if (res.ok && body) {
        setNotifications(body.notifications ?? []);
        setUnreadCount(body.unreadCount ?? 0);
      }
    } catch {
      // Keep the last successful inbox during transient network failures.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 30_000);
    return () => clearInterval(timer);
  }, [load]);

  async function mark(id: string, what: 'read' | 'resolved') {
    setBusyId(id);
    try {
      await fetch(`/api/v1/notifications/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ what }),
      });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function markAllRead() {
    await fetch('/api/v1/notifications', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'read-all' }),
    });
    await load();
  }

  return (
    <>
      <button
        className="ghost sm notification-trigger"
        aria-label={unreadCount ? `Notifications, ${String(unreadCount)} unread` : 'Notifications'}
        onClick={() => {
          setOpen(true);
          void load();
        }}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
        </svg>
        <span className="notification-label">Notifications</span>
        {unreadCount > 0 ? (
          <span className="badge" style={{ marginLeft: 6, padding: '1px 8px' }}>
            {unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="ask-overlay" onClick={() => setOpen(false)}>
          <aside className="ask-panel" onClick={(e) => e.stopPropagation()}>
            <div
              className="spread"
              style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}
            >
              <strong>Notifications</strong>
              <div className="row" style={{ gap: 8 }}>
                {unreadCount > 0 ? (
                  <button className="ghost sm" onClick={() => void markAllRead()}>
                    Mark all read
                  </button>
                ) : null}
                <button className="ghost sm" onClick={() => setOpen(false)}>
                  Close
                </button>
              </div>
            </div>

            <div className="ask-body">
              {loading && notifications.length === 0 ? <p className="muted">Loading…</p> : null}
              {!loading && notifications.length === 0 ? (
                <p className="muted">Nothing here yet.</p>
              ) : null}
              {notifications.map((n) => (
                <div
                  key={n.id}
                  style={{
                    borderLeft: `3px solid ${
                      n.severity === 'critical'
                        ? 'var(--danger)'
                        : n.severity === 'warning'
                          ? 'var(--warning)'
                          : 'var(--border-strong)'
                    }`,
                    padding: '8px 0 8px 10px',
                    marginBottom: 10,
                    opacity: n.readAt ? 0.6 : 1,
                  }}
                >
                  <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                    <strong style={{ fontSize: 13.5 }}>{n.title}</strong>
                    <span className="muted" style={{ fontSize: 11.5, whiteSpace: 'nowrap' }}>
                      {timeAgo(n.createdAt)}
                    </span>
                  </div>
                  {n.body ? (
                    <p className="muted" style={{ fontSize: 12.5, margin: '4px 0' }}>
                      {n.body}
                    </p>
                  ) : null}
                  {n.eventCount > 1 ? (
                    <p className="muted" style={{ fontSize: 11.5, margin: '2px 0' }}>
                      Happened {n.eventCount} times
                    </p>
                  ) : null}
                  <div className="row" style={{ gap: 8, marginTop: 4 }}>
                    {n.entityType === 'cash_session' && n.outletId ? (
                      <Link
                        href={`/reports?category=cash&outletId=${n.outletId}`}
                        onClick={() => setOpen(false)}
                      >
                        Review closing cash →
                      </Link>
                    ) : null}
                    {n.entityType === 'stock_low' && n.outletId ? (
                      <Link href={`/stock/${n.outletId}/alerts`} onClick={() => setOpen(false)}>
                        View stock alerts →
                      </Link>
                    ) : null}
                    {!n.readAt ? (
                      <button
                        className="ghost sm"
                        disabled={busyId === n.id}
                        onClick={() => void mark(n.id, 'read')}
                      >
                        Mark read
                      </button>
                    ) : null}
                    {!n.resolvedAt ? (
                      <button
                        className="secondary sm"
                        disabled={busyId === n.id}
                        onClick={() => void mark(n.id, 'resolved')}
                      >
                        Resolve
                      </button>
                    ) : (
                      <span className="muted" style={{ fontSize: 11.5 }}>
                        Resolved
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
