'use client';

/**
 * Tiny promise wrapper over IndexedDB — no dependency. One database with two
 * stores:
 *   kv     — single-row config (menu snapshot, offline-auth bundle, the
 *            reserved receipt-number block, outlet receipt header)
 *   outbox — bills created while the terminal could not reach the server,
 *            keyed by their client idempotency key
 */

const DB_NAME = 'jksh_pos';
const DB_VERSION = 1;
export const KV_STORE = 'kv';
export const OUTBOX_STORE = 'outbox';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(KV_STORE)) db.createObjectStore(KV_STORE);
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
        db.createObjectStore(OUTBOX_STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
  });
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = run(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('indexedDB request failed'));
        t.oncomplete = () => db.close();
      }),
  );
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  try {
    return await tx<T | undefined>(
      KV_STORE,
      'readonly',
      (s) => s.get(key) as IDBRequest<T | undefined>,
    );
  } catch {
    return undefined;
  }
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  try {
    await tx(KV_STORE, 'readwrite', (s) => s.put(value as object, key));
  } catch {
    /* storage disabled / private mode — offline mode simply won't arm */
  }
}

export async function kvDel(key: string): Promise<void> {
  try {
    await tx(KV_STORE, 'readwrite', (s) => s.delete(key));
  } catch {
    /* ignore */
  }
}

export async function outboxPut(entry: { key: string } & Record<string, unknown>): Promise<void> {
  await tx(OUTBOX_STORE, 'readwrite', (s) => s.put(entry));
}

export async function outboxAll<T>(): Promise<T[]> {
  try {
    return await tx<T[]>(OUTBOX_STORE, 'readonly', (s) => s.getAll() as IDBRequest<T[]>);
  } catch {
    return [];
  }
}

export async function outboxDel(key: string): Promise<void> {
  await tx(OUTBOX_STORE, 'readwrite', (s) => s.delete(key));
}
