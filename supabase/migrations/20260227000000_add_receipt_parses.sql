-- Receipt parsing artifacts (OCR + deterministic parse + optional LLM fill).
-- Additive only: safe to deploy; app treats this table as optional.

create table if not exists public.receipt_parses (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  store_id text not null,
  user_id uuid not null,
  shift_report_id uuid,
  shift_submission_id uuid,
  parse_version text not null,
  confidence_score integer not null default 0,
  raw_text text,
  normalized_text text,
  parsed_json jsonb not null default '{}'::jsonb,
  image_url text,
  bucket text
);

create index if not exists receipt_parses_store_id_created_at_idx
  on public.receipt_parses (store_id, created_at desc);

create index if not exists receipt_parses_shift_report_id_idx
  on public.receipt_parses (shift_report_id);

create index if not exists receipt_parses_shift_submission_id_idx
  on public.receipt_parses (shift_submission_id);

