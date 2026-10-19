-- PR Radar schema. Run once in the Supabase SQL editor (or `supabase db push`).

create table if not exists repos (
  id            bigint primary key,            -- GitHub databaseId
  full_name     text not null unique,
  description   text,
  language      text,
  topics        jsonb not null default '[]',
  source        text not null default 'search', -- search | watchlist | trending
  created_at    timestamptz,
  first_seen_at timestamptz not null default now()
);

create table if not exists repo_snapshots (
  repo_id     bigint not null references repos(id) on delete cascade,
  taken_at    timestamptz not null,
  stars       integer not null,
  forks       integer not null,
  open_prs    integer,
  open_issues integer,
  primary key (repo_id, taken_at)
);

create table if not exists repo_signals (
  repo_id                     bigint primary key references repos(id) on delete cascade,
  computed_at                 timestamptz not null,
  outside_prs_closed_90d      integer,
  outside_prs_merged_90d      integer,
  outside_merge_rate_90d      double precision,
  median_first_response_h     double precision,
  open_pr_backlog             integer,
  days_since_maintainer_merge double precision,
  ci_pass_rate                double precision,
  has_contributing            boolean,
  ai_policy                   text not null default 'unknown'
    check (ai_policy in ('allowed', 'disclose', 'banned', 'unknown')),
  ai_policy_evidence          text
);

create table if not exists issues (
  id            bigint primary key,            -- GitHub databaseId
  repo_id       bigint not null references repos(id) on delete cascade,
  number        integer not null,
  title         text not null,
  url           text not null,
  labels        jsonb not null default '[]',
  created_at    timestamptz not null,
  comments      integer not null default 0,
  assignee      text,
  has_linked_pr boolean not null default false,
  state         text not null default 'open',
  updated_seen  timestamptz not null default now(),
  unique (repo_id, number)
);

create table if not exists news_items (
  id           text primary key,               -- e.g. hn:123, release:owner/repo@tag
  source       text not null,                  -- hn | release
  title        text not null,
  url          text not null,
  points       integer,
  comments     integer,
  published_at timestamptz not null,
  tags         jsonb not null default '[]'
);

create table if not exists scores (
  target_type   text not null,                 -- issue | repo | news
  target_id     text not null,
  score         double precision not null,
  reasons_json  jsonb not null default '[]',
  model_version text not null,
  scored_at     timestamptz not null,
  primary key (target_type, target_id)
);

create table if not exists alerts (
  id        text primary key,                  -- channel:target
  target_id text not null,
  channel   text not null,
  sent_at   timestamptz not null default now()
);

create table if not exists feedback (
  id        bigint generated always as identity primary key,
  target_id text not null,                     -- issue:<id> | repo:<full_name>
  action    text not null check (action in ('opened_pr', 'merged', 'ignored', 'hidden', 'working', 'cleared')),
  at        timestamptz not null default now()
);

-- One row the website reads: the scored, ready-to-render state written after each run.
create table if not exists site_snapshot (
  id           integer primary key default 1 check (id = 1),
  generated_at timestamptz not null,
  payload      jsonb not null
);

create index if not exists issues_repo_idx on issues(repo_id);
create index if not exists snapshots_taken_idx on repo_snapshots(taken_at);
create index if not exists news_published_idx on news_items(published_at desc);

-- Row level security: the public anon key can only read the site snapshot and feedback.
-- The collector and the website's /api/feedback route use the service-role key (server side only),
-- which bypasses RLS, so nobody can write feedback from the browser directly.
alter table repos          enable row level security;
alter table repo_snapshots enable row level security;
alter table repo_signals   enable row level security;
alter table issues         enable row level security;
alter table news_items     enable row level security;
alter table scores         enable row level security;
alter table alerts         enable row level security;
alter table feedback       enable row level security;
alter table site_snapshot  enable row level security;

drop policy if exists "anon reads snapshot" on site_snapshot;
create policy "anon reads snapshot" on site_snapshot for select using (true);
drop policy if exists "anon reads feedback" on feedback;
create policy "anon reads feedback" on feedback for select using (true);
