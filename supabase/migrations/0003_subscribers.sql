-- Public Telegram bot: people who sent /start, with their own alert settings.
-- Only the Telegram chat id is stored (no names or usernames).

create table if not exists subscribers (
  chat_id          bigint primary key,
  active           boolean not null default true,
  min_score        double precision not null default 0.75 check (min_score between 0.5 and 0.99),
  langs            jsonb not null default '[]',   -- lowercase repo languages; empty = all
  alerts           boolean not null default true,
  digest           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  cmd_window_start timestamptz,                   -- per-chat command rate limit
  cmd_count        integer not null default 0
);

create index if not exists subscribers_active_idx on subscribers(active);

-- Written only by the collector and the /api/telegram webhook with the service-role key.
alter table subscribers enable row level security;

-- Hardening from the security pass: the site reads feedback server-side with the service key now.
drop policy if exists "anon reads feedback" on feedback;
