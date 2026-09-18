'use client';
import type { EmployeeSalesRow } from '@jksh/identity';
import { DataTable, type Column } from '@/components/DataTable';

const money = (v: string) => `₹${v}`;

const columns: Column<EmployeeSalesRow>[] = [
  {
    key: 'employee',
    header: 'Employee',
    width: 'minmax(160px, 1fr)',
    nowrap: true,
    sortValue: (r) => r.employeeName,
    render: (r) => r.employeeName,
  },
  {
    key: 'gross',
    header: 'Gross',
    width: '110px',
    align: 'right',
    sortValue: (r) => Number(r.grossSales),
    render: (r) => money(r.grossSales),
  },
  {
    key: 'disc',
    header: 'Discounts',
    width: '110px',
    align: 'right',
    sortValue: (r) => Number(r.discountTotal),
    render: (r) => money(r.discountTotal),
  },
  {
    key: 'ref',
    header: 'Refunds',
    width: '110px',
    align: 'right',
    sortValue: (r) => Number(r.refundTotal),
    render: (r) => money(r.refundTotal),
  },
  {
    key: 'net',
    header: 'Net',
    width: '110px',
    align: 'right',
    sortValue: (r) => Number(r.netSales),
    render: (r) => money(r.netSales),
  },
  {
    key: 'bills',
    header: 'Bills',
    width: '80px',
    align: 'right',
    sortValue: (r) => r.billCount,
    render: (r) => r.billCount,
  },
];

export function EmployeeBreakdownTable({ rows }: { rows: EmployeeSalesRow[] }) {
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.employeeId}
      initialSort={{ key: 'net', dir: 'desc' }}
      empty="No sales attributed to an employee in this range."
    />
  );
}
