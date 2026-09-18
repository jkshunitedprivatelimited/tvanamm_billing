'use client';

import { useCallback, useEffect, useState } from 'react';

interface Session {
  id: string;
  checkedInAt: string;
}

export function AttendanceControl() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/attendance', { cache: 'no-store' });
      if (!res.ok)
        throw new Error('Could not load attendance. Sign in again if your session expired.');
      const body = (await res.json()) as { session: Session | null };
      setSession(body.session);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connect to the internet to view attendance.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const refresh = () => void load();
    window.addEventListener('online', refresh);
    window.addEventListener('attendance-updated', refresh);
    return () => {
      window.removeEventListener('online', refresh);
      window.removeEventListener('attendance-updated', refresh);
    };
  }, [load]);

  async function record() {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const res = await fetch(session ? '/api/v1/attendance/check-out' : '/api/v1/attendance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deviceTime: new Date().toISOString() }),
      });
      const body = (await res.json()) as { message?: string };
      if (!res.ok) throw new Error(body.message ?? 'Attendance could not be saved.');
      setNotice(
        session
          ? 'Checked out. Your attendance is saved.'
          : 'Checked in. Your attendance is saved.',
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connect to the internet and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="attendance-control">
      <span className="muted">
        {loading
          ? 'Loading attendance…'
          : session
            ? 'Attendance: checked in'
            : 'Attendance: not checked in'}
      </span>
      {error ? (
        <button className="ghost" onClick={() => void load()} disabled={busy}>
          Retry attendance
        </button>
      ) : (
        <button className="ghost" onClick={() => void record()} disabled={loading || busy}>
          {busy ? 'Saving…' : session ? 'Check out' : 'Check in'}
        </button>
      )}
      {error || notice ? (
        <span role="status" className={error ? 'error' : 'muted'}>
          {error ?? notice}
        </span>
      ) : null}
    </div>
  );
}
