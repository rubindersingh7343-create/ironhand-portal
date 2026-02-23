create table if not exists owner_seen_items (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  store_id text not null,
  item_type text not null,
  item_id text not null,
  seen_at timestamptz not null default now()
);

create unique index if not exists owner_seen_items_unique
  on owner_seen_items (owner_id, item_type, item_id);

create index if not exists owner_seen_items_owner_store
  on owner_seen_items (owner_id, store_id);
