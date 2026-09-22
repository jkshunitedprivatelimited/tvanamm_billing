'use client';
import type { CashSessionRow } from '@jksh/identity';
import { DataTable, type Column } from '@/components/DataTable';

const money = (v: string | null) => (v === null ? '—' : `₹${v}`);

const columns: Column<CashSessionRow>[] = [
  {
    key: 'date',
    header: 'Date',
    width: '110px',
    nowrap: true,
    sortValue: (r) => r.businessDate,
    render: (r) => r.businessDate,
  },
  {
    key: 'outlet',
    header: 'Outlet',
    width: 'minmax(140px, 1fr)',
    nowrap: true,
    sortValue: (r) => r.outletName,
    render: (r) => r.outletName,
  },
  {
    key: 'status',
    header: 'Status',
    width: '90px',
    sortValue: (r) => r.status,
    render: (r) => <span className={`pill ${r.status}`}>{r.status}</span>,
  },
  {
    key: 'opened',
    header: 'Opened by',
    width: 'minmax(120px, 1fr)',
    nowrap: true,
    render: (r) => r.openedByName,
  },
  {
    key: 'opening',
    header: 'Opening',
    width: '100px',
    align: 'right',
    sortValue: (r) => Number(r.openingCash),
    render: (r) => money(r.openingCash),
  },
  {
    key: 'closed',
    header: 'Closed by',
    width: 'minmax(120px, 1fr)',
    nowrap: true,
    render: (r) => r.closedByName ?? '—',
  },
  {
    key: 'counted',
    header: 'Counted',
    width: '100px',
    align: 'right',
    sortValue: (r) => (r.countedCash === null ? -1 : Number(r.countedCash)),
    render: (r) =>
      r.status === 'force_closed' && r.countedCash === null ? 'Not counted' : money(r.countedCash),
  },
  {
    key: 'expected',
    header: 'Expected',
    width: '100px',
    align: 'right',
    sortValue: (r) => (r.expectedCash === null ? -1 : Number(r.expectedCash)),
    render: (r) => money(r.expectedCash),
  },
  {
    key: 'variance',
    header: 'Variance',
    width: '100px',
    align: 'right',
    sortValue: (r) => (r.variance === null ? 0 : Number(r.variance)),
    render: (r) =>
      r.variance === null ? (
        '—'
      ) : (
        <span style={{ color: Number(r.variance) === 0 ? undefined : 'var(--danger)' }}>
          {money(r.variance)}
        </span>
      ),
  },
];

export function CashSessionsTable({ rows }: { rows: CashSessionRow[] }) {
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id}
      initialSort={{ key: 'date', dir: 'desc' }}
      empty="No cash sessions in this range."
    />
  );
}
