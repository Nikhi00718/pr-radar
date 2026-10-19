"""Entry point: `uv run radar run` (collect + score + alert) and `uv run radar digest`."""

from __future__ import annotations

import argparse
import logging
import sys
from datetime import timedelta

from .collect_issues import collect_issues
from .collect_my_prs import collect_my_prs
from .collect_news import collect_hn, collect_releases
from .collect_repos import collect_all, now_utc
from .config import Settings
from .github import GitHub
from .notify import send_alerts, send_digest
from .pipeline import hidden_targets, score_and_publish
from .signals import refresh_signals
from .store import Store, open_store

log = logging.getLogger("radar")


def tracked_for_issues(store: Store, limit: int) -> list[str]:
    """Watchlist first, then trending, then the newest repos with the most stars."""
    repos = store.select("repos")
    since = (now_utc() - timedelta(days=2)).isoformat()
    latest: dict[int, int] = {}
    for s in store.select("repo_snapshots", gte={"taken_at": since}, order="taken_at"):
        latest[s["repo_id"]] = s["stars"]
    rank = {"watchlist": 0, "trending": 1, "search": 2}
    repos.sort(key=lambda r: (rank.get(r["source"], 3), -latest.get(r["id"], 0)))
    hidden = hidden_targets(store)
    return [r["full_name"] for r in repos if f"repo:{r['full_name']}" not in hidden][:limit]


def cmd_run(args: argparse.Namespace) -> int:
    s = Settings()
    store = open_store(s)
    gh = GitHub(s.github_token)
    now = now_utc()
    log.info(
        "store=%s token=%s telegram=%s",
        "supabase" if s.use_supabase else "sqlite",
        "yes" if gh.has_token else "no",
        "yes" if s.use_telegram else "no",
    )

    steps = [
        ("repos", lambda: collect_all(gh, store, s, now, trending=not args.no_trending)),
        (
            "signals",
            lambda: refresh_signals(gh, store, tracked_for_issues(store, s.issue_repo_limit), s.signals_ttl_hours, now),
        ),
        ("issues", lambda: collect_issues(gh, store, tracked_for_issues(store, s.issue_repo_limit), now)),
        ("hn", lambda: collect_hn(store, s, now)),
        ("releases", lambda: collect_releases(store, now)),
    ]
    if s.my_login:
        steps.append(("my_prs", lambda: collect_my_prs(gh, store, s.my_login, now)))
    failed = []
    for name, fn in steps:
        if name in args.skip:
            continue
        try:
            fn()
        except Exception:  # one broken source must not stop the others
            log.exception("step %s failed", name)
            failed.append(name)

    payload = score_and_publish(store, now, s.my_login)
    if not args.no_alerts:
        send_alerts(store, s, payload, now)
    log.info("done; graphql cost %d; failed steps: %s", gh.graphql_cost, failed or "none")
    return 1 if len(failed) == len(steps) else 0


def cmd_score(args: argparse.Namespace) -> int:
    s = Settings()
    score_and_publish(open_store(s), now_utc(), s.my_login)
    return 0


def cmd_digest(args: argparse.Namespace) -> int:
    s = Settings()
    store = open_store(s)
    now = now_utc()
    payload = score_and_publish(store, now, s.my_login)
    send_digest(store, s, payload, now)
    return 0


def cmd_purge_my_prs(args: argparse.Namespace) -> int:
    """Delete every stored row of the owner's PR list (the table stays for the opt-in boost)."""
    store = open_store(Settings())
    before = len(store.select("my_prs"))
    store.purge("my_prs")
    after = len(store.select("my_prs"))
    log.info("my_prs rows: %d before, %d after purge", before, after)
    return 0 if after == 0 else 1


def cmd_telegram_status(args: argparse.Namespace) -> int:
    from .telegram_setup import status

    return status(Settings())


def cmd_telegram_setup(args: argparse.Namespace) -> int:
    from .telegram_setup import setup

    return setup(Settings())


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    # httpx logs full request URLs, and the Telegram URL embeds the bot token; logs are public on a public repo
    logging.getLogger("httpx").setLevel(logging.WARNING)
    p = argparse.ArgumentParser(prog="radar")
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run", help="collect, score, publish snapshot, send alerts")
    r.add_argument("--no-trending", action="store_true", help="skip scraping github.com/trending")
    r.add_argument("--no-alerts", action="store_true")
    r.add_argument("--skip", nargs="*", default=[], choices=["repos", "signals", "issues", "hn", "releases", "my_prs"])
    r.set_defaults(fn=cmd_run)
    sub.add_parser("score", help="re-score stored data and publish the snapshot").set_defaults(fn=cmd_score)
    sub.add_parser("digest", help="send the daily Telegram digest").set_defaults(fn=cmd_digest)
    sub.add_parser("telegram-setup", help="register the bot webhook and command menu").set_defaults(
        fn=cmd_telegram_setup
    )
    sub.add_parser("telegram-status", help="webhook health and subscriber count").set_defaults(fn=cmd_telegram_status)
    sub.add_parser("purge-my-prs", help="delete the stored list of your own PRs").set_defaults(fn=cmd_purge_my_prs)
    args = p.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
