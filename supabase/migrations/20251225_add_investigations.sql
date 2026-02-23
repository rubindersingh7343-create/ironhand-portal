create table if not exists investigations (
  id uuid primary key,
  store_id text not null,
  date date not null,
  shift_report_id uuid not null,
  status text not null,
  assigned_to_user_id uuid not null,
  created_by_owner_id uuid not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists investigations_shift_report_date_idx
  on investigations (shift_report_id, date);

create index if not exists investigations_store_date_idx
  on investigations (store_id, date);
