'use client';
import { useCallback, useEffect, useState } from 'react';
import type { AttendanceSessionView } from '@jksh/contracts';

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function fmtDuration(min: number | null): string {
  if (min == null) return '—';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${String(h)}h ${String(m)}m` : `${String(m)}m`;
}
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function AttendancePanel({ outletId }: { outletId: string }) {
  const [date, setDate] = useState(todayIso());
  const [sessions, setSessions] = useState<AttendanceSessionView[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [correcting, setCorrecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [outTime, setOutTime] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/v1/outlets/${outletId}/attendance?businessDate=${date}`);
      const body = (await res.json()) as { sessions?: AttendanceSessionView[]; message?: string };
      if (!res.ok) {
        setErr(body.message ?? 'Could not load attendance.');
        setSessions([]);
      } else {
        setSessions(body.sessions ?? []);
      }
    } catch {
      setErr('Could not load attendance.');
    } finally {
      setLoading(false);
    }
  }, [outletId, date]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submitCorrection(sessionId: string) {
    if (!reason.trim() || !outTime) return;
    const iso = new Date(`${date}T${outTime}:00`).toISOString();
    const res = await fetch(`/api/v1/attendance/${sessionId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ checkedOutAt: iso, reason: reason.trim() }),
    });
    if (res.ok) {
      setCorrecting(null);
      setReason('');
      setOutTime('');
      await load();
    } else {
      const b = (await res.json().catch(() => ({}))) as { message?: string };
      setErr(b.message ?? 'Correction failed.');
    }
  }

  const present = sessions.length;
  const late = sessions.filter((s) => s.isLate).length;
  const openNow = sessions.filter((s) => s.status === 'open').length;
  const missing = sessions.filter((s) => s.status === 'missing_checkout').length;

  return (
    <section className="card">
      <div className="spread">
        <h2 style={{ margin: 0 }}>Attendance &amp; shift times</h2>
        <input
          type="date"
          value={date}
          max={todayIso()}
          onChange={(e) => setDate(e.target.value)}
          style={{ width: 'auto', margin: 0 }}
        />
      </div>
      <p className="muted" style={{ fontSize: 13 }}>
        Check-in / check-out is the employee&apos;s clock for the day. Late is measured against the
        outlet schedule. Review only — not a payroll input.
      </p>

      {!loading && sessions.length > 0 ? (
        <div className="row wrap" style={{ gap: 16, marginBottom: 10 }}>
          <span>
            <strong>{present}</strong> <span className="muted">present</span>
          </span>
          <span>
            <strong>{openNow}</strong> <span className="muted">still clocked in</span>
          </span>
          {late > 0 ? (
            <span className="status-warning">
              <strong>{late}</strong> late
            </span>
          ) : null}
          {missing > 0 ? (
            <span className="status-danger">
              <strong>{missing}</strong> missing check-out
            </span>
          ) : null}
        </div>
      ) : null}

      {err ? <p className="error">{err}</p> : null}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Employee</th>
              <th>Check-in</th>
              <th>Check-out</th>
              <th>Worked</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id}>
                <td>{s.employeeName}</td>
                <td className={s.isLate ? 'status-warning' : undefined}>
                  {fmtTime(s.checkedInAt)}
                  {s.isLate ? ' · late' : ''}
                </td>
                <td>{fmtTime(s.checkedOutAt)}</td>
                <td className="num">{fmtDuration(s.durationMinutes)}</td>
                <td>
                  <span
                    className={`pill ${s.status === 'closed' ? 'ok' : s.status === 'open' ? 'info' : 'danger'}`}
                  >
                    {s.status.replace('_', ' ')}
                  </span>
                  {s.corrections.length > 0 ? (
                    <span className="muted" style={{ fontSize: 11 }}>
                      {' '}
                      · corrected
                    </span>
                  ) : null}
                </td>
                <td>
                  {s.status === 'missing_checkout' ? (
                    <button
                      className="secondary sm"
                      onClick={() => setCorrecting(correcting === s.id ? null : s.id)}
                    >
                      {correcting === s.id ? 'Cancel' : 'Set check-out'}
                    </button>
                  ) : null}
                  {correcting === s.id ? (
                    <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
                      <input
                        type="time"
                        value={outTime}
                        onChange={(e) => setOutTime(e.target.value)}
                        style={{ width: 'auto', margin: 0 }}
                      />
                      <input
                        placeholder="Reason"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        style={{ margin: 0 }}
                      />
                      <button
                        className="sm"
                        disabled={!reason.trim() || !outTime}
                        onClick={() => void submitCorrection(s.id)}
                      >
                        Save
                      </button>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
            {!loading && sessions.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  {err ? 'Unavailable.' : 'No check-ins for this date.'}
                </td>
              </tr>
            ) : null}
            {loading ? (
              <tr>
                <td colSpan={6} className="muted">
                  Loading…
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
