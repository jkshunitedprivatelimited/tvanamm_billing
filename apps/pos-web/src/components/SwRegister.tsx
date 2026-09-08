'use client';
import { useEffect } from 'react';

/** Registers the billing terminal's service worker so the app keeps loading
 *  offline. No-ops where service workers are unavailable. */
export function SwRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        /* SW unsupported / blocked — the app still works online */
      });
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);
  return null;
}
