alter table if exists public.records
  add column if not exists invoice_due_date date,
  add column if not exists invoice_paid boolean not null default false,
  add column if not exists invoice_payment_method text,
  add column if not exists invoice_payment_details jsonb not null default '{}'::jsonb,
  add column if not exists invoice_paid_amount_cents bigint;

create index if not exists records_invoice_due_date_idx
  on public.records (invoice_due_date);
