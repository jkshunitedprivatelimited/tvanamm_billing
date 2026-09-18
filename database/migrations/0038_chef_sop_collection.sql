-- Scoped, revocable chef input. Drafts never change live recipes or prices.
create table billing.sop_collections (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references billing.organizations(id),
 created_by uuid not null references identity.account_profiles(id),
 title text not null,
 token_hash text not null unique,
 menu jsonb not null,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now() + interval '30 days',
 revoked_at timestamptz,
 submitted_at timestamptz
);
create table billing.sop_collection_entries (
 collection_id uuid not null references billing.sop_collections(id),
 item_id uuid not null,
 draft jsonb not null,
 revision integer not null default 1,
 updated_at timestamptz not null default now(),
 primary key(collection_id,item_id)
);
alter table billing.sop_collections enable row level security;
alter table billing.sop_collection_entries enable row level security;
-- No public/API-role grants: access is only through the server's explicit
-- organization check or a hashed, expiring collection capability.
