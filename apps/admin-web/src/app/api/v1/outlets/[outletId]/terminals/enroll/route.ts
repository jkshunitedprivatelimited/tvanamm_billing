import { NextResponse } from 'next/server';
import { issueActivationCodeCommandSchema } from '@jksh/contracts';
import { issueActivationCode } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, jsonError, requestMeta } from '@/server/http';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ outletId: string }> },
) {
  try {
    const actor = await actorOrThrow();
    const { outletId } = await params;
    const raw: unknown = await request.json().catch(() => ({}));
    const cmd = issueActivationCodeCommandSchema.parse({ ...(raw as object), outletId });
    return NextResponse.json(await issueActivationCode(db(), actor, cmd, requestMeta(request)));
  } catch (error) {
    return jsonError(error);
  }
}
