-- Mapped editor state is separate from immutable chef/AI source snapshots.
alter table stock.recipes
  add column version_draft jsonb,
  add column version_draft_revision integer not null default 0,
  add column version_draft_base_version integer;
