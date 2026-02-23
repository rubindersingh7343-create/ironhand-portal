create table if not exists store_chats (
  id uuid primary key default gen_random_uuid(),
  store_id text not null,
  chat_type text not null,
  owner_id text not null,
  participant_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists store_chats_unique
  on store_chats (store_id, chat_type, owner_id);

create index if not exists store_chats_participant
  on store_chats (participant_id);

create table if not exists store_chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references store_chats(id) on delete cascade,
  store_id text not null,
  chat_type text not null,
  owner_id text not null,
  sender_id text not null,
  sender_role text not null,
  sender_name text not null,
  message text not null,
  created_at timestamptz not null default now()
);

create index if not exists store_chat_messages_thread
  on store_chat_messages (thread_id, created_at);

create index if not exists store_chat_messages_owner
  on store_chat_messages (owner_id, store_id, chat_type);
