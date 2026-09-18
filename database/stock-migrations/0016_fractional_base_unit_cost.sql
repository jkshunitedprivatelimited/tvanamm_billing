-- Milk bought per litre can cost a fractional paise per millilitre.
-- Retain existing integer costs exactly, matching valuation's six decimal places.
alter table stock.stock_movements alter column unit_cost_paise type numeric(30,6);
alter table stock.local_inwards alter column unit_cost_paise type numeric(30,6);
