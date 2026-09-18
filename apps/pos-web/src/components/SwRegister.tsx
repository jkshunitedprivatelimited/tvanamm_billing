'use client';
import { useEffect } from 'react';

/** Enables offline loading in production without caching development bundles. */
export function SwRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') {
      // Dev chunk URLs are reused across edits. A cache-first worker can pair
      // old client code with fresh server HTML and cause hydration mismatches.
      void (async () => {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(
          registrations
            .filter((registration) => {
              const worker = registration.active ?? registration.waiting ?? registration.installing;
              return worker?.scriptURL === new URL('/sw.js', window.location.origin).href;
            })
            .map((registration) => registration.unregister()),
        );
        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(
            keys.filter((key) => key.startsWith('jksh-pos-')).map((key) => caches.delete(key)),
          );
        }
      })().catch(() => {
        /* Storage can be blocked by browser settings. */
      });
      return;
    }
    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        /* SW unsupported / blocked — the app still works online */
      });
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
    return () => window.removeEventListener('load', register);
  }, []);
  return null;
}
