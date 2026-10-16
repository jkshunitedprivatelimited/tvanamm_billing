import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';
const source = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');
function worker(html: string) {
  const listeners: Record<string, (event: object) => void> = {};
  const cache = {
    addAll: vi.fn().mockResolvedValue(undefined),
    add: vi.fn().mockResolvedValue(undefined),
    put: vi.fn().mockResolvedValue(undefined),
  };
  const fallback = new Response('offline shell');
  const fetch = vi.fn().mockResolvedValue(new Response(html));
  const self = {
    location: { origin: 'https://billing.test' },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn() },
    addEventListener: (name: string, callback: (event: object) => void) => {
      listeners[name] = callback;
    },
  };
  class LocalRequest extends Request {
    constructor(input: string, init?: RequestInit) {
      super(new URL(input, self.location.origin), init);
    }
  }
  runInNewContext(source, {
    self,
    fetch,
    URL,
    Request: LocalRequest,
    caches: { open: async () => cache, match: async () => fallback },
    Set,
    Promise,
  });
  return { listeners, cache, self, fetch, fallback };
}
it('preloads offline JavaScript and CSS before activating the new worker', async () => {
  const w = worker(
    '<script src="/_next/static/page.js"></script><link href="/_next/static/app.css"/><img src="https://other.test/a"/>',
  );
  let done!: Promise<void>;
  w.listeners.install!({
    waitUntil: (promise: Promise<void>) => {
      done = promise;
    },
  });
  await done;
  expect(w.cache.addAll.mock.calls[0]?.[0].map((r: Request) => r.url)).toEqual([
    'https://billing.test/_next/static/page.js',
    'https://billing.test/_next/static/app.css',
  ]);
  expect(w.cache.put).toHaveBeenCalledWith('/pos-offline', expect.any(Response));
  expect(w.self.skipWaiting).toHaveBeenCalledOnce();
});
it('does not activate a worker with a broken offline shell', async () => {
  const w = worker('<h1>Service unavailable</h1>');
  let done!: Promise<void>;
  w.listeners.install!({
    waitUntil: (promise: Promise<void>) => {
      done = promise;
    },
  });
  await expect(done).rejects.toThrow('assets missing');
  expect(w.self.skipWaiting).not.toHaveBeenCalled();
});
it('reopens both billing URLs offline without caching API responses', async () => {
  const w = worker('');
  w.fetch.mockRejectedValue(new Error('offline'));
  for (const path of ['/', '/pos', '/pos-offline']) {
    let result!: Promise<Response>;
    w.listeners.fetch!({
      request: { method: 'GET', url: 'https://billing.test' + path, mode: 'navigate' },
      respondWith: (promise: Promise<Response>) => {
        result = promise;
      },
    });
    expect(await result).toBe(w.fallback);
  }
  const respondWith = vi.fn();
  w.listeners.fetch!({
    request: { method: 'GET', url: 'https://billing.test/api/v1/menu' },
    respondWith,
  });
  expect(respondWith).not.toHaveBeenCalled();
});
