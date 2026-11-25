-- Parallel billing: more than one active Billing terminal per outlet.
--
-- Each terminal already bills under its own receipt prefix (T01, T02, …) and
-- receipt numbers are counted per (outlet, prefix, business date), with offline
-- receipt blocks reserved per terminal — so two counters can never issue the
-- same number. The cash drawer stays one shared session per outlet; employee
-- shifts stay one per employee; one operator per terminal at a time.
--
-- Registration no longer replaces the outlet's terminal implicitly. An
-- activation code either ADDS a counter (next free prefix) or REPLACES a named
-- terminal (revokes it and continues its prefix and receipt sequence).

drop index if exists identity.terminals_outlet_one_active;

alter table identity.terminal_activation_codes
  add column if not exists replaces_terminal_id uuid
    references identity.terminals(id) on delete set null;

-- A signed-in operator must read its own outlet's terminals to find its
-- receipt prefix. Before this, the lookup returned nothing under RLS and the
-- code fell back to "T01" — harmless with one terminal, a receipt-number
-- collision with two.
create policy terminal_operator_read on identity.terminals for select to identity_api
  using (identity.ctx('request') = 'operator' and outlet_id = identity.ctx_uuid('outlet_id'));
