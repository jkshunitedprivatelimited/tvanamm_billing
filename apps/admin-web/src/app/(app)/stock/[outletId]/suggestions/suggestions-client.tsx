'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { DataTable, type Column } from '@/components/DataTable';

interface Row {
  id: string;
  itemId: string;
  itemName: string;
  suggestedQtyBase: string;
  status: string;
  inputs: unknown;
}

/** Matches `SuggestionInputs` in packages/stock/src/analytics.ts — `inputs`
 *  arrives as `unknown` (raw jsonb), so this is a display-only shape guard,
 *  not a validated type. */
interface SuggestionInputsShape {
  trailingDailyConsumptionBase: number;
  leadTimeDays: number;
  safetyDays: number;
  usableStockBase: number;
  confirmedInboundBase: number;
  backorderBase: number;
  orderPackBase: number;
}

function isSuggestionInputs(v: unknown): v is SuggestionInputsShape {
  return typeof v === 'object' && v !== null && 'trailingDailyConsumptionBase' in v;
}

/** A short, readable sentence instead of a raw JSON dump — the same numbers
 *  that went into `suggestReorderQty`'s formula, in plain language. */
function explain(inputs: unknown): string {
  if (!isSuggestionInputs(inputs)) return '—';
  const days = inputs.leadTimeDays + inputs.safetyDays;
  const parts = [
    `~${inputs.trailingDailyConsumptionBase.toFixed(1)}/day over ${String(days)} days`,
    `− ${inputs.usableStockBase.toFixed(1)} on hand`,
  ];
  if (inputs.confirmedInboundBase > 0)
    parts.push(`− ${inputs.confirmedInboundBase.toFixed(1)} incoming`);
  if (inputs.backorderBase > 0) parts.push(`+ ${inputs.backorderBase.toFixed(1)} backorder`);
  parts.push(`rounded to packs of ${String(inputs.orderPackBase)}`);
  return parts.join(', ');
}

export function SuggestionsClient({ outletId, rows }: { outletId: string; rows: Row[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  async function regenerate() {
    setMsg(null);
    const res = await fetch(`/api/v1/stock/outlets/${outletId}/suggestions`, { method: 'POST' });
    setMsg(res.ok ? 'Recalculated.' : 'Failed to recalculate.');
    startTransition(() => router.refresh());
  }

  async function dismiss(id: string) {
    const res = await fetch(`/api/v1/stock/suggestions/${id}/dismiss`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    setMsg(res.ok ? 'Dismissed.' : 'Failed to dismiss.');
    startTransition(() => router.refresh());
  }

  const columns: Column<Row>[] = [
    {
      key: 'item',
      header: 'Item',
      width: 'minmax(140px,1fr)',
      nowrap: true,
      sortValue: (r) => r.itemName,
      render: (r) => r.itemName,
    },
    {
      key: 'qty',
      header: 'Suggested qty',
      width: '110px',
      align: 'right',
      sortValue: (r) => Number(r.suggestedQtyBase),
      render: (r) => r.suggestedQtyBase,
    },
    {
      key: 'status',
      header: 'Status',
      width: '100px',
      sortValue: (r) => r.status,
      render: (r) => <span className="pill">{r.status}</span>,
    },
    {
      key: 'why',
      header: 'Why',
      width: 'minmax(220px,1.6fr)',
      nowrap: true,
      render: (r) => explain(r.inputs),
    },
    {
      key: 'action',
      header: '',
      width: '220px',
      render: (r) =>
        r.status === 'open' ? (
          <div className="row" style={{ gap: 8 }}>
            <Link
              href={`/stock/${outletId}/order?item=${r.itemId}&qty=${r.suggestedQtyBase}`}
              className="link-btn"
            >
              Convert to order
            </Link>
            <button className="ghost sm" onClick={() => void dismiss(r.id)} disabled={pending}>
              Dismiss
            </button>
          </div>
        ) : null,
    },
  ];

  return (
    <div className="card">
      <button onClick={() => void regenerate()} disabled={pending}>
        Recalculate
      </button>
      {msg ? (
        <span className="muted" style={{ marginLeft: 12 }}>
          {msg}
        </span>
      ) : null}
      <div style={{ marginTop: 12 }}>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          initialSort={{ key: 'qty', dir: 'desc' }}
          empty="No suggestions. Recalculate after some sales history exists."
        />
      </div>
    </div>
  );
}
