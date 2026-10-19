-- Nikhil's own pull requests (GraphQL search `author:<login> is:pr`), refreshed each run.
-- Feeds the My PRs page and the score boost for repos where he already has merged PRs.

create table if not exists my_prs (
  id           bigint primary key,             -- GitHub databaseId
  repo         text not null,                  -- owner/name
  number       integer not null,
  title        text not null,
  url          text not null,
  state        text not null check (state in ('OPEN', 'MERGED', 'CLOSED')),
  is_draft     boolean not null default false,
  created_at   timestamptz not null,
  merged_at    timestamptz,
  closed_at    timestamptz,
  updated_seen timestamptz not null default now(),
  unique (repo, number)
);

create index if not exists my_prs_repo_idx on my_prs(repo);

-- Collector writes with the service-role key; the site reads it through site_snapshot only.
alter table my_prs enable row level security;
