-- Owner-close support (0040) may be deployed before the optional scheduler (0039).
-- Reassert the final constraint after a later full migration run so 0039 cannot
-- leave an already-enabled owner portal requiring a cashier identity to close.
alter table billing.cash_sessions drop constraint cash_sessions_close_shape;
alter table billing.cash_sessions add constraint cash_sessions_close_shape check (
  status = 'open'
  or (status = 'closed' and (closed_by_employee_id is not null or closed_by_account_id is not null)
      and closed_at is not null and counted_cash is not null)
  or (status = 'force_closed' and closed_at is not null and force_close_reason is not null)
);
