/* JKSH Billing terminal service worker.
 * Goal: the app keeps loading with no network. It never caches API calls —
 * offline sales are handled by the app's IndexedDB outbox, not by replaying
 * cached requests.
 *
 * It also never caches or serves stale copies of `/pos`'s own
 * server-rendered HTML (or `/close`'s, etc.). That HTML has a specific
 * employee's name, outlet, and menu baked in; the Cache Storage entry is
 * device-wide, not scoped to whoever is logged in. On a shared terminal,
 * caching it would let a stale page from employee A be replayed after
 * employee B has logged in — and a bill created from that stale render
 * would still carry A's identity. Only public, identity-free routes are
 * cacheable and served as-is when offline.
 *
 * `/pos` gets one narrow exception: when a real navigation to `/pos` fails
 * outright (the device can't reach the app server at all), this worker
 * substitutes the precached `/pos-offline` shell instead of letting the
 * browser show its own offline error. That page carries no baked-in
 * identity of its own — it renders empty and bootstraps everything
 * (menu/employee/outlet) client-side from the IndexedDB offline kit
 * (`offline-store.ts`) after mounting — so the stale-identity risk that
 * rules out caching `/pos` itself doesn't apply to it.
 */
const CACHE = 'jksh-pos-v3';
const SHELL = ['/', '/login', '/pos-offline', '/manifest.webmanifest', '/brand/tvanamm-logo.png'];
const PUBLIC_NAV_PATHS = new Set(['/', '/login']);
const OFFLINE_FALLBACK_PATHS = new Set(['/pos']);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache the API — the app owns offline behaviour.
  if (url.pathname.startsWith('/api/')) return;

  // Static build assets and brand files: cache-first.
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/brand/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
            return res;
          }),
      ),
    );
    return;
  }

  // Navigations / pages. Public, identity-free routes are cached and fall
  // back to a stale copy when offline. `/pos` itself is always network-only
  // (its real response is never cached — see the file header) but falls
  // back to the precached, identity-free `/pos-offline` shell specifically
  // when the network request fails outright. Every other authenticated page
  // (`/close`, `/pos/recovery`, ...) stays fully network-only with no
  // fallback, unchanged.
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    if (OFFLINE_FALLBACK_PATHS.has(url.pathname)) {
      event.respondWith(fetch(request).catch(() => caches.match('/pos-offline')));
      return;
    }
    if (!PUBLIC_NAV_PATHS.has(url.pathname)) return;
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request).then((hit) => hit || caches.match('/'))),
    );
  }
});
