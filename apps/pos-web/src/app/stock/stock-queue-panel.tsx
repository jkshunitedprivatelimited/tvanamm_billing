'use client';
import { createContext, useContext, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useStockQueue, type QueuedStockAction } from '@/lib/stock-queue';

type Queue = ReturnType<typeof useStockQueue>;
const QueueContext = createContext<Queue | null>(null);

/** Queue access for stock forms; null outside the provider (no offline saving). */
export function useStockActionQueue(): Queue | null {
  return useContext(QueueContext);
}

export function StockQueueProvider({
  employeeId,
  children,
}: {
  employeeId: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const queue = useStockQueue(employeeId, () => router.refresh());
  return (
    <QueueContext.Provider value={queue}>
      <StockQueuePanel queue={queue} />
      {children}
    </QueueContext.Provider>
  );
}

function when(a: QueuedStockAction) {
  return new Date(a.queuedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function StockQueuePanel({ queue }: { queue: Queue }) {
  const rejected = queue.mine.filter((a) => a.rejected);
  if (!queue.mine.length && !queue.others) return null;
  return (
    <section className="card" role="status" style={{ marginBottom: 16 }}>
      {queue.pending ? (
        <>
          <h2>Saved on this device · {queue.pending} waiting to send</h2>
          <p>
            These entries will send automatically when the internet is back. Don’t enter them again.
          </p>
          {queue.mine
            .filter((a) => !a.rejected)
            .map((a) => (
              <p key={a.key} style={{ margin: '4px 0' }}>
                {a.label} <small className="muted">· saved {when(a)}</small>
              </p>
            ))}
          <button
            className="secondary sm"
            disabled={queue.syncing}
            onClick={() => void queue.flush()}
          >
            {queue.syncing ? 'Sending…' : 'Send now'}
          </button>
        </>
      ) : null}
      {rejected.length ? (
        <>
          <h2 style={{ marginTop: queue.pending ? 16 : 0 }}>Not accepted</h2>
          <p>The server refused these entries. Check them and enter them again if needed.</p>
          {rejected.map((a) => (
            <p key={a.key} style={{ margin: '4px 0' }}>
              {a.label} — <span className="error">{a.rejected}</span>{' '}
              <button className="ghost sm" onClick={() => void queue.dismiss(a.key)}>
                Dismiss
              </button>
            </p>
          ))}
        </>
      ) : null}
      {queue.others ? (
        <p className="muted">
          {queue.others} entr{queue.others === 1 ? 'y' : 'ies'} saved by another employee on this
          device will send when they sign in.
        </p>
      ) : null}
    </section>
  );
}
