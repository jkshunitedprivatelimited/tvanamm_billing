import { NextResponse } from 'next/server';
import { createTaxProfileCommandSchema } from '@jksh/contracts';
import { createTaxProfile, listTaxProfiles } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, jsonError, requestMeta } from '@/server/http';

export async function POST(request: Request) {
  try {
    const actor = await actorOrThrow();
    const cmd = createTaxProfileCommandSchema.parse(await request.json());
    return NextResponse.json(await createTaxProfile(db(), actor, cmd, requestMeta(request)));
  } catch (error) {
    return jsonError(error);
  }
}

export async function GET(request: Request) {
  try {
    const actor = await actorOrThrow();
    const brandId = new URL(request.url).searchParams.get('brandId');
    if (!brandId) {
      return NextResponse.json(
        { error: 'validation', message: 'brandId is required' },
        { status: 400 },
      );
    }
    return NextResponse.json({ taxProfiles: await listTaxProfiles(db(), actor, brandId) });
  } catch (error) {
    return jsonError(error);
  }
}
