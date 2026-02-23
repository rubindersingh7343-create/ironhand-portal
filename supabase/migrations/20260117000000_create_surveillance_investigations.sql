create table if not exists surveillance_investigations (
  id uuid primary key,
  store_id text not null,
  report_id uuid not null,
  status text not null,
  assigned_to_user_id uuid not null,
  created_by_owner_id uuid not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists surveillance_investigations_report_idx
  on surveillance_investigations (report_id);

create index if not exists surveillance_investigations_store_idx
  on surveillance_investigations (store_id);
