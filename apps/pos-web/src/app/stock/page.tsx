import { listExpenses } from '@jksh/identity';
import { db } from '@/server/pool';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listItems, listEmployeeStockEntries } from '@jksh/stock';
import { requireOperator } from '@/server/auth';
import { stockDb, operatorStockActor } from '@/server/stock';
import { ExpensesClient } from '../expenses/expenses-client';
import { StockEntryClient } from './stock-entry-client';
export default async function EmployeeStockPage() {
  const actor = await requireOperator();
  if (!actor.outletId) redirect('/login');
  const expenses = await listExpenses(db(), actor, {
    outletId: actor.outletId,
    currentEmployeeShiftOnly: true,
  });
  let content;
  try {
    const stockActor = await operatorStockActor(actor);
    const [items, entries] = await Promise.all([
      listItems(stockDb(), stockActor, { organizationId: stockActor.organizationId, limit: 500 }),
      listEmployeeStockEntries(stockDb(), stockActor),
    ]);
    content = (
      <StockEntryClient
        expenses={expenses}
        items={items
          .filter((i) => !i.isBatchTracked)
          .map((i) => ({ id: i.id, name: i.name, baseUnit: i.baseUnit, supplyRule: i.supplyRule }))}
        entries={entries.map((e) => ({ ...e, created_at: e.created_at.toISOString() }))}
      />
    );
  } catch {
    content = (
      <>
        <p role="alert">
          Stock entry is unavailable for this outlet. You can still record expenses, including milk
          and sugar.
        </p>
        <ExpensesClient />
      </>
    );
  }
  return (
    <main className="pos stock-workspace" style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}>
      <Link href="/pos">← Back to billing</Link>
      <h1>Stock & expenses</h1>
      <p>Record purchases, daily expenses and wastage in one place.</p>
      {content}
    </main>
  );
}
