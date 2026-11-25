-- Per-outlet receipt layout chosen by the Franchise Owner (or Central).
--
-- Controls optional receipt content: address/phone/time/payment/notes lines,
-- customer name and mobile (hidden, masked or full), cashier name, and a custom
-- header and footer line. Outlet name and GSTIN always print (legal content).
-- Applied when a receipt is rendered, so reprints follow the current layout;
-- the legal header itself stays frozen per bill (0031).

create table if not exists billing.outlet_receipt_settings (
  outlet_id       uuid primary key references billing.outlets(id) on delete cascade,
  organization_id uuid not null,
  franchise_id    uuid,
  settings        jsonb not null default '{}'::jsonb,
  updated_by      uuid references identity.account_profiles(id) on delete set null,
  updated_at      timestamptz not null default now()
);

alter table billing.outlet_receipt_settings enable row level security;
grant select, insert, update on billing.outlet_receipt_settings to identity_api;

create policy receipt_settings_read on billing.outlet_receipt_settings for select to identity_api
  using (
    identity.is_system() or identity.is_central() or identity.is_owner_of(franchise_id)
    or (identity.ctx('request') = 'operator' and outlet_id = identity.ctx_uuid('outlet_id'))
  );
create policy receipt_settings_write on billing.outlet_receipt_settings for all to identity_api
  using (identity.is_system() or identity.is_central() or identity.is_owner_of(franchise_id))
  with check (identity.is_system() or identity.is_central() or identity.is_owner_of(franchise_id));
