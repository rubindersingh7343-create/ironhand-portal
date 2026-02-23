create table if not exists public.shift_reports (
  id uuid primary key,
  store_id text not null,
  manager_id text,
  manager_name text,
  employee_id text,
  employee_name text,
  date date not null,
  gross_amount numeric not null default 0,
  liquor_amount numeric not null default 0,
  beer_amount numeric not null default 0,
  cig_amount numeric not null default 0,
  tobacco_amount numeric not null default 0,
  gas_amount numeric not null default 0,
  atm_amount numeric not null default 0,
  lotto_po_amount numeric not null default 0,
  deposit_amount numeric not null default 0,
  scr_amount numeric not null default 0,
  lotto_amount numeric not null default 0,
  cash_amount numeric not null default 0,
  store_amount numeric not null default 0,
  net_amount numeric not null default 0,
  custom_fields jsonb not null default '[]'::jsonb,
  investigation_flag boolean not null default false,
  investigation_reason text,
  updated_at timestamptz not null default now()
);

create index if not exists shift_reports_store_date_idx
  on public.shift_reports (store_id, date);

create index if not exists shift_reports_store_employee_date_idx
  on public.shift_reports (store_id, employee_id, date);
