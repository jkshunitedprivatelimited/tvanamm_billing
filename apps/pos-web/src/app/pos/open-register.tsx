'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { StaffMenu } from '@/components/StaffMenu';

export function OpenRegister({ outletName }: { outletName: string }) {
  const router = useRouter();
  const [openingCash, setOpeningCash] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/cash-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ openingCash: Number(openingCash).toFixed(2) }),
      });
      const body = (await res.json()) as { message?: string };
      if (!res.ok) {
        setError(body.message ?? 'Could not open the cash session.');
        return;
      }
      router.refresh();
    } catch {
      setError('Could not open the register. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <div className="panel">
        <h1>{outletName}</h1>
        <StaffMenu />
        <p className="muted">Open the shared Cash session to start billing.</p>
        <label htmlFor="opening-cash">Opening Cash amount</label>
        <input
          id="opening-cash"
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={openingCash}
          onChange={(e) => setOpeningCash(e.target.value)}
          placeholder="0.00"
        />
        <button
          disabled={
            busy || !openingCash || !Number.isFinite(Number(openingCash)) || Number(openingCash) < 0
          }
          onClick={() => void submit()}
        >
          Open register
        </button>
        {error ? <p className="error">{error}</p> : null}
      </div>
    </div>
  );
}
