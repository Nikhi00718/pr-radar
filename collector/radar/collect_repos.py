"""Find new and watched repos and record a star/fork snapshot for each run."""

from __future__ import annotations

import logging
import re
from datetime import UTC, datetime, timedelta

import httpx

from .config import WATCHLIST, Settings
from .github import GitHub
from .store import Store

log = logging.getLogger(__name__)

REPO_FIELDS = """
  databaseId nameWithOwner description createdAt stargazerCount forkCount
  primaryLanguage { name }
  repositoryTopics(first: 8) { nodes { topic { name } } }
  pullRequests(states: OPEN) { totalCount }
  issues(states: OPEN) { totalCount }
  isArchived
"""


# GitHub owner/repo names; anything else never reaches a GraphQL query string
REPO_NAME = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})/[A-Za-z0-9_.-]{1,100}$")


def valid_repo_name(full: str) -> bool:
    return bool(REPO_NAME.match(full)) and ".." not in full


def now_utc() -> datetime:
    return datetime.now(UTC).replace(second=0, microsecond=0)


def collect_new_repos(gh: GitHub, store: Store, s: Settings, taken_at: datetime) -> list[str]:
    since = (taken_at - timedelta(days=s.new_repo_window_days)).date().isoformat()
    q = f"created:>{since} stars:>{s.new_repo_min_stars} archived:false"
    items = gh.search("repositories", q, sort="stars", per_page=50, pages=max(1, s.new_repo_limit // 50 + 1))
    items = items[: s.new_repo_limit]
    repos, snaps = [], []
    for it in items:
        repos.append(
            {
                "id": it["id"],
                "full_name": it["full_name"],
                "description": (it.get("description") or "")[:400],
                "language": it.get("language"),
                "topics": it.get("topics", [])[:8],
                "source": "search",
                "created_at": it["created_at"],
                "first_seen_at": taken_at.isoformat(),
            }
        )
        snaps.append(
            {
                "repo_id": it["id"],
                "taken_at": taken_at.isoformat(),
                "stars": it["stargazers_count"],
                "forks": it["forks_count"],
                "open_prs": None,
                "open_issues": it.get("open_issues_count"),
            }
        )
    _upsert_repos(store, repos)
    store.upsert("repo_snapshots", snaps)
    log.info("new repos: %d", len(repos))
    return [r["full_name"] for r in repos]


def scrape_trending(language: str = "") -> list[str]:
    """Optional: parse github.com/trending. Breaks if GitHub changes its HTML, so failures are non-fatal."""
    try:
        r = httpx.get(
            f"https://github.com/trending/{language}",
            params={"since": "daily"},
            timeout=30,
            headers={"User-Agent": "pr-radar (personal dashboard)"},
        )
        r.raise_for_status()
    except httpx.HTTPError as e:
        log.warning("trending scrape failed: %s", e)
        return []
    names = re.findall(r'<h2 class="h3 lh-condensed">\s*<a[^>]*href="/([^/"]+/[^/"]+)"', r.text)
    return [n for n in dict.fromkeys(names) if valid_repo_name(n)][:25]


def collect_tracked(gh: GitHub, store: Store, names: list[str], source: str, taken_at: datetime) -> list[str]:
    """Snapshot named repos via batched GraphQL (20 repos per query)."""
    found: list[str] = []
    names = [n for n in names if valid_repo_name(n)]
    for i in range(0, len(names), 20):
        chunk = names[i : i + 20]
        parts = []
        for j, full in enumerate(chunk):
            owner, name = full.split("/", 1)
            parts.append(f'r{j}: repository(owner: "{owner}", name: "{name}") {{ {REPO_FIELDS} }}')
        data = gh.graphql("query { rateLimit { cost remaining } " + " ".join(parts) + " }", {})
        repos, snaps = [], []
        for j in range(len(chunk)):
            node = data.get(f"r{j}")
            if not node or node.get("isArchived"):
                continue
            repos.append(
                {
                    "id": node["databaseId"],
                    "full_name": node["nameWithOwner"],
                    "description": (node.get("description") or "")[:400],
                    "language": (node.get("primaryLanguage") or {}).get("name"),
                    "topics": [t["topic"]["name"] for t in node["repositoryTopics"]["nodes"]],
                    "source": source,
                    "created_at": node["createdAt"],
                    "first_seen_at": taken_at.isoformat(),
                }
            )
            snaps.append(
                {
                    "repo_id": node["databaseId"],
                    "taken_at": taken_at.isoformat(),
                    "stars": node["stargazerCount"],
                    "forks": node["forkCount"],
                    "open_prs": node["pullRequests"]["totalCount"],
                    "open_issues": node["issues"]["totalCount"],
                }
            )
            found.append(node["nameWithOwner"])
        _upsert_repos(store, repos)
        store.upsert("repo_snapshots", snaps)
    log.info("%s repos: %d", source, len(found))
    return found


def _upsert_repos(store: Store, repos: list[dict]) -> None:
    """Keep the original first_seen_at and the strongest source label for repos we already know."""
    if not repos:
        return
    known = {r["id"]: r for r in store.select("repos")}
    rank = {"watchlist": 3, "trending": 2, "search": 1}
    for r in repos:
        old = known.get(r["id"])
        if old:
            r["first_seen_at"] = old["first_seen_at"]
            if rank.get(old["source"], 0) > rank.get(r["source"], 0):
                r["source"] = old["source"]
    store.upsert("repos", repos)


def collect_all(gh: GitHub, store: Store, s: Settings, taken_at: datetime, trending: bool = True) -> None:
    collect_new_repos(gh, store, s, taken_at)
    collect_tracked(gh, store, WATCHLIST, "watchlist", taken_at)
    if trending:
        names = scrape_trending()
        if names:
            collect_tracked(gh, store, names, "trending", taken_at)
