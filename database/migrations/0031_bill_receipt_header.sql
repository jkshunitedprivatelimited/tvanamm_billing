-- Freeze the outlet's legal receipt details (name, address, phone, GSTIN) onto
-- every bill at creation time. A tax receipt reprinted after the outlet's
-- address or GSTIN changed must still show what was on it when it was issued,
-- so the receipt view must not re-join billing.outlets live.
--
-- billing.bills is append-only, so existing rows are not backfilled; the
-- receipt view falls back to the live outlet details when receipt_header is
-- null (bills created before this migration).

alter table billing.bills
  add column if not exists receipt_header jsonb;
