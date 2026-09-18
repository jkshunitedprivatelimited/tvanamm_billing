'use client';
import { useEffect, useState } from 'react';
import { PosClient } from '../pos/pos-client';
import { kitUsable, readOfflineKit, type OfflineKit } from '@/lib/offline-store';

/**
 * The offline fallback shell for `/pos`. `/pos/page.tsx` is a Server
 * Component that does live Postgres reads on every navigation, so when the
 * device can't reach the app server at all there is nothing for it to
 * render. The service worker (`public/sw.js`) substitutes this page for a
 * failed navigation to `/pos` instead - it has no server data-fetching of
 * its own (same pattern as `pos/recovery/page.tsx`), so it can be precached
 * and rendered with zero network, then bootstraps itself from whatever a
 * prior online session already cached in IndexedDB.
 *
 * This is why the identity-leak concern that keeps `/pos` itself uncached
 * doesn't apply here: this document has no employee/outlet baked into its
 * HTML at all - everything renders from `readOfflineKit()`, so caching *this*
 * page carries no stale-identity risk the way caching real `/pos` HTML would.
 *
 * `kitUsable()` is the same 24h-bounded gate (`authExpiresAt`/
 * `blockExpiresAt`) already used to decide whether an offline sale can be
 * authorised at all - reused here as-is rather than inventing a separate
 * staleness rule. The outlet-billing-window / open-cash-session / open-shift
 * checks `pos/page.tsx` normally does are not repeated here: a usable kit
 * only ever exists because a prior `PosClient` mount already passed every one
 * of those checks online (priming only ever runs from inside an
 * already-rendered `PosClient`), so that invariant is relied on rather than
 * re-implemented offline.
 */
type ShellState =
  { status: 'loading' } | { status: 'unavailable' } | { status: 'ready'; kit: OfflineKit };

export default function PosOfflineShell() {
  const [state, setState] = useState<ShellState>({ status: 'loading' });

  useEffect(() => {
    void readOfflineKit().then((k) => {
      setState(
        kitUsable(k) && k?.employeeId && k.employeeName
          ? { status: 'ready', kit: k }
          : { status: 'unavailable' },
      );
    });
  }, []);

  if (state.status === 'loading') return null;

  if (state.status === 'unavailable') {
    return (
      <main className="pos">
        <div className="panel">
          <h1>You&apos;re offline</h1>
          <p className="muted">
            This device has no usable cached session. Reconnect to the network to sign in and
            continue.
          </p>
        </div>
      </main>
    );
  }

  const { kit: k } = state;
  return (
    <>
      <div
        className="statusbar"
        style={{ borderRadius: 0, borderBottom: '1px solid var(--border)' }}
      >
        <span>Offline — showing the menu cached at {new Date(k.savedAt).toLocaleString()}</span>
      </div>
      <PosClient
        menu={k.menu}
        employeeId={k.employeeId}
        employeeName={k.employeeName}
        outletName={k.outletName}
      />
    </>
  );
}
