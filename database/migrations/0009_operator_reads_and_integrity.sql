-- Stage 1 audit remediation (P1) - operator read scope + tenant-ID integrity.

-- ---- Narrow operator SELECT policies ---------------------------------------
-- A PIN-authenticated operator may read only its own employee row and its own
-- open operator sessions. Outlets are already readable via app.outlet_id.

create policy employee_operator_self on identity.store_employees
  for select to identity_api
  using (id = identity.ctx_uuid('operator_employee_id'));

create policy opsession_operator_self on identity.operator_sessions
  for select to identity_api
  using (employee_id = identity.ctx_uuid('operator_employee_id'));

-- ---- Composite tenant-ID integrity --------------------------------------
-- The organization id stored alongside a foreign key must match the referenced
-- row's organization, so a caller cannot smuggle a mismatched scope.

alter table billing.outlets      add constraint outlets_id_org_uniq       unique (id, organization_id);
alter table billing.franchises   add constraint franchises_id_org_uniq    unique (id, organization_id);
alter table billing.brands       add constraint brands_id_org_uniq        unique (id, organization_id);

alter table identity.store_employees
  add constraint store_employees_outlet_org_fk
  foreign key (outlet_id, organization_id) references billing.outlets(id, organization_id);

alter table identity.terminals
  add constraint terminals_outlet_org_fk
  foreign key (outlet_id, organization_id) references billing.outlets(id, organization_id);

alter table identity.terminal_activation_codes
  add constraint activation_codes_outlet_org_fk
  foreign key (outlet_id, organization_id) references billing.outlets(id, organization_id);

alter table identity.memberships
  add constraint memberships_franchise_org_fk
  foreign key (franchise_id, organization_id) references billing.franchises(id, organization_id);

alter table identity.memberships
  add constraint memberships_brand_org_fk
  foreign key (brand_id, organization_id) references billing.brands(id, organization_id);
