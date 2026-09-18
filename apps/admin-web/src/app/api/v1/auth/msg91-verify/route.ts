import { z } from 'zod';
import { NextResponse } from 'next/server';
import { mobileNumberSchema } from '@jksh/contracts';
import {
  resolveAdminAfterVerify,
  checkOtpVerify,
  recordOtpVerifyFailure,
  resetOtpAttempts,
} from '@jksh/identity';
import { db } from '@/server/pool';
import { jsonError, requestMeta } from '@/server/http';
import { WS_COOKIE, signWorkspace, wsCookieOptions } from '@/server/ws-cookie';
import {
  DEV_COOKIE,
  devCookieOptions,
  signDevSession,
  syntheticAuthUserId,
} from '@/server/dev-session';
import { msg91WidgetAuthEnabled } from '@/dev-auth-flags';
import { verifyMsg91WidgetToken } from '@/server/msg91-widget-token';

const bodySchema = z.object({ phone: mobileNumberSchema, accessToken: z.string().min(1) });

/** Confirms the MSG91 OTP-Widget access token server-side, then establishes the
 *  same signed local session the dev bypass uses. */
export async function POST(request: Request) {
  try {
    const authKey = process.env.MSG91_AUTHKEY?.trim();
    if (!msg91WidgetAuthEnabled() || !authKey) {
      return NextResponse.json({ error: 'Widget auth is not configured' }, { status: 503 });
    }
    const { phone, accessToken } = bodySchema.parse(await request.json());
    const meta = requestMeta(request);

    const gate = await checkOtpVerify(db(), phone);
    if (!gate.allowed) {
      return NextResponse.json(
        {
          outcome: 'rejected',
          ...(gate.retryAfterSeconds ? { retryAfterSeconds: gate.retryAfterSeconds } : {}),
        },
        { status: 200 },
      );
    }

    if (!(await verifyMsg91WidgetToken(accessToken, phone, authKey))) {
      const retry = await recordOtpVerifyFailure(db(), phone);
      return NextResponse.json(
        { outcome: 'rejected', ...(retry ? { retryAfterSeconds: retry } : {}) },
        { status: 200 },
      );
    }
    await resetOtpAttempts(db(), phone);

    const { result, accountId } = await resolveAdminAfterVerify(
      db(),
      { authUserId: syntheticAuthUserId(phone), phone },
      meta,
    );
    const response = NextResponse.json(result);
    if (result.outcome !== 'rejected' && accountId) {
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
