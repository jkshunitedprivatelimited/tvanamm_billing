'use client';
import { useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
export function DashboardRefresh() {
  const router = useRouter();
  const [pending, start] = useTransition();
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };
    const timer = window.setInterval(refresh, 60000);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [router]);
  return (
    <button className="secondary" disabled={pending} onClick={() => start(() => router.refresh())}>
      {pending ? 'Updating…' : 'Refresh overview'}
    </button>
  );
}
