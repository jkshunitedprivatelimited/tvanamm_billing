/**
 * The single predicate for the temporary insecure dev-auth bypass. Plain module
 * (no `server-only`) so the Edge proxy and server code use the exact same gate
 * (`docs/plans/stage-1-remediation-status.md` — "one dev-auth feature gate").
 *
 * Enabled only when ALL THREE hold:
 *   NODE_ENV === 'development'
 *   ALLOW_INSECURE_DEV_AUTH === 'true'
 *   ADMIN_DEV_OTP is a non-empty string
 */
export function insecureDevAuthEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return (
    env.NODE_ENV === 'development' &&
    env.ALLOW_INSECURE_DEV_AUTH === 'true' &&
    typeof env.ADMIN_DEV_OTP === 'string' &&
    env.ADMIN_DEV_OTP.length > 0
  );
}
