-- Stage 1 audit remediation (independent review, P1) - complete DB-enforced
-- tenant integrity. Beyond the organization-id checks in 0009, prove that:
--   * an outlet's franchise belongs to the outlet's brand;
--   * an employee's / terminal's / activation code's franchise matches its outlet;
--   * a membership's franchise belongs to its brand.
-- Composite foreign keys (MATCH SIMPLE): when a franchise/brand column is NULL
-- the row is a jksh_owned / org-scoped case and the check does not apply.

alter table billing.franchises add constraint franchises_id_brand_uniq unique (id, brand_id);
alter table billing.outlets    add constraint outlets_id_franchise_uniq unique (id, franchise_id);

-- Outlet's franchise must belong to the outlet's brand.
alter table billing.outlets
  add constraint outlets_franchise_brand_fk
  foreign key (franchise_id, brand_id) references billing.franchises(id, brand_id);

-- Employee / terminal / activation code franchise must match the outlet's franchise.
alter table identity.store_employees
  add constraint store_employees_outlet_franchise_fk
  foreign key (outlet_id, franchise_id) references billing.outlets(id, franchise_id);

alter table identity.terminals
  add constraint terminals_outlet_franchise_fk
  foreign key (outlet_id, franchise_id) references billing.outlets(id, franchise_id);

alter table identity.terminal_activation_codes
  add constraint activation_codes_outlet_franchise_fk
  foreign key (outlet_id, franchise_id) references billing.outlets(id, franchise_id);

-- Membership's franchise must belong to its brand.
alter table identity.memberships
  add constraint memberships_franchise_brand_fk
  foreign key (franchise_id, brand_id) references billing.franchises(id, brand_id);
