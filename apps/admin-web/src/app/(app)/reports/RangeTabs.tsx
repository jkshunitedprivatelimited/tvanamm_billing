'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

const RANGES: { key: string; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'last7', label: 'Last 7 days' },
  { key: 'last30', label: 'Last 30 days' },
];

export function RangeTabs({ current }: { current: string }) {
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <div className="cat-nav" style={{ margin: '0 0 16px' }}>
      {RANGES.map((r) => {
        const sp = new URLSearchParams(params.toString());
        sp.set('range', r.key);
        return (
          <Link
            key={r.key}
            href={`${pathname}?${sp.toString()}`}
            className="cat-chip"
            aria-current={current === r.key ? 'page' : undefined}
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
    </div>
  );
}
