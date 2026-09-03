import { devOtpEnabled } from '@/server/dev-session';

/** Loud, unmissable strip shown whenever the temporary dev OTP bypass is on. */
export function InsecureAuthBanner() {
  if (!devOtpEnabled()) return null;
  return (
    <div
      style={{
        background: '#b42318',
        color: '#fff',
        textAlign: 'center',
        padding: '6px 12px',
        fontSize: 13,
        fontWeight: 600,
      }}
    >
      NON-PRODUCTION · insecure dev OTP login is enabled (ADMIN_DEV_OTP)
    </div>
  );
}
