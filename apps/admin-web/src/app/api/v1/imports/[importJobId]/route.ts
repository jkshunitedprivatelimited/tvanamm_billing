import { NextResponse } from 'next/server';
import { getImportJob } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, jsonError } from '@/server/http';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ importJobId: string }> },
) {
  try {
    const actor = await actorOrThrow();
    const { importJobId } = await params;
    return NextResponse.json(await getImportJob(db(), actor, importJobId));
  } catch (error) {
    return jsonError(error);
  }
}
