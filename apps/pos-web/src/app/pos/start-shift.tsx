'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { StaffMenu } from '@/components/StaffMenu';

export function StartShift({
  outletName,
  employeeName,
}: {
  outletName: string;
  employeeName: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function start() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/v1/shifts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const body = (await res.json()) as { message?: string };
      if (!res.ok) throw new Error(body.message ?? 'Could not start shift.');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connect to the internet and try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="screen">
      <div className="panel">
        <h1>{outletName}</h1>
        <h2>Hello, {employeeName}</h2>
        <p>The shared register is already open. Opening cash has already been recorded.</p>
        <p className="muted">
          Confirm your billing shift to start making sales. Attendance is recorded separately.
        </p>
        <button disabled={busy} onClick={() => void start()}>
          {busy ? 'Starting…' : 'Start my shift'}
        </button>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        <StaffMenu />
        <a className="link-btn" href="/close">
          Finish
        </a>
      </div>
    </div>
  );
}
