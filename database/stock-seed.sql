-- TVANAMM Stock — development seed.
-- Wipes operational/test rows (keeps reference data: units, capabilities,
-- role_capabilities, feature_flags, schema_migrations) and inserts a small,
-- realistic TVANAMM dataset: two warehouses, their locations, the demo outlet's
-- sellable location, a supplier list, a core item catalogue and two published
-- recipes. Safe to re-run. Never run against production.

begin;

-- ---- 1. Clear operational data --------------------------------------------
truncate
  stock.stock_movements, stock.stock_balances, stock.item_valuation,
  stock.batches, stock.prepared_batches,
  stock.items, stock.item_barcodes, stock.item_unit_conversions,
  stock.warehouses, stock.stock_locations, stock.warehouse_assignments,
  stock.identity_projection,
  stock.suppliers, stock.purchase_orders, stock.purchase_order_lines,
  stock.supplier_receipts, stock.supplier_receipt_lines,
  stock.supplier_invoices, stock.supplier_payments,
  stock.supplier_returns, stock.credit_notes,
  stock.recipes, stock.recipe_versions, stock.recipe_components,
  stock.production_orders, stock.production_inputs, stock.production_outputs,
  stock.stock_counts, stock.stock_count_lines, stock.count_adjustment_approvals,
  stock.wastage_events, stock.stock_transfers, stock.stock_transfer_lines,
  stock.document_reversals,
  stock.supply_catalog_items, stock.supply_catalog_outlet_blocks,
  stock.delivery_charge_rules,
  stock.stock_orders, stock.stock_order_lines, stock.stock_order_allocations,
  stock.stock_order_payments, stock.stock_order_discrepancies,
  stock.stock_dispatches, stock.stock_dispatch_lines,
  stock.outlet_inwards, stock.outlet_inward_lines, stock.local_inwards,
  stock.recalls, stock.recall_locations,
  stock.daily_consumption_rollups, stock.reorder_suggestions, stock.anomaly_flags,
  stock.negative_stock_exceptions,
  stock.sale_consumptions, stock.sale_consumption_lines,
  stock.razorpay_webhook_events, stock.offline_drafts,
  stock.reconciliation_runs, stock.label_jobs,
  stock.outlet_stock_settings
  restart identity cascade;

-- ---- 2. Warehouses + locations ------------------------------------------
insert into stock.warehouses (id, organization_id, code, name, timezone, is_active) values
  ('a1000000-0000-4000-8000-000000000001','01000000-0000-4000-8000-000000000001','HYD-CW','TVANAMM Central Warehouse — Hyderabad','Asia/Kolkata',true),
  ('a1000000-0000-4000-8000-000000000002','01000000-0000-4000-8000-000000000001','VJA-HUB','TVANAMM Regional Hub — Vijayawada','Asia/Kolkata',true);

insert into stock.stock_locations (organization_id, scope, warehouse_id, kind, name, is_active)
select w.organization_id, 'warehouse', w.id, k.kind::stock.location_kind,
       initcap(replace(k.kind,'_',' ')) || ' — ' || w.code, true
from stock.warehouses w
cross join (values
  ('sellable'),('quarantine'),('damaged'),('returns'),('in_transit'),
  ('production_input'),('production_output'),('staging')
) as k(kind);

-- ---- 3. Demo outlet Stock settings + sellable location -----------------
insert into stock.outlet_stock_settings (outlet_id, organization_id, franchise_id, tracking_enabled, timezone)
values ('22222222-2222-4222-8222-222222222222','01000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111', true, 'Asia/Kolkata');

insert into stock.stock_locations (organization_id, scope, outlet_id, franchise_id, kind, name, is_active)
values ('01000000-0000-4000-8000-000000000001','outlet','22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','sellable','Front counter — Demo Outlet', true);

-- ---- 4. Suppliers (all approved) -------------------------------------
insert into stock.suppliers (id, organization_id, name, gstin, contact_name, contact_phone, payment_terms_days, is_approved, is_active) values
  ('b1000000-0000-4000-8000-000000000001','01000000-0000-4000-8000-000000000001','Sri Balaji Tea Traders','36AABCS1429B1Z5','Ravi Kumar','+919848011111',15,true,true),
  ('b1000000-0000-4000-8000-000000000002','01000000-0000-4000-8000-000000000001','Heritage Fresh Dairy','36AAACH0586R1Z2','Lakshmi N','+919848022222',7,true,true),
  ('b1000000-0000-4000-8000-000000000003','01000000-0000-4000-8000-000000000001','Deccan Sugar & Commodities','36AACCD1234E1Z9','Imran Shaikh','+919848033333',30,true,true),
  ('b1000000-0000-4000-8000-000000000004','01000000-0000-4000-8000-000000000001','Guntur Spice House','37AAECG7788K1Z1','Padma Rao','+919848044444',15,true,true),
  ('b1000000-0000-4000-8000-000000000005','01000000-0000-4000-8000-000000000001','EcoServe Packaging','36AAFCE9900L1Z6','Suresh Babu','+919848055555',30,true,true),
  ('b1000000-0000-4000-8000-000000000006','01000000-0000-4000-8000-000000000001','ClearDrop Water Supply','36AAGCC2233M1Z4','Anita Verma','+919848066666',7,true,true);

-- ---- 5. Core item catalogue ---------------------------------------
insert into stock.items
  (id, organization_id, brand_id, sku, name, item_type, dimension, base_unit,
   supply_rule, is_batch_tracked, shelf_life_days, order_pack, gst_rate, hsn_code, purchase_unit, is_active)
values
  ('c1000000-0000-4000-8000-000000000001','01000000-0000-4000-8000-000000000001','01000000-0000-4000-8000-000000000010','TEA-DUST-PREM','Premium Assam Tea Dust','raw_material','mass','g','jksh_required',true,365,1000,5,'0902','kg',true),
  ('c1000000-0000-4000-8000-000000000002','01000000-0000-4000-8000-000000000001','01000000-0000-4000-8000-000000000010','MILK-TONED','Toned Milk','raw_material','volume','ml','local_purchase',true,3,1000,5,'0401','l',true),
  ('c1000000-0000-4000-8000-000000000003','01000000-0000-4000-8000-000000000001','01000000-0000-4000-8000-000000000010','SUGAR-S30','Refined Sugar','raw_material','mass','g','flexible',false,540,1000,5,'1701','kg',true),
  ('c1000000-0000-4000-8000-000000000004','01000000-0000-4000-8000-000000000001','01000000-0000-4000-8000-000000000010','MASALA-CHAI','Chai Masala Blend','raw_material','mass','g','jksh_required',true,180,500,5,'0910','kg',true),
  ('c1000000-0000-4000-8000-000000000005','01000000-0000-4000-8000-000000000001','01000000-0000-4000-8000-000000000010','GINGER-FRESH','Fresh Ginger','raw_material','mass','g','local_purchase',false,14,1000,0,'0910','kg',true),
  ('c1000000-0000-4000-8000-000000000006','01000000-0000-4000-8000-000000000001','01000000-0000-4000-8000-000000000010','CARDAMOM-G','Green Cardamom','raw_material','mass','g','jksh_required',true,365,250,5,'0908','kg',true),
  ('c1000000-0000-4000-8000-000000000007','01000000-0000-4000-8000-000000000001','01000000-0000-4000-8000-000000000010','WATER-20L','Purified Water (20L can)','consumable','volume','ml','local_purchase',false,60,20000,18,'2201','each',true),
  ('c1000000-0000-4000-8000-000000000008','01000000-0000-4000-8000-000000000001','01000000-0000-4000-8000-000000000010','CUP-90','Paper Cup 90 ml','packaging','count','each','jksh_required',false,null,2000,18,'4823','each',true),
  ('c1000000-0000-4000-8000-000000000009','01000000-0000-4000-8000-000000000001','01000000-0000-4000-8000-000000000010','CUP-150','Paper Cup 150 ml','packaging','count','each','jksh_required',false,null,2000,18,'4823','each',true),
  ('c1000000-0000-4000-8000-000000000010','01000000-0000-4000-8000-000000000001','01000000-0000-4000-8000-000000000010','LID-DOME','Dome Lid','packaging','count','each','jksh_required',false,null,2000,18,'3923','each',true),
  ('c1000000-0000-4000-8000-000000000011','01000000-0000-4000-8000-000000000001','01000000-0000-4000-8000-000000000010','BAG-CARRY','Paper Carry Bag','packaging','count','each','flexible',false,null,500,18,'4819','each',true),
  ('c1000000-0000-4000-8000-000000000012','01000000-0000-4000-8000-000000000001','01000000-0000-4000-8000-000000000010','TEA-BASE-PREP','Prepared Tea Base','intermediate','volume','ml','jksh_required',true,1,null,5,null,null,true);

-- ---- 6. Two published recipes -----------------------------------
insert into stock.recipes (id, organization_id, brand_id, kind, name, status, current_version, output_item_id) values
  ('d1000000-0000-4000-8000-000000000001','01000000-0000-4000-8000-000000000001','01000000-0000-4000-8000-000000000010','menu_item','TVANAMM Special Tea (90 ml)','published',1,null),
  ('d1000000-0000-4000-8000-000000000002','01000000-0000-4000-8000-000000000001','01000000-0000-4000-8000-000000000010','menu_item','Ginger Tea (90 ml)','published',1,null);

insert into stock.recipe_versions
  (id, recipe_id, version, batch_yield_base, serving_qty_base, serving_unit, yield_unverified, checksum) values
  ('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001',1,1000,90,'ml',false,'seed-special-v1'),
  ('d2000000-0000-4000-8000-000000000002','d1000000-0000-4000-8000-000000000002',1,1000,90,'ml',false,'seed-ginger-v1');

insert into stock.recipe_components (recipe_version_id, component_type, item_id, qty_base, is_default, process_loss_pct) values
  -- Special Tea, per 1000 ml usable batch
  ('d2000000-0000-4000-8000-000000000001','fixed','c1000000-0000-4000-8000-000000000002',620,true,2),   -- toned milk
  ('d2000000-0000-4000-8000-000000000001','fixed','c1000000-0000-4000-8000-000000000001',48,true,0),    -- tea dust
  ('d2000000-0000-4000-8000-000000000001','fixed','c1000000-0000-4000-8000-000000000003',70,true,0),    -- sugar
  ('d2000000-0000-4000-8000-000000000001','fixed','c1000000-0000-4000-8000-000000000004',6,true,0),     -- masala
  ('d2000000-0000-4000-8000-000000000001','packaging','c1000000-0000-4000-8000-000000000008',11.11,true,0), -- 90ml cup per serving-scaled
  -- Ginger Tea
  ('d2000000-0000-4000-8000-000000000002','fixed','c1000000-0000-4000-8000-000000000002',600,true,2),
  ('d2000000-0000-4000-8000-000000000002','fixed','c1000000-0000-4000-8000-000000000001',50,true,0),
  ('d2000000-0000-4000-8000-000000000002','fixed','c1000000-0000-4000-8000-000000000003',72,true,0),
  ('d2000000-0000-4000-8000-000000000002','fixed','c1000000-0000-4000-8000-000000000005',18,true,8),
  ('d2000000-0000-4000-8000-000000000002','packaging','c1000000-0000-4000-8000-000000000008',11.11,true,0);

commit;
