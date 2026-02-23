alter table if exists scratcher_slots
  add column if not exists default_product_id uuid null references scratcher_products (id);
