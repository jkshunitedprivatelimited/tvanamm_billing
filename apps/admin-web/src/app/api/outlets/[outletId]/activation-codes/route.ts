import { NextResponse } from 'next/server';
import { issueActivationCodeCommandSchema } from '@jksh/contracts';
import { issueActivationCode } from '@jksh/identity';
import { db } from '@/server/pool';
import { jsonError, requestMeta } from '@/server/http';
import { requireActorRoute } from '@/server/auth';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ outletId: string }> },
) {
  try {
    const actor = await requireActorRoute();
    const { outletId } = await params;
    const raw: unknown = await request.json().catch(() => ({}));
    const cmd = issueActivationCodeCommandSchema.parse({ ...(raw as object), outletId });
    const result = await issueActivationCode(db(), actor, cmd, requestMeta(request));
    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
