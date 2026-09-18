'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
export function ReportCategoryNav({
  categories,
  current,
}: {
  categories: { key: string; label: string; href: string }[];
  current: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <>
      <label className="mobile-report-select">
        Report category
        <select
          value={current}
          disabled={pending}
          onChange={(e) => {
            const c = categories.find((item) => item.key === e.target.value);
            if (c) startTransition(() => router.push(c.href));
          }}
        >
          {categories.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
        {pending ? (
          <span role="status" className="muted">
            Loading report…
          </span>
        ) : null}
      </label>
      <nav className="report-categories desktop-report-categories" aria-label="Report categories">
        {categories.map((c) => (
          <Link key={c.key} href={c.href} aria-current={current === c.key ? 'page' : undefined}>
            {c.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
