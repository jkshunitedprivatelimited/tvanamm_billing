-- Franchise-owner-initiated returns of already-received JKSH stock (the
-- `stock.return.request`/`stock.return.approve` capabilities were granted
-- from day one but nothing implemented them — this is that implementation).
-- Deliberately self-contained rather than reusing `stock.credit_notes`
-- (that table's `stock_order_id` is not null, tied to the original
-- receiving flow; a return of stock already sitting in inventory may not
-- trace to one order/line cleanly) — the credit amount, if any, is recorded
-- directly on the return itself.
--
-- Lifecycle (each step a distinct capability, so the outlet that requests a
-- return can never be the party that approves it, values its credit, or
-- removes it from its own books):
--   requested  (outlet: return.request)
--     -> approved | rejected      (Central/warehouse: return.approve)
--   approved -> collected         (warehouse: return.collect; outlet stock
--                                  leaves the books here, once JKSH actually
--                                  has the goods in hand — not at approval)
--   collected -> received         (warehouse: return.receive; goods
--                                  physically inspected on arrival)
--   received -> credited | replaced | rejected
--                                 (warehouse/Central: return.receive; a
--                                  post-inspection reject reverses the
--                                  collection movement — the goods didn't
--                                  match what was approved, so the outlet
--                                  gets its stock back)

create type stock.owner_return_status as enum (
  'requested', 'approved', 'rejected', 'collected', 'received', 'credited', 'replaced'
);

-- Referenced by the composite FKs below so a return can't name a location or
-- item that doesn't actually belong to the outlet/organization it claims.
create unique index if not exists stock_locations_id_outlet_uniq
  on stock.stock_locations(id, outlet_id);
create unique index if not exists items_id_org_uniq
  on stock.items(id, organization_id);

create table stock.owner_returns (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null,
  outlet_id             uuid not null,
  franchise_id          uuid not null,
  stock_location_id     uuid not null,
  item_id               uuid not null,
  qty_base              numeric(20,6) not null check (qty_base > 0),
  reason                text not null check (length(btrim(reason)) between 1 and 500),
  status                stock.owner_return_status not null default 'requested',

  requested_by          uuid,
  requested_at          timestamptz not null default now(),

  approved_by           uuid,
  approved_at           timestamptz,
  approval_note         text check (approval_note is null or length(approval_note) <= 500),

  collected_by          uuid,
  collected_at          timestamptz,
  collection_movement_id uuid references stock.stock_movements(id) on delete restrict,

  received_by           uuid,
  received_at           timestamptz,
  received_note         text check (received_note is null or length(received_note) <= 500),

  resolved_by           uuid,
  resolved_at           timestamptz,
  resolution_note       text check (resolution_note is null or length(resolution_note) <= 500),
  credit_amount_paise   bigint check (credit_amount_paise is null or credit_amount_paise >= 0),
  reversal_movement_id  uuid references stock.stock_movements(id) on delete restrict,

  created_at            timestamptz not null default now(),

  constraint owner_returns_location_fk
    foreign key (stock_location_id, outlet_id) references stock.stock_locations(id, outlet_id),
  constraint owner_returns_item_fk
    foreign key (item_id, organization_id) references stock.items(id, organization_id),
  -- A post-inspection reject only makes sense once the goods were actually
  -- collected (there is something to reverse); a pre-collection reject never
  -- has a collection movement to reverse.
  constraint owner_returns_reversal_shape check (
    reversal_movement_id is null or collection_movement_id is not null
  )
);
create index owner_returns_outlet_idx on stock.owner_returns(outlet_id, created_at desc);
create index owner_returns_open_idx on stock.owner_returns(outlet_id)
  where status in ('requested', 'approved', 'collected', 'received');

create trigger owner_returns_no_delete before delete on stock.owner_returns
  for each row execute function stock.reject_mutation();

grant select, insert, update on stock.owner_returns to stock_api;

alter table stock.owner_returns enable row level security;

-- Read: same shape as wastage/counts — system/Central/accountant see
-- everything, an owner sees their own franchise's, an operator only their
-- own terminal's outlet.
create policy owner_returns_read on stock.owner_returns for select to stock_api using (
  stock.is_system() or stock.is_central() or stock.is_accountant()
  or stock.is_warehouse_manager() or stock.is_warehouse_staff()
  or stock.is_owner_of(franchise_id)
  or (outlet_id = stock.ctx_uuid('outlet_id'))
);

-- Insert: only the outlet side (owner or their terminal) opens a request.
create policy owner_returns_insert on stock.owner_returns for insert to stock_api with check (
  stock.is_system() or stock.is_central()
  or stock.is_owner_of(franchise_id)
  or (outlet_id = stock.ctx_uuid('outlet_id'))
);

-- Update: every later step (approve/reject/collect/receive/resolve) is a
-- Central or warehouse action. The requesting outlet — owner included — has
-- no update access to its own request once it exists, which is what
-- actually prevents self-approval; the application-level capability checks
-- are defense in depth on top of this, not the only guard.
create policy owner_returns_update on stock.owner_returns for update to stock_api using (
  stock.is_system() or stock.is_central()
  or stock.is_warehouse_manager() or stock.is_warehouse_staff()
) with check (
  stock.is_system() or stock.is_central()
  or stock.is_warehouse_manager() or stock.is_warehouse_staff()
);
