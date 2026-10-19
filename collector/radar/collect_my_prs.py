"""Nikhil's own pull requests, so the radar knows where he already has a merge record."""

from __future__ import annotations

import logging
import statistics
from collections import Counter
from datetime import datetime
from typing import Any

from .github import GitHub
from .store import Store

log = logging.getLogger(__name__)

MY_PRS_QUERY = """
query($q: String!, $after: String) {
  rateLimit { cost remaining }
  search(query: $q, type: ISSUE, first: 100, after: $after) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        databaseId number title url state isDraft createdAt mergedAt closedAt
        repository { nameWithOwner }
      }
    }
  }
}
"""


def _row(n: dict[str, Any], now: datetime) -> dict[str, Any]:
    return {
        "id": n["databaseId"],
        "repo": n["repository"]["nameWithOwner"],
        "number": n["number"],
        "title": n["title"][:300],
        "url": n["url"],
        "state": n["state"],  # OPEN | MERGED | CLOSED
        "is_draft": bool(n.get("isDraft")),
        "created_at": n["createdAt"],
        "merged_at": n.get("mergedAt"),
        "closed_at": n.get("closedAt"),
        "updated_seen": now.isoformat(),
    }


def collect_my_prs(gh: GitHub, store: Store, login: str, now: datetime) -> int:
    """All PRs authored by `login` (search returns at most 1000, newest first)."""
    rows: list[dict[str, Any]] = []
    after = None
    for _ in range(10):
        data = gh.graphql(MY_PRS_QUERY, {"q": f"author:{login} is:pr sort:created-desc", "after": after})
        search = data["search"]
        rows.extend(_row(n, now) for n in search["nodes"] if n and n.get("databaseId"))
        if not search["pageInfo"]["hasNextPage"]:
            break
        after = search["pageInfo"]["endCursor"]
    store.upsert("my_prs", rows)
    log.info("my prs (%s): %d upserted", login, len(rows))
    return len(rows)


def merged_by_repo(prs: list[dict[str, Any]]) -> dict[str, int]:
    """Lowercased repo full name -> number of merged PRs there."""
    return dict(Counter(p["repo"].lower() for p in prs if p["state"] == "MERGED"))


def _parse(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def my_prs_summary(prs: list[dict[str, Any]], login: str) -> dict[str, Any]:
    """Stats and list for the website's My PRs page.

    Stats cover upstream PRs only: PRs into repos the login owns are self-merged and would inflate the rate.
    """
    own = f"{login.lower()}/"
    upstream = [p for p in prs if not p["repo"].lower().startswith(own)] if login else prs
    merged = [p for p in upstream if p["state"] == "MERGED"]
    closed = [p for p in upstream if p["state"] == "CLOSED"]
    hours = [
        (_parse(p["merged_at"]) - _parse(p["created_at"])).total_seconds() / 3600 for p in merged if p.get("merged_at")
    ]
    decided = len(merged) + len(closed)
    repos = Counter(p["repo"] for p in upstream)
    merged_repos = Counter(p["repo"] for p in merged)
    return {
        "login": login,
        "stats": {
            "opened": len(upstream),
            "open": sum(1 for p in upstream if p["state"] == "OPEN"),
            "merged": len(merged),
            "closed": len(closed),
            # merge rate over decided PRs only; open ones have no outcome yet
            "merge_rate": round(len(merged) / decided, 4) if decided else None,
            "median_merge_h": round(statistics.median(hours), 2) if hours else None,
            "repos": len(repos),
            "own_repo_prs": len(prs) - len(upstream),
        },
        "repos": [
            {"repo": r, "opened": n, "merged": merged_repos.get(r, 0)}
            for r, n in sorted(repos.items(), key=lambda kv: (-merged_repos.get(kv[0], 0), -kv[1]))
        ],
        "prs": sorted(
            ({**p, "is_draft": bool(p.get("is_draft"))} for p in prs), key=lambda p: p["created_at"], reverse=True
        ),
    }
