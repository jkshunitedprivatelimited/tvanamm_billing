import { NextResponse } from 'next/server';
import { z } from 'zod';
import { accountStatusSchema } from '@jksh/contracts';
import { setAccountStatus } from '@jksh/identity';
import { db } from '@/server/pool';
import { supabaseAdmin } from '@/server/supabase';
import { actorOrThrow, jsonError, requestMeta } from '@/server/http';

const bodySchema = z.object({
  status: accountStatusSchema,
  reason: z.string().trim().max(300).optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  try {
    const actor = await actorOrThrow();
    const { accountId } = await params;
    const { status, reason } = bodySchema.parse(await request.json());
    const { authUserId } = await setAccountStatus(
      db(),
      actor,
      accountId,
      status,
      reason,
      requestMeta(request),
    );
    // A disabled account's live Supabase sessions end immediately.
    if (status !== 'active' && authUserId) {
      await supabaseAdmin().auth.admin.signOut(authUserId, 'global');
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
