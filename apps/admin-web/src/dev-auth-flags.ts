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

/**
 * MSG91 OTP Widget login is active when its Widget ID and account auth key are
 * configured and the insecure dev bypass is NOT in use. Both paths establish
 * the same HMAC-signed local session cookie.
 */
export function msg91WidgetAuthEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return (
    !insecureDevAuthEnabled(env) && !!env.MSG91_WIDGET_ID?.trim() && !!env.MSG91_AUTHKEY?.trim()
  );
}

/** Either path issues the signed local session cookie the app reads. */
export function localSessionAuthEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return insecureDevAuthEnabled(env) || msg91WidgetAuthEnabled(env);
}
