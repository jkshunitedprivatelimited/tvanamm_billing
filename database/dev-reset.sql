-- Billing + Identity — development reset.
-- Clears all operational and integration-test rows, keeps reference data
-- (roles, capabilities, role_capabilities, schema_migrations) and the
-- canonical JKSH organization + TVANAMM / T Leaf brands. Follow with
-- `npm run db:seed` to recreate the demo franchise, demo outlet and the two
-- BOOTSTRAP_* OTP login accounts. Never run against production.

begin;

truncate
  audit.events,
  outbox.events,
  billing.addon_groups,
  billing.addons,
  billing.bill_discounts,
  billing.bill_line_addons,
  billing.bill_lines,
  billing.bills,
  billing.cash_sessions,
  billing.catalog_items,
  billing.catalog_price_history,
  billing.categories,
  billing.combo_components,
  billing.combos,
  billing.employee_shifts,
  billing.expense_categories,
  billing.expense_config,
  billing.franchises,
  billing.import_job_rows,
  billing.import_jobs,
  billing.item_addon_groups,
  billing.menu_publication_targets,
  billing.menu_publications,
  billing.offer_outlets,
  billing.offer_targets,
  billing.offers,
  billing.outlet_addon_overrides,
  billing.outlet_expense_settings,
  billing.outlet_expenses,
  billing.outlet_item_overrides,
  billing.outlet_menu_version_combos,
  billing.outlet_menu_version_items,
  billing.outlet_menu_versions,
  billing.outlets,
  billing.payments,
  billing.print_attempts,
  billing.receipt_number_voids,
  billing.receipt_reservations,
  billing.receipt_sequences,
  billing.refund_lines,
  billing.refunds,
  billing.retention_exports,
  billing.tax_profiles,
  identity.account_profiles,
  identity.activation_attempts,
  identity.attendance_corrections,
  identity.attendance_sessions,
  identity.invitations,
  identity.memberships,
  identity.notification_mutes,
  identity.notifications,
  identity.operator_sessions,
  identity.otp_attempts,
  identity.outlet_schedules,
  identity.store_employees,
  identity.sync_attempts,
  identity.terminal_activation_codes,
  identity.terminal_credentials,
  identity.terminal_pin_attempts,
  identity.terminals
  restart identity cascade;

-- Drop non-canonical orgs / brands left by integration tests.
delete from billing.brands where id not in (
  '01000000-0000-4000-8000-000000000010',
  '01000000-0000-4000-8000-000000000011'
);
delete from billing.organizations where id <> '01000000-0000-4000-8000-000000000001';

commit;
