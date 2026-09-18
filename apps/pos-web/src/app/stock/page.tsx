import Link from 'next/link';
import { listItems, listEmployeeStockEntries } from '@jksh/stock';
import { requireOperator } from '@/server/auth';
import { stockDb, operatorStockActor } from '@/server/stock';
import { StockEntryClient } from './stock-entry-client';
export default async function EmployeeStockPage() {
  const actor = await requireOperator();
  let content;
  try {
    const stockActor = await operatorStockActor(actor);
    const [items, entries] = await Promise.all([
      listItems(stockDb(), stockActor, { organizationId: stockActor.organizationId, limit: 500 }),
      listEmployeeStockEntries(stockDb(), stockActor),
    ]);
    content = (
      <StockEntryClient
        items={items
          .filter((i) => !i.isBatchTracked)
          .map((i) => ({ id: i.id, name: i.name, baseUnit: i.baseUnit, supplyRule: i.supplyRule }))}
        entries={entries.map((e) => ({ ...e, created_at: e.created_at.toISOString() }))}
      />
    );
  } catch {
    content = (
      <p role="alert">
        Stock entry is temporarily unavailable. You can continue billing and try again shortly.
      </p>
    );
  }
  return (
    <main className="pos stock-workspace" style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}>
      <Link href="/pos">← Back to billing</Link>
      <h1>Stock & purchases</h1>
      <p>Record what arrived, what was wasted, or what you counted.</p>
      {content}
    </main>
  );
}
