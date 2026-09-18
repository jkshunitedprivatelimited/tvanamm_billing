'use client';
import type { TopItemRow } from '@jksh/identity';
import { DataTable, type Column } from '@/components/DataTable';

const columns: Column<TopItemRow>[] = [
  {
    key: 'item',
    header: 'Item',
    width: 'minmax(180px, 1fr)',
    nowrap: true,
    sortValue: (r) => r.itemName,
    render: (r) => r.itemName,
  },
  {
    key: 'qty',
    header: 'Qty sold',
    width: '110px',
    align: 'right',
    sortValue: (r) => r.quantitySold,
    render: (r) => r.quantitySold,
  },
  {
    key: 'revenue',
    header: 'Revenue',
    width: '120px',
    align: 'right',
    sortValue: (r) => Number(r.revenue),
    render: (r) => `₹${r.revenue}`,
  },
];

export function TopItemsTable({ rows }: { rows: TopItemRow[] }) {
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.itemName}
      initialSort={{ key: 'qty', dir: 'desc' }}
      empty="No sales in this range."
    />
  );
}
