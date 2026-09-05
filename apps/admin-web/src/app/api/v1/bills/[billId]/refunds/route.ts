import { NextResponse } from 'next/server';
import { createRefundCommandSchema } from '@jksh/contracts';
import { createRefund, listRefunds } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, jsonError, requestMeta } from '@/server/http';

export async function POST(request: Request, { params }: { params: Promise<{ billId: string }> }) {
  try {
    const actor = await actorOrThrow();
    const { billId } = await params;
    const cmd = createRefundCommandSchema.parse({ ...(await request.json()), billId });
    return NextResponse.json(await createRefund(db(), actor, cmd, requestMeta(request)));
  } catch (error) {
    return jsonError(error);
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ billId: string }> }) {
  try {
    const actor = await actorOrThrow();
    const { billId } = await params;
    return NextResponse.json({ refunds: await listRefunds(db(), actor, billId) });
  } catch (error) {
    return jsonError(error);
  }
}
