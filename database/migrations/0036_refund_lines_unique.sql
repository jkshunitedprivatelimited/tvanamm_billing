-- A refund must never post two separate lines against the same bill line -
-- that let the application-level remaining-quantity check be validated
-- against two independent, smaller requests that together over-refunded the
-- line. The application now merges duplicate bill-line entries before
-- insert; this constraint makes the same guarantee hold at the database
-- level regardless of caller.
alter table billing.refund_lines
  add constraint refund_lines_refund_bill_line_unique unique (refund_id, bill_line_id);
