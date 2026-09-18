import Link from 'next/link';
import { notFound } from 'next/navigation';
import { listEmployees, listOutlets, listTerminals } from '@jksh/identity';
import { requireAdminActor } from '@/server/auth';
import { db } from '@/server/pool';
import { OutletDetail } from './detail';
import { BillsPanel } from './bills-panel';
import { AttendancePanel } from './AttendancePanel';
import { ExpensePanel } from './ExpensePanel';

export default async function OutletPage({
  params,
  searchParams,
}: {
  params: Promise<{ outletId: string }>;
  searchParams: Promise<{ section?: string }>;
}) {
  const actor = await requireAdminActor();
  const { outletId } = await params;

  const outlet = (await listOutlets(db(), actor)).find((o) => o.id === outletId);
  if (!outlet) notFound();

  const sp = await searchParams;
  const sections = [
    {
      key: 'billing',
      label: 'Bills & refunds',
      description: 'Find bills, review payments and manage eligible refunds.',
    },
    {
      key: 'expenses',
      label: 'Expenses',
      description: 'Review spending recorded for this outlet.',
    },
    ...(actor.role !== 'accountant'
      ? [
          {
            key: 'attendance',
            label: 'Attendance',
            description: 'Review your team’s attendance and work sessions.',
          },
          {
            key: 'setup',
            label: 'Team & devices',
            description: 'Manage employees and the billing device for this outlet.',
          },
        ]
      : []),
  ];
  const section = sections.find((s) => s.key === sp.section) ?? sections[0];
  const [terminals, employees] =
    section?.key === 'setup'
      ? await Promise.all([
          listTerminals(db(), actor, outletId).catch(() => []),
          listEmployees(db(), actor, outletId).catch(() => []),
        ])
      : [[], []];

  return (
    <main>
      <p>
        <Link href="/">← All outlets</Link>
      </p>
      <h1>
        {outlet.displayName} <span className="pill">{outlet.status}</span>
      </h1>
      <p className="page-intro">
        {outlet.city ? `${outlet.city} · ` : ''}
        {outlet.brandName}
      </p>
      <div className="outlet-actions" style={{ marginBottom: 24 }}>
        <Link href={`/reports?outletId=${outletId}`}>View outlet reports ↗</Link>
        {actor.role !== 'accountant' ? (
          <>
            <Link href={`/stock/${outletId}`}>Stock overview ↗</Link>
            <Link href={`/stock/${outletId}/order`}>Order stock ↗</Link>
          </>
        ) : null}
      </div>
      <nav className="report-categories" aria-label="Outlet sections">
        {sections.map((s) => (
          <Link
            key={s.key}
            href={`/outlets/${outletId}?section=${s.key}`}
            aria-current={section?.key === s.key ? 'page' : undefined}
          >
            {s.label}
          </Link>
        ))}
      </nav>
      <p className="page-intro">{section?.description}</p>
      {section?.key === 'setup' ? (
        <OutletDetail
          role={actor.role}
          outlet={outlet}
          initialTerminals={terminals}
          initialEmployees={employees}
        />
      ) : null}
      {section?.key === 'attendance' ? <AttendancePanel outletId={outletId} /> : null}
      {section?.key === 'expenses' ? <ExpensePanel outletId={outletId} role={actor.role} /> : null}
      {section?.key === 'billing' ? <BillsPanel outletId={outletId} role={actor.role} /> : null}
    </main>
  );
}
