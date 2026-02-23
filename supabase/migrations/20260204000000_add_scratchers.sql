create table if not exists public.scratcher_products (
  id uuid primary key default gen_random_uuid(),
  name text,
  price numeric not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.scratcher_files (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null,
  original_name text,
  mime_type text,
  size bigint,
  created_at timestamptz not null default now()
);

create table if not exists public.scratcher_slots (
  id uuid primary key default gen_random_uuid(),
  store_id text not null,
  slot_number int not null,
  label text,
  is_active boolean not null default true,
  active_pack_id uuid,
  created_at timestamptz not null default now(),
  unique (store_id, slot_number)
);

create table if not exists public.scratcher_packs (
  id uuid primary key default gen_random_uuid(),
  store_id text not null,
  slot_id uuid not null references public.scratcher_slots(id) on delete cascade,
  product_id uuid not null references public.scratcher_products(id),
  pack_code text,
  start_ticket text not null,
  end_ticket text not null,
  status text not null default 'active',
  activated_at timestamptz not null default now(),
  activated_by_user_id text not null,
  activation_receipt_file_id uuid not null references public.scratcher_files(id),
  ended_at timestamptz,
  ended_by_user_id text
);

alter table public.scratcher_slots
  add constraint scratcher_slots_active_pack_fk
  foreign key (active_pack_id)
  references public.scratcher_packs(id)
  on delete set null;

create table if not exists public.scratcher_shift_snapshots (
  id uuid primary key default gen_random_uuid(),
  shift_report_id uuid not null references public.shift_reports(id) on delete cascade,
  store_id text not null,
  employee_user_id text not null,
  snapshot_type text not null,
  created_at timestamptz not null default now(),
  unique (shift_report_id, snapshot_type)
);

create table if not exists public.scratcher_shift_snapshot_items (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.scratcher_shift_snapshots(id) on delete cascade,
  slot_id uuid not null references public.scratcher_slots(id) on delete cascade,
  pack_id uuid references public.scratcher_packs(id),
  ticket_value text not null,
  photo_file_id uuid references public.scratcher_files(id),
  created_at timestamptz not null default now(),
  unique (snapshot_id, slot_id)
);

create table if not exists public.scratcher_pack_events (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null references public.scratcher_packs(id) on delete cascade,
  event_type text not null,
  created_at timestamptz not null default now(),
  created_by_user_id text not null,
  note text,
  file_id uuid references public.scratcher_files(id)
);

create table if not exists public.scratcher_shift_calculations (
  id uuid primary key default gen_random_uuid(),
  shift_report_id uuid not null unique references public.shift_reports(id) on delete cascade,
  store_id text not null,
  employee_user_id text not null,
  expected_total_tickets int not null,
  expected_total_value numeric not null,
  reported_scr_value numeric,
  variance_value numeric not null,
  breakdown_json jsonb not null,
  flags_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.shift_reports
  add column if not exists has_scratcher_discrepancy boolean not null default false;

create index if not exists scratcher_slots_store_idx on public.scratcher_slots(store_id);
create index if not exists scratcher_packs_store_idx on public.scratcher_packs(store_id);
create index if not exists scratcher_snapshots_store_idx on public.scratcher_shift_snapshots(store_id);
create index if not exists scratcher_calculations_store_idx on public.scratcher_shift_calculations(store_id);
