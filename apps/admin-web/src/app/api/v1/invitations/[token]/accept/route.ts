import { NextResponse } from 'next/server';
import { z } from 'zod';
import { mobileNumberSchema } from '@jksh/contracts';
import { acceptInvitation, resolveAdminAfterVerify } from '@jksh/identity';
import { db } from '@/server/pool';
import { jsonError, requestMeta } from '@/server/http';
import { verifyPhoneOtp } from '@/server/otp';
import { WS_COOKIE, signWorkspace, wsCookieOptions } from '@/server/ws-cookie';
import { DEV_COOKIE, devCookieOptions, devOtpEnabled, signDevSession } from '@/server/dev-session';

const bodySchema = z.object({
  phone: mobileNumberSchema,
  code: z.string().regex(/^\d{4,8}$/),
});

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const { phone, code } = bodySchema.parse(await request.json());
    const meta = requestMeta(request);

    const otp = await verifyPhoneOtp(phone, code);
    if (!otp.ok) {
      return NextResponse.json(
        {
          outcome: 'rejected',
          ...(otp.retryAfterSeconds ? { retryAfterSeconds: otp.retryAfterSeconds } : {}),
        },
        { status: 200 },
      );
    }

    // Consume the invitation (binds to the exact invited mobile, replay-safe).
    await acceptInvitation(db(), token, phone, meta);

    // The account is now active — resolve the admin session immediately.
    const { result, accountId } = await resolveAdminAfterVerify(
      db(),
      { authUserId: otp.authUserId, phone },
      meta,
    );
    const response = NextResponse.json(result);
    if (devOtpEnabled() && result.outcome !== 'rejected' && accountId) {
      response.cookies.set(DEV_COOKIE, signDevSession(accountId, phone), devCookieOptions(request));
    }
    if (result.outcome === 'single_workspace') {
      response.cookies.set(WS_COOKIE, signWorkspace(result.membershipId), wsCookieOptions);
    }
    return response;
  } catch (error) {
    return jsonError(error);
  }
}
