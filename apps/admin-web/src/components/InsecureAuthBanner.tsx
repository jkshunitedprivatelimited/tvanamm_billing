import { devOtpEnabled } from '@/server/dev-session';

/** Loud, unmissable strip shown whenever the temporary dev OTP bypass is on. */
export function InsecureAuthBanner() {
  if (!devOtpEnabled()) return null;
  return (
    <div className="dev-banner">
      NON-PRODUCTION · insecure dev OTP login is enabled (ADMIN_DEV_OTP)
    </div>
  );
}
