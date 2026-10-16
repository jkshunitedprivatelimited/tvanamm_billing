-- Permissive FOR ALL policies also participate in SELECT. The former write
-- policy OR-ed a role/org-only condition into reads and bypassed outlet scope.
-- Use the same audience predicate for SELECT and UPDATE; only system work may
-- insert notifications. No notification data is deleted or rewritten.
create function identity.can_access_notification(
  org uuid, franchise uuid, outlet uuid, recipient_role text, recipient_account uuid
) returns boolean language sql stable as $$
  select coalesce(
    org = identity.ctx_uuid('organization_id')
    and (recipient_account is null or recipient_account = identity.ctx_uuid('account_id'))
    and (recipient_role is null or recipient_role = case
      when identity.ctx('request') = 'operator' then 'store_employee'
      else identity.ctx('role') end)
    and (recipient_account is not null or recipient_role is not null)
    and (
      identity.is_central() or identity.is_accountant()
      or (
        (franchise is null or franchise = identity.ctx_uuid('franchise_id'))
        and (outlet is null or outlet = identity.ctx_uuid('outlet_id')
          or (
            identity.ctx('role') = 'franchise_owner'
            and identity.ctx_uuid('outlet_id') is null
            and exists (
              select 1 from billing.outlets o
              where o.id = outlet and o.organization_id = org
                and o.franchise_id = identity.ctx_uuid('franchise_id')
            )
          ))
      )
    ), false
  )
$$;

drop policy notifications_read on identity.notifications;
drop policy notifications_write on identity.notifications;

create policy notifications_system on identity.notifications for all to identity_api
  using (identity.is_system()) with check (identity.is_system());

create policy notifications_read on identity.notifications for select to identity_api
  using (identity.can_access_notification(
    organization_id, franchise_id, outlet_id, recipient_role, recipient_account_id
  ));

create policy notifications_update on identity.notifications for update to identity_api
  using (identity.can_access_notification(
    organization_id, franchise_id, outlet_id, recipient_role, recipient_account_id
  ))
  with check (identity.can_access_notification(
    organization_id, franchise_id, outlet_id, recipient_role, recipient_account_id
  ));
