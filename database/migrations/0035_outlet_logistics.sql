-- Branch logistics captured at outlet creation: the nearest landmark for
-- deliveries and the GST-inclusive transport charge JKSH adds when supplying
-- this branch.

alter table billing.outlets
  add column if not exists nearest_bus_stop text,
  add column if not exists transport_charge_paise bigint not null default 0
    check (transport_charge_paise >= 0);
