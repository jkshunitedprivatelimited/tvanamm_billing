'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { EmployeeSummary, OutletSummary, Role, TerminalSummary } from '@jksh/contracts';

const LIFECYCLE: Record<string, { action: string; label: string }[]> = {
  draft: [{ action: 'activate', label: 'Activate' }],
  active: [
    { action: 'suspend', label: 'Suspend' },
    { action: 'close', label: 'Close' },
  ],
  suspended: [
    { action: 'reactivate', label: 'Reactivate' },
    { action: 'close', label: 'Close' },
  ],
  closed: [],
};

export function OutletDetail({
  role,
  outlet,
  initialTerminals,
  initialEmployees,
}: {
  role: Role;
  outlet: OutletSummary;
  initialTerminals: TerminalSummary[];
  initialEmployees: EmployeeSummary[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const isCentral = role === 'central_admin';

  async function call(path: string, method: string, body?: unknown): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!res.ok) {
        const b = (await res.json()) as { message?: string; details?: { reason?: string } };
        setError(
          b.details?.reason === 'fresh_auth_required'
            ? 'This needs a fresh sign-in. Sign out and back in, then retry.'
            : (b.message ?? 'Request failed.'),
        );
        return false;
      }
      return true;
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {error ? <p className="error">{error}</p> : null}

      {isCentral ? (
        <div className="card">
          <h2>Lifecycle</h2>
          <p className="muted">Current status: {outlet.status}</p>
          {(LIFECYCLE[outlet.status] ?? []).map((l) => (
            <button
              key={l.action}
              className="secondary"
              style={{ marginRight: 8 }}
              disabled={busy}
              onClick={() => {
                if (l.action === 'suspend' || l.action === 'close') {
                  if (!confirm(`${l.label} this outlet? Its terminal will be revoked.`)) return;
                }
                void call(`/api/v1/outlets/${outlet.id}/status`, 'PATCH', {
                  action: l.action,
                  reason: `${l.label} from admin console`,
                }).then((ok) => ok && router.refresh());
              }}
            >
              {l.label}
            </button>
          ))}
          {(LIFECYCLE[outlet.status] ?? []).length === 0 ? <span className="muted">No actions.</span> : null}
        </div>
      ) : null}

      <div className="card">
        <h2>Terminal</h2>
        <p className="muted">
          One active terminal per outlet. Issue a code, enter it on the device at{' '}
          <span className="mono">/register</span>. Registering a replacement revokes the previous.
        </p>
        <button
          disabled={busy || outlet.status !== 'active'}
          onClick={() => {
            void fetch(`/api/v1/outlets/${outlet.id}/terminals/enroll`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ label: 'Counter terminal' }),
            }).then(async (res) => {
              if (res.ok) {
                setCode(((await res.json()) as { code: string }).code);
                router.refresh();
              } else {
                setError(((await res.json()) as { message?: string }).message ?? 'Failed.');
              }
            });
          }}
        >
          Issue activation code
        </button>
        {outlet.status !== 'active' ? <span className="muted"> — outlet must be active</span> : null}
        {code ? (
          <p className="ok">
            Enter within 60 min: <span className="mono" style={{ fontSize: 18 }}>{code}</span>
          </p>
        ) : null}
        <table style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Prefix</th>
              <th>Paper</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {initialTerminals.map((t) => (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td className="mono">{t.receiptPrefix}</td>
                <td>{t.paperWidthMm}mm</td>
                <td>
                  <span className="pill">{t.status}</span>
                </td>
                <td>
                  {t.status !== 'revoked' ? (
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => {
                        if (!confirm('Revoke this terminal?')) return;
                        void call(`/api/v1/terminals/${t.id}/revoke`, 'POST', {
                          reason: 'revoked from admin console',
                        }).then((ok) => ok && router.refresh());
                      }}
                    >
                      Revoke
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
            {initialTerminals.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  No terminal yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <EmployeeSection
        outletId={outlet.id}
        employees={initialEmployees}
        busy={busy}
        onCall={call}
      />
    </>
  );
}

function EmployeeSection({
  outletId,
  employees,
  busy,
  onCall,
}: {
  outletId: string;
  employees: EmployeeSummary[];
  busy: boolean;
  onCall: (p: string, m: string, b?: unknown) => Promise<boolean>;
}) {
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [mobile, setMobile] = useState('+91');
  const [pin, setPin] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="card">
      <h2>Employees</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void fetch(`/api/v1/outlets/${outletId}/employees`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fullName, mobile, initialPin: pin }),
          }).then(async (res) => {
            if (res.ok) {
              const b = (await res.json()) as { employeeCode: string };
              setMsg(`Created ${b.employeeCode}`);
              setFullName('');
              setMobile('+91');
              setPin('');
              router.refresh();
            } else {
              setMsg(((await res.json()) as { message?: string }).message ?? 'Failed.');
            }
          });
        }}
      >
        <label htmlFor="en">Full name</label>
        <input id="en" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        <label htmlFor="em">Mobile</label>
        <input id="em" value={mobile} onChange={(e) => setMobile(e.target.value.trim())} />
        <label htmlFor="ep">Initial PIN</label>
        <input
          id="ep"
          inputMode="numeric"
          maxLength={4}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
        />
        <button type="submit" disabled={busy || pin.length !== 4 || fullName.trim().length < 2}>
          Add employee
        </button>
      </form>
      {msg ? <p className="ok">{msg}</p> : null}

      <table style={{ marginTop: 12 }}>
        <thead>
          <tr>
            <th>Name</th>
            <th>Code</th>
            <th>PIN</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {employees.map((e) => (
            <tr key={e.id}>
              <td>{e.fullName}</td>
              <td className="mono">{e.employeeCode}</td>
              <td>{e.pinSet ? 'set' : '—'}</td>
              <td>
                <span className="pill">{e.lockedUntil ? 'locked' : e.status}</span>
              </td>
              <td style={{ display: 'flex', gap: 6 }}>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => {
                    const p = prompt('New four-digit PIN:');
                    if (p) void onCall(`/api/v1/employees/${e.id}/reset-pin`, 'POST', { newPin: p }).then((ok) => ok && router.refresh());
                  }}
                >
                  Reset PIN
                </button>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void onCall(`/api/v1/employees/${e.id}/status`, 'PATCH', {
                      status: e.status === 'active' ? 'disabled' : 'active',
                    }).then((ok) => ok && router.refresh())
                  }
                >
                  {e.status === 'active' ? 'Disable' : 'Reactivate'}
                </button>
              </td>
            </tr>
          ))}
          {employees.length === 0 ? (
            <tr>
              <td colSpan={5} className="muted">
                No employees yet.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
