import { NextResponse } from 'next/server';
import { createInvitationCommandSchema } from '@jksh/contracts';
import { createFranchiseOwnerInvitation } from '@jksh/identity';
import { db } from '@/server/pool';
import { actorOrThrow, jsonError, requestMeta } from '@/server/http';

export async function POST(request: Request) {
  try {
    const actor = await actorOrThrow();
    const cmd = createInvitationCommandSchema.parse(await request.json());
    const { invitationId, token } = await createFranchiseOwnerInvitation(
      db(),
      actor,
      cmd,
      requestMeta(request),
    );
    // The token is shown once to Central Admin to deliver out of band.
    return NextResponse.json({ invitationId, token });
  } catch (error) {
    return jsonError(error);
  }
}
