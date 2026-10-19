from datetime import UTC, datetime, timedelta

from radar.collect_issues import has_live_linked_pr, is_blocked_label, label_bonus
from radar.score import score_issue, star_velocity
from radar.signals import classify_ai_policy, compute_signals

NOW = datetime(2026, 10, 19, 12, tzinfo=UTC)


def iso(dt):
    return dt.isoformat().replace("+00:00", "Z")


def good_signals(**kw):
    base = {
        "outside_prs_closed_90d": 18,
        "outside_prs_merged_90d": 14,
        "median_first_response_h": 6,
        "open_pr_backlog": 3,
        "days_since_maintainer_merge": 1,
        "ci_pass_rate": 0.95,
        "ai_policy": "allowed",
    }
    return {**base, **kw}


def issue(**kw):
    base = {
        "created_at": iso(NOW - timedelta(days=2)),
        "comments": 1,
        "labels": ["good first issue"],
        "assignee": None,
        "has_linked_pr": False,
    }
    return {**base, **kw}


def test_healthy_repo_fresh_issue_scores_high_with_reasons():
    score, reasons, _ = score_issue(issue(), good_signals(), NOW, use_model=False)
    assert score > 0.75
    texts = " ".join(r["text"] for r in reasons)
    assert "merged 14/18 outside PRs" in texts and "~6h" in texts


def test_hard_gates_zero_the_score():
    for kw, sig in [
        ({"assignee": "bob"}, good_signals()),
        ({"has_linked_pr": True}, good_signals()),
        ({}, good_signals(ai_policy="banned")),
    ]:
        score, reasons, _ = score_issue(issue(**kw), sig, NOW, use_model=False)
        assert score == 0 and reasons[0]["tone"] == "bad"


def test_dead_repo_scores_lower_than_healthy_one():
    dead = good_signals(
        outside_prs_merged_90d=1, median_first_response_h=400, days_since_maintainer_merge=60, open_pr_backlog=120
    )
    assert (
        score_issue(issue(), dead, NOW, use_model=False)[0]
        < score_issue(issue(), good_signals(), NOW, use_model=False)[0] - 0.3
    )


def test_small_sample_merge_rate_is_shrunk():
    _, _, parts = score_issue(
        issue(), good_signals(outside_prs_closed_90d=3, outside_prs_merged_90d=3), NOW, use_model=False
    )
    assert parts["merge_rate"] == 0.8  # (3+1)/(3+2)


def test_label_bonus():
    assert label_bonus(["Good First Issue"]) == 1.0
    assert label_bonus(["type: bug"]) == 0.5
    assert label_bonus(["enhancement"]) == 0.0


def test_ai_policy_classifier():
    assert classify_ai_policy("We do not accept AI-generated pull requests.")[0] == "banned"
    assert classify_ai_policy("Contributions generated with LLMs will be closed without review.")[0] == "banned"
    assert classify_ai_policy("If you used Copilot or another AI tool, please disclose it in the PR.")[0] == "disclose"
    assert classify_ai_policy("Feel free to use AI tools, you are responsible for the code.")[0] == "allowed"
    assert classify_ai_policy("Run the tests before opening a PR.")[0] == "unknown"


def test_linked_pr_detection_ignores_closed_prs():
    node = lambda state: {
        "timelineItems": {
            "nodes": [{"__typename": "CrossReferencedEvent", "source": {"__typename": "PullRequest", "state": state}}]
        }
    }
    assert has_live_linked_pr(node("OPEN"))
    assert not has_live_linked_pr(node("CLOSED"))


def test_star_velocity_measured_and_fallback():
    snaps = [
        {"taken_at": (NOW - timedelta(hours=24)).isoformat(), "stars": 100},
        {"taken_at": NOW.isoformat(), "stars": 400},
    ]
    vel, kind = star_velocity(snaps, {}, NOW)
    assert kind == "measured" and round(vel) == 300
    vel, kind = star_velocity(snaps[-1:], {"created_at": iso(NOW - timedelta(days=4))}, NOW)
    assert kind == "since-creation" and round(vel) == 100


def test_compute_signals_counts_outsiders_and_response_time():
    created = NOW - timedelta(days=10)
    pr = lambda assoc, state: {
        "state": state,
        "createdAt": iso(created),
        "closedAt": None,
        "mergedAt": None,
        "authorAssociation": assoc,
        "comments": {"nodes": [{"authorAssociation": "MEMBER", "createdAt": iso(created + timedelta(hours=5))}]},
        "reviews": {"nodes": []},
    }
    repo = {
        "recent": {"nodes": [pr("CONTRIBUTOR", "MERGED"), pr("NONE", "CLOSED"), pr("MEMBER", "MERGED")]},
        "merged": {"nodes": [{"mergedAt": iso(NOW - timedelta(days=2))}]},
        "stale": {"nodes": [{"createdAt": iso(NOW - timedelta(days=40))}, {"createdAt": iso(NOW)}]},
        "defaultBranchRef": {
            "target": {
                "history": {
                    "nodes": [{"statusCheckRollup": {"state": "SUCCESS"}}, {"statusCheckRollup": {"state": "FAILURE"}}]
                }
            }
        },
        "c1": {"text": "Please disclose any AI assistance in your PR."},
    }
    s = compute_signals(repo, NOW)
    assert (s["outside_prs_closed_90d"], s["outside_prs_merged_90d"]) == (2, 1)
    assert s["median_first_response_h"] == 5
    assert s["open_pr_backlog"] == 1 and s["ci_pass_rate"] == 0.5
    assert s["has_contributing"] and s["ai_policy"] == "disclose"
    assert round(s["days_since_maintainer_merge"]) == 2


def test_blocked_labels():
    assert is_blocked_label(["bug", "Duplicate"])
    assert is_blocked_label(["status: won't fix"])
    assert not is_blocked_label(["bug", "good first issue"])
