'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

const RANGES: { key: string; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'last7', label: 'Last 7 days' },
  { key: 'last30', label: 'Last 30 days' },
];

export function RangeTabs({
  current,
  customFrom,
  customTo,
}: {
  current: string;
  customFrom?: string;
  customTo?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const [showCustom, setShowCustom] = useState(current === 'custom');
  const [from, setFrom] = useState(customFrom ?? '');
  const [to, setTo] = useState(customTo ?? '');

  function applyCustom(e: React.FormEvent) {
    e.preventDefault();
    if (!from || !to || from > to) return;
    const sp = new URLSearchParams(params.toString());
    sp.set('range', 'custom');
    sp.set('from', from);
    sp.set('to', to);
    router.push(`${pathname}?${sp.toString()}`);
  }

  return (
    <>
      <div className="cat-nav" style={{ margin: '0 0 16px' }}>
        {RANGES.map((r) => {
          const sp = new URLSearchParams(params.toString());
          sp.set('range', r.key);
          sp.delete('from');
          sp.delete('to');
          return (
            <Link
              key={r.key}
              href={`${pathname}?${sp.toString()}`}
              className="cat-chip"
              aria-current={current === r.key ? 'page' : undefined}
              onClick={() => setShowCustom(false)}
              style={
                current === r.key
                  ? {
                      background: 'var(--primary-soft)',
                      borderColor: 'var(--primary)',
                      color: 'var(--primary)',
                    }
                  : undefined
              }
            >
              {r.label}
            </Link>
          );
        })}
        <button
          type="button"
          className="cat-chip"
          onClick={() => setShowCustom((v) => !v)}
          style={
            current === 'custom'
              ? {
                  background: 'var(--primary-soft)',
                  borderColor: 'var(--primary)',
                  color: 'var(--primary)',
                }
              : undefined
          }
        >
          Custom range
        </button>
      </div>
      {showCustom ? (
        <form
          onSubmit={applyCustom}
          className="row"
          style={{ gap: 8, alignItems: 'end', margin: '-8px 0 16px' }}
        >
          <label>
            <div className="muted" style={{ fontSize: 12 }}>
              From
            </div>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} required />
          </label>
          <label>
            <div className="muted" style={{ fontSize: 12 }}>
              To
            </div>
            <input
              type="date"
              min={from}
              value={to}
              onChange={(e) => setTo(e.target.value)}
              required
            />
          </label>
          <button type="submit" className="secondary sm">
            Apply
          </button>
        </form>
      ) : null}
    </>
  );
}
