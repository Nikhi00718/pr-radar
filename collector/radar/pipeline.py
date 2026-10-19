"""Score everything and publish one ready-to-render snapshot for the website."""

from __future__ import annotations

import json
import logging
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any

from .collect_my_prs import merged_by_repo
from .config import WEB_SNAPSHOT
from .score import active_model_version, score_issue, score_news, score_repo
from .store import Store

log = logging.getLogger(__name__)


def _parse(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


LOCAL_FEEDBACK = WEB_SNAPSHOT.parent / "feedback.local.json"


def sync_local_feedback(store: Store) -> int:
    """Local mode: the website appends button clicks to web/data/feedback.local.json; move them into the store."""
    if not LOCAL_FEEDBACK.exists():
        return 0
    rows = json.loads(LOCAL_FEEDBACK.read_text(encoding="utf-8") or "[]")
    have = {(f["target_id"], f["action"], f["at"]) for f in store.select("feedback")}
    new = [r for r in rows if (r["target_id"], r["action"], r["at"]) not in have]
    store.insert("feedback", [{"target_id": r["target_id"], "action": r["action"], "at": r["at"]} for r in new])
    return len(new)


def hidden_targets(store: Store) -> set[str]:
    """Targets whose latest feedback is hidden/ignored (a later 'cleared' undoes it)."""
    latest: dict[str, str] = {}
    for f in store.select("feedback", order="at"):
        latest[f["target_id"]] = f["action"]
    return {t for t, a in latest.items() if a in ("hidden", "ignored")}


def diversify(opps: list[dict[str, Any]], decay: float = 0.8) -> list[dict[str, Any]]:
    """Order by score, but each extra issue from the same repo ranks a little lower.

    The displayed score stays the raw score; only the order changes, so one busy repo can't fill the page.
    """
    opps = sorted(opps, key=lambda o: o["score"], reverse=True)
    seen: dict[str, int] = defaultdict(int)
    for o in opps:
        o["rank_score"] = round(o["score"] * decay ** seen[o["repo"]], 4)
        seen[o["repo"]] += 1
    return sorted(opps, key=lambda o: o["rank_score"], reverse=True)


def _thin(points: list[tuple[str, int]], every_h: float = 3) -> list[tuple[str, int]]:
    out: list[tuple[str, int]] = []
    last: datetime | None = None
    for t, v in points:
        ts = _parse(t)
        if last is None or ts - last >= timedelta(hours=every_h) or (t, v) == points[-1]:
            out.append((t, v))
            last = ts
    return out


def score_and_publish(store: Store, now: datetime, my_login: str = "") -> dict[str, Any]:
    if sync_local_feedback(store):
        log.info("imported local feedback")
    repos = {r["id"]: r for r in store.select("repos")}
    signals = {s["repo_id"]: s for s in store.select("repo_signals")}
    snaps_by_repo: dict[int, list[dict]] = defaultdict(list)
    since = (now - timedelta(days=30)).isoformat()
    for s in store.select("repo_snapshots", gte={"taken_at": since}, order="taken_at"):
        snaps_by_repo[s["repo_id"]].append(s)
    hidden = hidden_targets(store)
    my_merged = merged_by_repo(store.select("my_prs")) if my_login else {}

    MODEL_VERSION = active_model_version()
    score_rows: list[dict] = []
    scored_at = now.isoformat()

    # --- repos
    repo_cards = []
    for rid, repo in repos.items():
        snaps = snaps_by_repo.get(rid, [])
        if not snaps:
            continue
        sig = signals.get(rid)
        score, reasons, extra = score_repo(repo, snaps, sig, now)
        latest = snaps[-1]
        score_rows.append(
            {
                "target_type": "repo",
                "target_id": str(rid),
                "score": score,
                "reasons_json": reasons,
                "model_version": MODEL_VERSION,
                "scored_at": scored_at,
            }
        )
        repo_cards.append(
            {
                "id": rid,
                "full_name": repo["full_name"],
                "description": repo.get("description") or "",
                "language": repo.get("language"),
                "topics": repo.get("topics") or [],
                "source": repo["source"],
                "created_at": repo.get("created_at"),
                "stars": latest["stars"],
                "forks": latest["forks"],
                "open_prs": latest.get("open_prs"),
                "open_issues": latest.get("open_issues"),
                "velocity": extra["velocity"],
                "velocity_kind": extra["velocity_kind"],
                "health": extra["health"],
                "score": score,
                "reasons": reasons,
                "signals": {k: v for k, v in (sig or {}).items() if k not in ("repo_id",)} or None,
                "history": _thin([(s["taken_at"], s["stars"]) for s in snaps]),
                "hidden": f"repo:{repo['full_name']}" in hidden,
            }
        )
    repo_cards.sort(key=lambda r: r["score"], reverse=True)
    by_id = {r["id"]: r for r in repo_cards}

    # --- issues
    opps, blocked = [], []
    for issue in store.select("issues", eq={"state": "open"}):
        repo = repos.get(issue["repo_id"])
        if not repo:
            continue
        score, reasons, parts = score_issue(
            issue, signals.get(issue["repo_id"]), now, my_merged=my_merged.get(repo["full_name"].lower(), 0)
        )
        score_rows.append(
            {
                "target_type": "issue",
                "target_id": str(issue["id"]),
                "score": score,
                "reasons_json": reasons,
                "model_version": MODEL_VERSION,
                "scored_at": scored_at,
            }
        )
        card = {
            "id": issue["id"],
            "repo": repo["full_name"],
            "repo_id": repo["id"],
            "language": repo.get("language"),
            "number": issue["number"],
            "title": issue["title"],
            "url": issue["url"],
            "labels": issue.get("labels") or [],
            "created_at": issue["created_at"],
            "comments": issue.get("comments") or 0,
            "score": score,
            "reasons": reasons,
            "parts": parts,
            "ai_policy": (signals.get(issue["repo_id"]) or {}).get("ai_policy", "unknown"),
            "repo_stars": (by_id.get(repo["id"]) or {}).get("stars"),
            "hidden": f"issue:{issue['id']}" in hidden or f"repo:{repo['full_name']}" in hidden,
        }
        (opps if score > 0 else blocked).append(card)
    opps = diversify(opps)
    blocked.sort(key=lambda o: o["created_at"], reverse=True)

    # --- news
    news_cut = (now - timedelta(days=7)).isoformat()
    news = []
    for item in store.select("news_items", gte={"published_at": news_cut}):
        s = score_news(item, now)
        news.append({**item, "score": s})
        score_rows.append(
            {
                "target_type": "news",
                "target_id": item["id"],
                "score": s,
                "reasons_json": [],
                "model_version": MODEL_VERSION,
                "scored_at": scored_at,
            }
        )
    news.sort(key=lambda n: n["score"], reverse=True)

    store.upsert("scores", score_rows)

    payload = {
        "generated_at": scored_at,
        "model_version": MODEL_VERSION,
        "stats": {
            "repos": len(repo_cards),
            "issues": len(opps) + len(blocked),
            "opportunities": len(opps),
            "blocked": len(blocked),
            "hot": sum(1 for o in opps if o["score"] >= 0.75),
            "news": len(news),
            "ai_banned_repos": sum(1 for s in signals.values() if s.get("ai_policy") == "banned"),
            "boosted": sum(1 for o in opps if "my_merges" in o["parts"]),
        },
        "opportunities": opps[:300],
        "blocked": blocked[:80],
        "repos": repo_cards[:200],
        "news": news[:120],
        # the owner's feedback history is private; the site fetches it with the owner key
        "feedback": [],
    }
    WEB_SNAPSHOT.parent.mkdir(parents=True, exist_ok=True)
    WEB_SNAPSHOT.write_text(json.dumps(payload, default=str), encoding="utf-8")
    store.upsert("site_snapshot", [{"id": 1, "generated_at": scored_at, "payload": payload}])
    log.info(
        "snapshot: %d opportunities (%d hot), %d repos, %d news",
        len(opps),
        payload["stats"]["hot"],
        len(repo_cards),
        len(news),
    )
    return payload
