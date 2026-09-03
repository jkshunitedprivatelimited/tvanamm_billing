import { NextResponse } from 'next/server';
import { listTerminals } from '@jksh/identity';
import { db } from '@/server/pool';
import { jsonError } from '@/server/http';
import { requireActorRoute } from '@/server/auth';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ outletId: string }> },
) {
  try {
    const actor = await requireActorRoute();
    const { outletId } = await params;
    return NextResponse.json({ terminals: await listTerminals(db(), actor, outletId) });
  } catch (error) {
    return jsonError(error);
  }
}
