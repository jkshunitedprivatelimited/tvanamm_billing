import { notFound } from 'next/navigation';
import Link from 'next/link';
import { listEmployees } from '@jksh/identity';
import { requireActor } from '@/server/auth';
import { db } from '@/server/pool';
import { getOutlet } from '@/server/queries';
import { EmployeeManager } from './manager';

export default async function OutletEmployeesPage({
  params,
}: {
  params: Promise<{ outletId: string }>;
}) {
  const actor = await requireActor();
  const { outletId } = await params;
  const outlet = await getOutlet(outletId);
  if (!outlet) notFound();

  const employees = await listEmployees(db(), actor, outletId);

  return (
    <main>
      <p>
        <Link href="/">← All outlets</Link>
      </p>
      <h1>{outlet.name} · Employees</h1>
      <p className="muted">
        Create a Store Employee from name and mobile number; the system generates the employee ID.
        You assign the initial four-digit PIN. PIN reset requires a fresh sign-in.
      </p>
      <EmployeeManager outletId={outletId} initialEmployees={employees} />
    </main>
  );
}
