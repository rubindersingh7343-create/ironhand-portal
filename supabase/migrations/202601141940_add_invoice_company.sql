alter table if exists public.records
  add column if not exists invoice_company text;
