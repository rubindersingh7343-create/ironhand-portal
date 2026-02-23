alter table if exists public.records
  drop constraint if exists records_category_check;

alter table if exists public.records
  add constraint records_category_check
  check (
    category in (
      'shift',
      'daily',
      'weekly',
      'monthly',
      'surveillance',
      'invoice',
      'hours',
      'hours-rate',
      'hours-payment'
    )
  );
