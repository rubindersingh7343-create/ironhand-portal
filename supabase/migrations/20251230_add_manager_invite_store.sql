alter table if exists manager_invites
  add column if not exists store_id text,
  add column if not exists store_name text,
  add column if not exists store_address text;
