'use client';
import type { FinancialSummary } from '@jksh/identity';
import { DataTable, type Column } from '@/components/DataTable';

const money = (v: string) => `₹${v}`;

const columns: Column<FinancialSummary>[] = [
  {
    key: 'outlet',
    header: 'Outlet',
    width: 'minmax(160px, 1fr)',
    nowrap: true,
    sortValue: (o) => o.outletName ?? '',
    render: (o) => o.outletName ?? '—',
  },
  {
    key: 'gross',
    header: 'Gross',
    width: '110px',
    align: 'right',
    sortValue: (o) => Number(o.grossSales),
    render: (o) => money(o.grossSales),
  },
  {
    key: 'disc',
    header: 'Discounts',
    width: '110px',
    align: 'right',
    sortValue: (o) => Number(o.discountTotal),
    render: (o) => money(o.discountTotal),
  },
  {
    key: 'ref',
    header: 'Refunds',
    width: '110px',
    align: 'right',
    sortValue: (o) => Number(o.refundTotal),
    render: (o) => money(o.refundTotal),
  },
  {
    key: 'net',
    header: 'Net',
    width: '110px',
    align: 'right',
    sortValue: (o) => Number(o.netSales),
    render: (o) => money(o.netSales),
  },
  {
    key: 'cash',
    header: 'Cash',
    width: '100px',
    align: 'right',
    sortValue: (o) => Number(o.cashTotal),
    render: (o) => money(o.cashTotal),
  },
  {
    key: 'upi',
    header: 'UPI',
    width: '100px',
    align: 'right',
    sortValue: (o) => Number(o.upiTotal),
    render: (o) => money(o.upiTotal),
  },
  {
    key: 'bills',
    header: 'Bills',
    width: '80px',
    align: 'right',
    sortValue: (o) => o.billCount,
    render: (o) => o.billCount,
  },
];

export function ByOutletTable({ rows }: { rows: FinancialSummary[] }) {
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(o) => o.outletId ?? o.outletName ?? 'row'}
      initialSort={{ key: 'net', dir: 'desc' }}
      empty="No outlets in scope yet."
    />
  );
}
