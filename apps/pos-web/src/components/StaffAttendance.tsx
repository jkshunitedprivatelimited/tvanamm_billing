'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { listOutboxBills } from '@/lib/offline-store';

interface Staff {
  id: string;
  name: string;
  checkedIn: boolean;
  shiftOpen: boolean;
  isCurrentCashier: boolean;
}
export function StaffAttendance() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [selected, setSelected] = useState<Staff | null>(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function load() {
    const res = await fetch('/api/v1/staff', { cache: 'no-store' });
    if (!res.ok) throw new Error('Could not load staff. Please try again.');
    const body = (await res.json()) as { staff: Staff[] };
    setStaff(body.staff);
  }
  async function show() {
    setOpen(true);
    setBusy(true);
    setMessage('');
    try {
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not load staff.');
    } finally {
      setBusy(false);
    }
  }
  async function record() {
    if (!selected) return;
    setBusy(true);
    setMessage('');
    try {
      if (selected.checkedIn || selected.shiftOpen) {
        const pending = (await listOutboxBills()).some((bill) => bill.status !== 'synced');
        if (pending) throw new Error('Sync pending bills before checking out.');
      }
      const res = await fetch('/api/v1/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: selected.id,
          pin,
          action: selected.checkedIn || selected.shiftOpen ? 'check-out' : 'check-in',
        }),
      });
      const body = (await res.json()) as { message?: string };
      if (!res.ok) throw new Error(body.message ?? 'Could not save attendance.');
      setMessage(
        `${selected.name}: ${selected.checkedIn || selected.shiftOpen ? 'shift finished and checked out' : 'checked in'}. Attendance saved.`,
      );
      setSelected(null);
      window.dispatchEvent(new Event('attendance-updated'));
      await load();
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Connect to the internet and try again.');
    } finally {
      setPin('');
      setBusy(false);
    }
  }
  return (
    <div>
      <button className="ghost" onClick={() => void show()} disabled={busy}>
        Staff attendance
      </button>
      {open ? (
        <section
          className="panel"
          style={{ width: 'auto', margin: '12px 0' }}
          aria-label="Staff attendance"
        >
          <h2>Staff attendance</h2>
          <p className="muted">
            Use your own PIN. Checkout finishes your shift and attendance; the register stays open.
          </p>
          {busy ? <p role="status">Please wait…</p> : null}
          {!selected ? (
            <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
              {staff.map((person) =>
                person.isCurrentCashier ? (
                  <Link key={person.id} className="link-btn" href="/close">
                    {person.name} · Finish my shift
                  </Link>
                ) : (
                  <button
                    key={person.id}
                    className="ghost"
                    disabled={busy}
                    onClick={() => {
                      setSelected(person);
                      setPin('');
                      setMessage('');
                    }}
                  >
                    {person.name} · {person.checkedIn ? 'Checked in' : 'Not checked in'}
                  </button>
                ),
              )}
            </div>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void record();
              }}
            >
              <p>
                {selected.name} —{' '}
                {selected.checkedIn || selected.shiftOpen ? 'Finish shift & check out' : 'Check in'}
              </p>
              {selected.checkedIn || selected.shiftOpen ? (
                <label style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                  <input type="checkbox" required style={{ width: 'auto' }} />I have recorded all my
                  expenses and synced my bills. Finish my shift and attendance.
                </label>
              ) : null}
              <label htmlFor="staff-pin">Your four-digit PIN</label>
              <input
                id="staff-pin"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={4}
                value={pin}
                onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
              />
              <button disabled={busy || pin.length !== 4}>
                Confirm {selected.checkedIn || selected.shiftOpen ? 'check-out' : 'check-in'}
              </button>
              <button
                type="button"
                className="ghost"
                disabled={busy}
                onClick={() => {
                  setSelected(null);
                  setPin('');
                }}
              >
                Choose another employee
              </button>
            </form>
          )}
          {message ? <p role="status">{message}</p> : null}
          <button
            className="ghost"
            disabled={busy}
            onClick={() => {
              setOpen(false);
              setSelected(null);
              setPin('');
            }}
          >
            Done
          </button>
        </section>
      ) : null}
    </div>
  );
}
