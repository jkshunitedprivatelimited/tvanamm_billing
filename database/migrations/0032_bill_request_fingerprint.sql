-- Guard against an idempotency key being reused for a different cart. The bill
-- records a hash of the sale-defining parts of the request that created it;
-- on a retry, a mismatching hash is a client bug and is rejected instead of
-- silently returning the first bill.

alter table billing.bills
  add column if not exists request_fingerprint text;
