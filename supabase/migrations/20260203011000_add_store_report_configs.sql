create table if not exists store_report_configs (
  store_id text primary key,
  owner_id text,
  items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists store_report_configs_owner_id_idx
  on store_report_configs (owner_id);
