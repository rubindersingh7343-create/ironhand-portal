alter table if exists public.records
  add column if not exists invoice_number text,
  add column if not exists invoice_amount_cents bigint;
