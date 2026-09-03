'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { EmployeeSummary } from '@jksh/contracts';

export function EmployeeManager({
  outletId,
  initialEmployees,
}: {
  outletId: string;
  initialEmployees: EmployeeSummary[];
}) {
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('+91');
  const [initialPin, setInitialPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setCreated(null);
    try {
      const res = await fetch(`/api/outlets/${outletId}/employees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName, phone, initialPin }),
      });
      const body = (await res.json()) as { employeeId?: string; message?: string };
      if (!res.ok || !body.employeeId) {
        setError(body.message ?? 'Could not create the employee.');
        return;
      }
      setCreated(body.employeeId);
      setFullName('');
      setPhone('+91');
      setInitialPin('');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function resetPin(userId: string) {
    const newPin = prompt('New four-digit PIN for this employee:');
    if (!newPin) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/employees/${userId}/pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPin }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { message?: string; details?: { reason?: string } };
        setError(
          body.details?.reason === 'step_up_required'
            ? 'PIN reset needs a fresh sign-in. Sign out and back in, then retry.'
            : (body.message ?? 'Could not reset the PIN.'),
        );
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="card">
        <h2>Add an employee</h2>
        <form onSubmit={create}>
          <label htmlFor="name">Full name</label>
          <input id="name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          <label htmlFor="phone">Mobile number</label>
          <input id="phone" value={phone} onChange={(e) => setPhone(e.target.value.trim())} />
          <label htmlFor="pin">Initial PIN (4 digits)</label>
          <input
            id="pin"
            inputMode="numeric"
            maxLength={4}
            value={initialPin}
            onChange={(e) => setInitialPin(e.target.value.replace(/\D/g, ''))}
          />
          <button type="submit" disabled={busy || initialPin.length !== 4 || fullName.trim().length < 2}>
            {busy ? 'Working…' : 'Create employee'}
          </button>
        </form>
        {created ? <p className="ok">Created. Employee ID: <span className="mono">{created}</span></p> : null}
        {error ? <p className="error">{error}</p> : null}
      </div>

      <div className="card">
        <h2>Employees</h2>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Employee ID</th>
              <th>Phone</th>
              <th>PIN</th>
              <th>State</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {initialEmployees.map((e) => (
              <tr key={e.userId}>
                <td>{e.fullName}</td>
                <td className="mono">{e.employeeId}</td>
                <td>{e.phone}</td>
                <td>{e.pinSet ? 'set' : '—'}</td>
                <td>
                  <span className="pill">{e.lockedUntil ? 'locked' : e.accountState}</span>
                </td>
                <td>
                  <button className="secondary" disabled={busy} onClick={() => void resetPin(e.userId)}>
                    Reset PIN
                  </button>
                </td>
              </tr>
            ))}
            {initialEmployees.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  No employees yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
