-- Attribute owner-authorized reconciliation to the owner's account, never a cashier.
alter table billing.cash_sessions add column closed_by_account_id uuid
  references identity.account_profiles(id) on delete restrict;
alter table billing.cash_sessions drop constraint cash_sessions_close_shape;
alter table billing.cash_sessions add constraint cash_sessions_close_shape check (
  status = 'open'
  or (status = 'closed' and (closed_by_employee_id is not null or closed_by_account_id is not null)
      and closed_at is not null and counted_cash is not null)
  or (status = 'force_closed' and closed_at is not null and force_close_reason is not null)
);
