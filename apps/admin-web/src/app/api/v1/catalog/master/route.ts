import { NextResponse } from 'next/server';
import { z } from 'zod';
import { listMasterMenu } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, jsonError } from '@/server/http';

export async function GET(request: Request) {
  try {
    const actor = await actorOrThrow();
    const brandId = z.uuid().parse(new URL(request.url).searchParams.get('brandId'));
    return NextResponse.json(await listMasterMenu(db(), actor, brandId));
  } catch (error) {
    return jsonError(error);
  }
}
