import { NextResponse } from 'next/server';
import { checkDatabaseHealth } from '@jksh/identity';
import { db } from '@/server/pool';

export const dynamic = 'force-dynamic';

/** Unauthenticated liveness/readiness probe for load balancers and uptime
 *  monitoring. Confirms the process can reach Postgres; never exposes schema,
 *  row counts, or any tenant data. */
export async function GET() {
  try {
    await checkDatabaseHealth(db());
    return NextResponse.json({ status: 'ok' });
  } catch {
    return NextResponse.json({ status: 'unavailable' }, { status: 503 });
  }
}
