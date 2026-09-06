import { NextResponse } from 'next/server';
import { createOfferCommandSchema } from '@jksh/contracts';
import { createOffer, listOffers } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, jsonError, requestMeta } from '@/server/http';

export async function POST(request: Request) {
  try {
    const actor = await actorOrThrow();
    const cmd = createOfferCommandSchema.parse(await request.json());
    return NextResponse.json(await createOffer(db(), actor, cmd, requestMeta(request)));
  } catch (error) {
    return jsonError(error);
  }
}

export async function GET(request: Request) {
  try {
    const actor = await actorOrThrow();
    const url = new URL(request.url);
    const brandId = url.searchParams.get('brandId');
    const outletId = url.searchParams.get('outletId');
    return NextResponse.json({
      offers: await listOffers(db(), actor, {
        ...(brandId ? { brandId } : {}),
        ...(outletId ? { outletId } : {}),
      }),
    });
  } catch (error) {
    return jsonError(error);
  }
}
