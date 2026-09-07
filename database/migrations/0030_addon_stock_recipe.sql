-- Billing <-> Stock recipe contract: paid add-ons carry their own Stock recipe
-- reference, mirroring billing.catalog_items. A published menu snapshots the
-- add-on recipe alongside the item recipe so SaleCompleted can consume add-on
-- ingredients (`docs/architecture/billing-stock-recipe-contract.md`).

alter table billing.addons
  add column if not exists stock_recipe_id      uuid,
  add column if not exists stock_recipe_version integer;

alter table billing.addons
  drop constraint if exists addons_stock_recipe_pair;
alter table billing.addons
  add constraint addons_stock_recipe_pair check (
    (stock_recipe_id is null) = (stock_recipe_version is null)
  );
