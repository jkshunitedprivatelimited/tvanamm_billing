'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

/** Owner cancel for an order that has not been paid. Paid orders go through Central. */
export function CancelOrderButton({
  orderId,
  orderNumber,
}: {
  orderId: string;
  orderNumber: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function cancel() {
    const reason = window.prompt(`Cancel order ${orderNumber}? Enter the reason:`)?.trim();
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/stock/orders/${orderId}/cancel`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ submissionId: crypto.randomUUID(), reason }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) throw new Error(body.message ?? 'Could not cancel the order.');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not cancel the order.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button className="ghost" disabled={busy} onClick={() => void cancel()}>
        {busy ? 'Cancelling…' : 'Cancel order'}
      </button>
      {error ? <p className="error">{error}</p> : null}
    </>
  );
}
