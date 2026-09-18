'use client';
import { useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export function ReportOutletFilter({
  outlets,
}: {
  outlets: { id: string; name: string; franchiseId: string | null; franchiseName: string | null }[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  if (outlets.length === 1)
    return (
      <div className="single-outlet-context">
        <span className="muted">Outlet</span>
        <strong>{outlets[0]?.name}</strong>
      </div>
    );
  return (
    <div className="toolbar card report-outlet-filter" aria-busy={pending}>
      <label>
        Franchise
        <select
          value={params.get('franchiseId') ?? ''}
          disabled={pending}
          onChange={(e) => {
            const next = new URLSearchParams(params.toString());
            next.delete('outletId');
            if (e.target.value) next.set('franchiseId', e.target.value);
            else next.delete('franchiseId');
            startTransition(() => router.push(`/reports?${next.toString()}`));
          }}
        >
          <option value="">All franchises & company outlets</option>
          {Array.from(
            new Map(
              outlets
                .filter((o) => o.franchiseId)
                .map((o) => [o.franchiseId, o.franchiseName ?? 'Franchise']),
            ).entries(),
          ).map(([id, name]) => (
            <option key={id} value={id ?? ''}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Outlet
        <select
          value={params.get('outletId') ?? ''}
          disabled={pending}
          onChange={(event) => {
            const next = new URLSearchParams(params.toString());
            if (event.target.value) next.set('outletId', event.target.value);
            else next.delete('outletId');
            startTransition(() => router.push(`/reports?${next.toString()}`));
          }}
        >
          <option value="">All accessible outlets</option>
          {outlets
            .filter(
              (o) => !params.get('franchiseId') || o.franchiseId === params.get('franchiseId'),
            )
            .map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
        </select>
      </label>
      <span className="muted" role="status">
        {pending ? 'Updating reports…' : 'Outlet and dates apply across report categories.'}
      </span>
    </div>
  );
}
