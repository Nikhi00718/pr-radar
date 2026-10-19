"""Repo health signals from the last 90 days of pull requests.

"Outsider" = authorAssociation CONTRIBUTOR, FIRST_TIME_CONTRIBUTOR, FIRST_TIMER or NONE.
"""

from __future__ import annotations

import logging
import re
import statistics
from datetime import datetime, timedelta
from typing import Any

from .github import GitHub, GitHubError
from .store import Store

log = logging.getLogger(__name__)

OUTSIDER = {"CONTRIBUTOR", "FIRST_TIME_CONTRIBUTOR", "FIRST_TIMER", "NONE"}
MAINTAINER = {"OWNER", "MEMBER", "COLLABORATOR"}

SIGNALS_QUERY = """
query($owner: String!, $name: String!) {
  rateLimit { cost remaining }
  repository(owner: $owner, name: $name) {
    recent: pullRequests(first: 80, orderBy: {field: CREATED_AT, direction: DESC}) {
      nodes {
        state createdAt closedAt mergedAt authorAssociation
        comments(first: 6) { nodes { authorAssociation createdAt } }
        reviews(first: 6) { nodes { authorAssociation createdAt } }
      }
    }
    merged: pullRequests(first: 1, states: MERGED, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes { mergedAt }
    }
    stale: pullRequests(first: 100, states: OPEN, orderBy: {field: CREATED_AT, direction: ASC}) {
      totalCount nodes { createdAt }
    }
    defaultBranchRef {
      target { ... on Commit { history(first: 25) { nodes { statusCheckRollup { state } } } } }
    }
    c1: object(expression: "HEAD:CONTRIBUTING.md") { ... on Blob { text } }
    c2: object(expression: "HEAD:.github/CONTRIBUTING.md") { ... on Blob { text } }
    c3: object(expression: "HEAD:docs/CONTRIBUTING.md") { ... on Blob { text } }
    c4: object(expression: "HEAD:CONTRIBUTING.rst") { ... on Blob { text } }
    c5: object(expression: "HEAD:AI_POLICY.md") { ... on Blob { text } }
    c6: object(expression: "HEAD:.github/pull_request_template.md") { ... on Blob { text } }
  }
}
"""

_AI = r"(?:\bai\b|a\.i\.|artificial intelligence|\bllms?\b|copilot|chatgpt|claude|generative|ai[- ]generated|ai[- ]assisted|language models?)"  # noqa: E501
BANNED_PATTERNS = [
    rf"(?:do not|don't|must not|may not|never|not)\s+(?:submit|open|send|use|accept)[^.]{{0,80}}{_AI}",
    rf"{_AI}[^.]{{0,80}}(?:not (?:be )?(?:accepted|allowed|permitted|welcome)|(?:are|is|will be) (?:rejected|closed|banned|prohibited))",  # noqa: E501
    rf"(?:prohibit|ban|forbid)\w*[^.]{{0,60}}{_AI}",
    rf"\bno {_AI}[- ](?:generated|contributions|code|prs?)",
]
DISCLOSE_PATTERNS = [
    rf"(?:disclose|declare|mention|state|indicate|label)\w*[^.]{{0,80}}{_AI}",
    rf"{_AI}[^.]{{0,80}}(?:must|should|need to) (?:be )?(?:disclosed|declared|mentioned|labell?ed|noted)",
    rf"{_AI}[^.]{{0,100}}\b(?:disclose|declare)\b",
]


def classify_ai_policy(text: str) -> tuple[str, str | None]:
    """Keyword classifier for a repo's AI-contribution rules -> (policy, evidence sentence)."""
    if not text:
        return "unknown", None
    low = text.lower()
    sentences = re.split(r"(?<=[.!?])\s+|\n{2,}", low)
    for pats, label in ((BANNED_PATTERNS, "banned"), (DISCLOSE_PATTERNS, "disclose")):
        for sent in sentences:
            if any(re.search(p, sent) for p in pats):
                return label, sent.strip()[:240]
    for sent in sentences:
        if re.search(_AI, sent):
            return "allowed", sent.strip()[:240]
    return "unknown", None


def _parse(ts: str | None) -> datetime | None:
    return datetime.fromisoformat(ts.replace("Z", "+00:00")) if ts else None


def compute_signals(repo: dict[str, Any], now: datetime) -> dict[str, Any]:
    """Pure function over the GraphQL `repository` node (tested in tests/test_signals.py)."""
    cutoff = now - timedelta(days=90)
    merged = closed = 0
    responses: list[float] = []
    for pr in repo["recent"]["nodes"]:
        created = _parse(pr["createdAt"])
        if created is None or created < cutoff or pr["authorAssociation"] not in OUTSIDER:
            continue
        if pr["state"] in ("MERGED", "CLOSED"):
            closed += 1
            merged += pr["state"] == "MERGED"
        firsts = [
            _parse(n["createdAt"])
            for n in pr["comments"]["nodes"] + pr["reviews"]["nodes"]
            if n and n.get("authorAssociation") in MAINTAINER and n.get("createdAt")
        ]
        firsts = [f for f in firsts if f and f >= created]
        if firsts:
            responses.append((min(firsts) - created).total_seconds() / 3600)
        elif pr["state"] == "OPEN" and (now - created) > timedelta(days=2):
            # still unanswered: count time waited so far, which keeps the median honest
            responses.append((now - created).total_seconds() / 3600)

    last_merge = None
    if repo["merged"]["nodes"]:
        last_merge = _parse(repo["merged"]["nodes"][0]["mergedAt"])
    stale_cut = now - timedelta(days=30)
    backlog = sum(1 for n in repo["stale"]["nodes"] if _parse(n["createdAt"]) < stale_cut)

    ci_states = []
    target = (repo.get("defaultBranchRef") or {}).get("target") or {}
    for node in (target.get("history") or {}).get("nodes", []):
        roll = node.get("statusCheckRollup")
        if roll and roll["state"] in ("SUCCESS", "FAILURE", "ERROR"):
            ci_states.append(roll["state"] == "SUCCESS")

    docs = [repo.get(f"c{i}") for i in range(1, 7)]
    contributing = [d["text"] for d in docs[:4] if d and d.get("text")]
    policy_text = "\n\n".join(t for t in (d.get("text") if d else None for d in docs) if t)
    policy, evidence = classify_ai_policy(policy_text)

    return {
        "computed_at": now.isoformat(),
        "outside_prs_closed_90d": closed,
        "outside_prs_merged_90d": merged,
        "outside_merge_rate_90d": (merged / closed) if closed else None,
        "median_first_response_h": statistics.median(responses) if responses else None,
        "open_pr_backlog": backlog,
        "days_since_maintainer_merge": ((now - last_merge).total_seconds() / 86400) if last_merge else None,
        "ci_pass_rate": (sum(ci_states) / len(ci_states)) if ci_states else None,
        "has_contributing": bool(contributing),
        "ai_policy": policy,
        "ai_policy_evidence": evidence,
    }


def refresh_signals(gh: GitHub, store: Store, repo_names: list[str], ttl_hours: float, now: datetime) -> int:
    repos = {r["full_name"]: r for r in store.select("repos")}
    cached = {s["repo_id"]: s for s in store.select("repo_signals")}
    done = 0
    for full in repo_names:
        repo = repos.get(full)
        if not repo:
            continue
        old = cached.get(repo["id"])
        if old and now - _parse(old["computed_at"]) < timedelta(hours=ttl_hours):
            continue
        owner, name = full.split("/", 1)
        try:
            data = gh.graphql(SIGNALS_QUERY, {"owner": owner, "name": name})
        except GitHubError as e:
            log.warning("signals failed for %s: %s", full, e)
            continue
        if not data.get("repository"):
            continue
        row = compute_signals(data["repository"], now)
        row["repo_id"] = repo["id"]
        store.upsert("repo_signals", [row])
        done += 1
    log.info("signals refreshed: %d (graphql cost so far %d)", done, gh.graphql_cost)
    return done
