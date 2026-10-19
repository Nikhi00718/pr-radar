"""Score v1: a transparent weighted formula with human-readable reasons. No ML."""

from __future__ import annotations

import math
from datetime import datetime, timedelta
from typing import Any

from .collect_issues import label_bonus
from .model import load as load_model
from .model import merge_probability

MODEL_VERSION = "v1-formula"


def active_model_version() -> str:
    loaded = load_model()
    return f"lgbm-{loaded[1]['trained_at'][:10]}" if loaded else MODEL_VERSION


WEIGHTS = {
    "merge_rate": 0.45,
    "fast_response": 0.20,
    "low_backlog": 0.10,
    "active_maintainers": 0.10,
    "fresh_unclaimed": 0.10,
    "label_bonus": 0.05,
}


def _parse(ts: str | None) -> datetime | None:
    return datetime.fromisoformat(ts.replace("Z", "+00:00")) if ts else None


def _clamp(x: float) -> float:
    return max(0.0, min(1.0, x))


def reason(text: str, tone: str = "good") -> dict[str, str]:
    return {"text": text, "tone": tone}  # tone: good | warn | bad | info


def fmt_hours(h: float) -> str:
    if h < 1:
        return f"~{max(1, round(h * 60))}m"
    if h < 48:
        return f"~{round(h)}h"
    return f"~{round(h / 24)}d"


# Author history is the strongest merge predictor in the training data (373k outsider PRs): prior merged PRs
# in the same repo beat the repo's own merge rate. Added on top of the formula, saturating fast.
MY_MERGES_MAX_BOOST = 0.12


def my_merges_boost(n: int) -> float:
    """Additive score boost for having merged `n` PRs in this repo: 1 -> +0.047, 3 -> +0.093, 5+ -> ~+0.11."""
    return MY_MERGES_MAX_BOOST * (1 - math.exp(-n / 2)) if n > 0 else 0.0


def signal_components(sig: dict[str, Any] | None) -> tuple[dict[str, float], list[dict[str, str]]]:
    """Repo-level parts of the score (shared by issue and repo scores)."""
    reasons: list[dict[str, str]] = []
    parts: dict[str, float] = {}
    if not sig:
        return {"merge_rate": 0.4, "fast_response": 0.4, "low_backlog": 0.5, "active_maintainers": 0.4}, [
            reason("repo health not measured yet", "info")
        ]

    closed = sig.get("outside_prs_closed_90d") or 0
    merged = sig.get("outside_prs_merged_90d") or 0
    if closed >= 3:
        # shrink small samples toward a 0.5 prior so 2/3 doesn't look like 67% certainty
        parts["merge_rate"] = (merged + 1) / (closed + 2)
        tone = "good" if merged / closed >= 0.5 else ("warn" if merged / closed >= 0.25 else "bad")
        reasons.append(reason(f"merged {merged}/{closed} outside PRs in 90d", tone))
    else:
        parts["merge_rate"] = 0.4
        reasons.append(reason(f"only {closed} outside PRs closed in 90d", "info"))

    h = sig.get("median_first_response_h")
    if h is None:
        parts["fast_response"] = 0.4
    else:
        parts["fast_response"] = _clamp(1 - math.log1p(max(0.0, h - 4)) / math.log1p(164))
        reasons.append(
            reason(f"maintainers reply in {fmt_hours(h)}", "good" if h <= 24 else ("warn" if h <= 96 else "bad"))
        )

    backlog = sig.get("open_pr_backlog") or 0
    parts["low_backlog"] = 1 / (1 + backlog / 15)
    if backlog >= 40:
        reasons.append(reason(f"{backlog} PRs waiting 30d+", "warn"))

    d = sig.get("days_since_maintainer_merge")
    if d is None:
        parts["active_maintainers"] = 0.2
        reasons.append(reason("no merges found", "bad"))
    else:
        parts["active_maintainers"] = _clamp(1 - max(0.0, d - 3) / 42)
        if d <= 2:
            reasons.append(reason("merging daily", "good"))
        elif d > 21:
            reasons.append(reason(f"last merge {round(d)}d ago", "bad"))

    ci = sig.get("ci_pass_rate")
    if ci is not None and ci < 0.6:
        reasons.append(reason(f"main CI green {round(ci * 100)}% of runs", "warn"))

    policy = sig.get("ai_policy", "unknown")
    if policy == "disclose":
        reasons.append(reason("AI use must be disclosed", "warn"))
    elif policy == "banned":
        reasons.append(reason("AI-assisted PRs banned", "bad"))
    return parts, reasons


def score_issue(
    issue: dict[str, Any], sig: dict[str, Any] | None, now: datetime, use_model: bool = True, my_merged: int = 0
) -> tuple[float, list[dict], dict]:
    parts, reasons = signal_components(sig)

    created = _parse(issue["created_at"]) or now
    age_d = max(0.0, (now - created).total_seconds() / 86400)
    comments = issue.get("comments") or 0
    parts["fresh_unclaimed"] = math.exp(-age_d / 60) / (1 + comments / 8)
    parts["label_bonus"] = label_bonus(issue.get("labels") or [])

    age_txt = "today" if age_d < 1 else f"{round(age_d)}d ago"
    reasons.insert(
        0,
        reason(
            f"opened {age_txt}, {comments} comment{'s' if comments != 1 else ''}",
            "good" if age_d < 14 and comments < 5 else "info",
        ),
    )

    score = sum(WEIGHTS[k] * parts[k] for k in WEIGHTS)
    model = merge_probability(sig) if use_model else None
    if model:
        # the repo-level 85% of v1 is replaced by the model's merge probability
        p, _ = model
        parts["model_merge_prob"] = p
        score = 0.85 * p + 0.10 * parts["fresh_unclaimed"] + 0.05 * parts["label_bonus"]
        reasons.insert(1, reason(f"model: {round(p * 100)}% merge odds for a first PR", "good" if p >= 0.5 else "warn"))

    if my_merged > 0:
        parts["my_merges"] = my_merges_boost(my_merged)
        score = min(1.0, score + parts["my_merges"])
        reasons.insert(0, reason(f"you've merged {my_merged} PR{'s' if my_merged != 1 else ''} here", "good"))

    gate = None
    if sig and sig.get("ai_policy") == "banned":
        gate = "AI policy bans assisted PRs"
    elif issue.get("has_linked_pr"):
        gate = "a linked PR already exists"
    elif issue.get("assignee"):
        gate = f"assigned to @{issue['assignee']}"
    if gate:
        reasons.insert(0, reason(gate, "bad"))
        score = 0.0
    return round(score, 4), reasons[:6], {k: round(v, 3) for k, v in parts.items()}


def star_velocity(snaps: list[dict[str, Any]], repo: dict[str, Any], now: datetime) -> tuple[float | None, str]:
    """Stars gained per day. Uses a snapshot ~24h old if we have one, else the average since creation."""
    if not snaps:
        return None, "none"
    snaps = sorted(snaps, key=lambda s: s["taken_at"])
    latest = snaps[-1]
    t_latest = _parse(latest["taken_at"])
    target = t_latest - timedelta(hours=24)
    older = [s for s in snaps if _parse(s["taken_at"]) <= t_latest - timedelta(hours=1)]
    if older:
        ref = min(older, key=lambda s: abs((_parse(s["taken_at"]) - target).total_seconds()))
        days = (t_latest - _parse(ref["taken_at"])).total_seconds() / 86400
        return (latest["stars"] - ref["stars"]) / days, "measured"
    created = _parse(repo.get("created_at"))
    if created and (now - created) < timedelta(days=120):
        return latest["stars"] / max(1.0, (now - created).total_seconds() / 86400), "since-creation"
    return None, "none"


def score_repo(repo: dict, snaps: list[dict], sig: dict | None, now: datetime) -> tuple[float, list[dict], dict]:
    vel, kind = star_velocity(snaps, repo, now)
    parts, reasons = signal_components(sig)
    health = (
        0.5 * parts["merge_rate"]
        + 0.2 * parts["fast_response"]
        + 0.15 * parts["low_backlog"]
        + 0.15 * parts["active_maintainers"]
    )
    v_norm = _clamp(math.log10(1 + max(0.0, vel or 0)) / 3)  # 1000 stars/day -> 1.0
    if vel is not None:
        label = "stars/day" if kind == "measured" else "stars/day avg since launch"
        reasons.insert(0, reason(f"+{vel:,.0f} {label}", "good" if vel >= 50 else "info"))
    score = 0.6 * v_norm + 0.4 * health
    if sig and sig.get("ai_policy") == "banned":
        score *= 0.5
    return round(score, 4), reasons[:5], {"velocity": vel, "velocity_kind": kind, "health": round(health, 3)}


def score_news(item: dict, now: datetime) -> float:
    pub = _parse(item["published_at"]) or now
    age_h = max(0.0, (now - pub).total_seconds() / 3600)
    recency = math.exp(-age_h / 36)
    if item["source"] == "release":
        return round(0.55 * recency + 0.25, 4)
    pts = _clamp(math.log10(1 + (item.get("points") or 0)) / 3)
    return round(0.6 * pts + 0.3 * recency + 0.1 * min(1.0, len(item.get("tags") or []) / 3), 4)
