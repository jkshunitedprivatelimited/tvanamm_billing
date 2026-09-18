'use client';
import type { ReasonBreakdown } from '@jksh/identity';
import { DataTable, type Column } from '@/components/DataTable';

const columns: Column<ReasonBreakdown>[] = [
  {
    key: 'reason',
    header: 'Reason',
    width: 'minmax(200px, 1fr)',
    nowrap: true,
    sortValue: (r) => r.reason,
    render: (r) => r.reason,
  },
  {
    key: 'amount',
    header: 'Amount',
    width: '120px',
    align: 'right',
    sortValue: (r) => Number(r.amount),
    render: (r) => `₹${r.amount}`,
  },
  {
    key: 'count',
    header: 'Count',
    width: '90px',
    align: 'right',
    sortValue: (r) => r.count,
    render: (r) => r.count,
  },
];

export function ReasonBreakdownTable({ rows, empty }: { rows: ReasonBreakdown[]; empty: string }) {
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.reason}
      initialSort={{ key: 'amount', dir: 'desc' }}
      empty={empty}
    />
  );
}
