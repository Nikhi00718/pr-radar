"""Open, contributor-friendly issues for tracked repos, with linked-PR detection."""

from __future__ import annotations

import logging
from datetime import datetime

from .config import ISSUE_LABEL_BLOCK, ISSUE_LABEL_HINTS
from .github import GitHub, GitHubError
from .store import Store

log = logging.getLogger(__name__)

ISSUES_QUERY = """
query($owner: String!, $name: String!) {
  rateLimit { cost remaining }
  repository(owner: $owner, name: $name) {
    issues(first: 60, states: OPEN, orderBy: {field: CREATED_AT, direction: DESC}) {
      nodes {
        databaseId number title url createdAt
        labels(first: 10) { nodes { name } }
        comments { totalCount }
        assignees(first: 1) { nodes { login } }
        timelineItems(first: 15, itemTypes: [CROSS_REFERENCED_EVENT, CONNECTED_EVENT]) {
          nodes {
            __typename
            ... on CrossReferencedEvent { source { __typename ... on PullRequest { state } } }
            ... on ConnectedEvent { subject { __typename ... on PullRequest { state } } }
          }
        }
      }
    }
  }
}
"""


def label_bonus(labels: list[str]) -> float:
    best = 0.0
    for lab in labels:
        low = lab.lower()
        for hint, bonus in ISSUE_LABEL_HINTS.items():
            if hint in low:
                best = max(best, bonus)
    return best


def is_blocked_label(labels: list[str]) -> bool:
    return any(b in lab.lower() for lab in labels for b in ISSUE_LABEL_BLOCK)


def has_live_linked_pr(node: dict) -> bool:
    """A linked PR that is open or merged means someone already has it. Closed-unmerged PRs don't count."""
    for ev in node["timelineItems"]["nodes"]:
        if not ev:
            continue
        pr = ev.get("source") if ev["__typename"] == "CrossReferencedEvent" else ev.get("subject")
        if pr and pr.get("__typename") == "PullRequest" and pr.get("state") in ("OPEN", "MERGED"):
            return True
    return False


def collect_issues(gh: GitHub, store: Store, repo_names: list[str], now: datetime) -> int:
    repos = {r["full_name"]: r for r in store.select("repos")}
    total = 0
    for full in repo_names:
        repo = repos.get(full)
        if not repo:
            continue
        owner, name = full.split("/", 1)
        try:
            data = gh.graphql(ISSUES_QUERY, {"owner": owner, "name": name})
        except GitHubError as e:
            log.warning("issues failed for %s: %s", full, e)
            continue
        nodes = ((data.get("repository") or {}).get("issues") or {}).get("nodes") or []
        rows = []
        for n in nodes:
            labels = [lab["name"] for lab in n["labels"]["nodes"]]
            if label_bonus(labels) == 0 or is_blocked_label(labels):
                continue
            assignees = n["assignees"]["nodes"]
            rows.append(
                {
                    "id": n["databaseId"],
                    "repo_id": repo["id"],
                    "number": n["number"],
                    "title": n["title"][:300],
                    "url": n["url"],
                    "labels": labels,
                    "created_at": n["createdAt"],
                    "comments": n["comments"]["totalCount"],
                    "assignee": assignees[0]["login"] if assignees else None,
                    "has_linked_pr": has_live_linked_pr(n),
                    "state": "open",
                    "updated_seen": now.isoformat(),
                }
            )
        # issues no longer in the newest-open window (closed, or pushed out by newer ones) stop being shown
        seen = {r["id"] for r in rows}
        stale = [
            {**i, "state": "stale"}
            for i in store.select("issues", eq={"repo_id": repo["id"], "state": "open"})
            if i["id"] not in seen
        ]
        store.upsert("issues", rows + stale)
        total += len(rows)
    log.info("issues upserted: %d (graphql cost so far %d)", total, gh.graphql_cost)
    return total
