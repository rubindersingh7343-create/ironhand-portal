create table if not exists order_vendors (
  id uuid primary key,
  store_id text not null,
  name text not null,
  rep_name text,
  contact text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists weekly_orders (
  id uuid primary key,
  store_id text not null,
  vendor_id uuid not null references order_vendors(id) on delete restrict,
  period_type text not null,
  period_start date not null,
  status text not null,
  created_by_id uuid not null,
  created_by_name text not null,
  approved_by_id uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists weekly_orders_store_period_idx
  on weekly_orders (store_id, period_type, period_start);

create index if not exists weekly_orders_vendor_idx
  on weekly_orders (vendor_id);

create table if not exists weekly_order_items (
  id uuid primary key,
  order_id uuid not null references weekly_orders(id) on delete cascade,
  product_name text not null,
  units_on_hand int not null default 0,
  units_to_order int not null default 0
);

create index if not exists weekly_order_items_order_idx
  on weekly_order_items (order_id);

create table if not exists weekly_order_messages (
  id uuid primary key,
  order_id uuid not null references weekly_orders(id) on delete cascade,
  sender_role text not null,
  sender_name text not null,
  message text not null,
  created_at timestamptz not null default now()
);

create index if not exists weekly_order_messages_order_idx
  on weekly_order_messages (order_id);
