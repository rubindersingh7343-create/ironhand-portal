create table if not exists public.upload_items (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  storage_path text not null unique,
  filename text not null,
  mime_type text,
  size bigint,
  category text,
  status text not null,
  error_message text,
  metadata jsonb
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'upload_items_status_check'
  ) then
    alter table public.upload_items
      add constraint upload_items_status_check
      check (status in (
        'idle',
        'preparing',
        'uploading',
        'uploaded',
        'processing',
        'needs_review',
        'complete',
        'error'
      ));
  end if;
end $$;

create index if not exists upload_items_category_idx on public.upload_items (category);
create index if not exists upload_items_status_idx on public.upload_items (status);

