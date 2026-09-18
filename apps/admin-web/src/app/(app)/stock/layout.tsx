import type { ReactNode } from 'react';
import Link from 'next/link';
import { listOutlets } from '@jksh/identity';
import { requireAdminActor } from '@/server/auth';
import { db } from '@/server/pool';

/** Phase-one owner workspace. Keep unfinished inventory workflows out of customer navigation. */
export default async function StockLayout({ children }: { children: ReactNode }) {
  const actor = await requireAdminActor();
  if (actor.role !== 'franchise_owner') return children;
  const outlets = await listOutlets(db(), actor);
  return (
    <main>
      <p className="eyebrow">Your outlet records</p>
      <h1>Expenses &amp; wastage</h1>
      <p className="page-intro">
        Review your team’s spending and recorded wastage. Sales and billing remain available as
        usual.
      </p>
      <div className="workflow-grid">
        {outlets.map((outlet) => (
          <section className="card" key={outlet.id}>
            <h2>{outlet.displayName}</h2>
            <p>Milk, sugar and other daily spending are recorded by your team in billing.</p>
            <div className="outlet-actions">
              <Link href={`/outlets/${outlet.id}?section=expenses`}>Review expenses</Link>
              <Link href={`/reports?category=stock&outletId=${outlet.id}`}>View wastage</Link>
              <Link href={`/reports?outletId=${outlet.id}`}>Sales reports</Link>
            </div>
          </section>
        ))}
      </div>
      {!outlets.length ? <p>No outlets have been assigned yet.</p> : null}
      <section className="card" style={{ marginTop: 24 }}>
        <span className="pill">Coming soon</span>
        <h2>Stock tracking &amp; ordering</h2>
        <p>
          Stock balances, low-stock reminders, supply ordering and stock counts are being prepared.
        </p>
        <h3>What is a stock count?</h3>
        <p>
          Check what you physically have — for example, 5 litres of milk or 2 kg of sugar. Once
          available, a stock count will help compare that quantity with your recorded balance.
        </p>
        <p>
          Your team can already record purchases, expenses and wastage. These records remain
          available in Reports.
        </p>
      </section>
    </main>
  );
}
