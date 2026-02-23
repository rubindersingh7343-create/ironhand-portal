alter table public.shift_reports
  alter column manager_id drop not null,
  alter column manager_name drop not null,
  add column if not exists employee_id text,
  add column if not exists employee_name text,
  add column if not exists gross_amount numeric not null default 0,
  add column if not exists liquor_amount numeric not null default 0,
  add column if not exists beer_amount numeric not null default 0,
  add column if not exists cig_amount numeric not null default 0,
  add column if not exists tobacco_amount numeric not null default 0,
  add column if not exists gas_amount numeric not null default 0,
  add column if not exists atm_amount numeric not null default 0,
  add column if not exists lotto_po_amount numeric not null default 0,
  add column if not exists deposit_amount numeric not null default 0,
  add column if not exists lotto_amount numeric not null default 0,
  add column if not exists store_amount numeric not null default 0,
  add column if not exists custom_fields jsonb not null default '[]'::jsonb;

create index if not exists shift_reports_store_employee_date_idx
  on public.shift_reports (store_id, employee_id, date);
