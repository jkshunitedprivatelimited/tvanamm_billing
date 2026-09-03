-- Stage 1 audit remediation (P2) - real fresh-authentication timestamp.
-- Access-token refresh is not proof of a recent interactive OTP. Record the
-- moment of the latest interactive verification and never touch it on refresh.

alter table identity.account_profiles add column last_otp_at timestamptz;
