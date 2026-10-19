"""Build the merge-probability training set from the public ClickHouse GitHub dataset.

Window: outsider PRs opened 2024-07-01 .. 2025-08-31 in repos with 500+ stars.
Why not "the last 12 months": since about October 2025 the public events feed is trimmed
(author_association is always NONE, additions/deletions are 0, merge flags missing), so newer
rows would train on broken labels. Checked with per-quarter counts on 2026-10-19.

Every feature is computed only from events strictly before the PR was opened (no leakage).
Label: merged within 30 days of opening.

    uv run python -m ml.build_dataset            # writes data/ml/dataset.csv
"""

from __future__ import annotations

import bisect
import io
import logging
import re
import statistics
import time
from collections import defaultdict
from datetime import timedelta

import httpx
import pandas as pd

from radar.config import DATA_DIR, WATCHLIST

log = logging.getLogger("ml.build")
CH = "https://play.clickhouse.com/?user=play"
HIST_START = "2024-04-01"  # history for point-in-time features
OPEN_START = "2024-07-01"  # first PR in the dataset
OPEN_END = "2025-08-31"  # last PR in the dataset
DATA_END = "2025-09-30"  # feed is reliable up to here
OUTSIDER = ("NONE", "CONTRIBUTOR")
MAINT = ("OWNER", "MEMBER", "COLLABORATOR")
OUT = DATA_DIR / "ml"


def ch(sql: str) -> pd.DataFrame:
    for attempt in range(4):
        try:
            r = httpx.post(CH, content=sql + " FORMAT TSVWithNames", timeout=300)
            if r.status_code == 200:
                return pd.read_csv(io.StringIO(r.text), sep="\t", quoting=3, keep_default_na=False)
            log.warning("clickhouse %s: %s", r.status_code, r.text[:300])
        except httpx.HTTPError as e:
            log.warning("clickhouse error: %s", e)
        time.sleep(5 * (attempt + 1))
    raise RuntimeError("clickhouse query failed")


def pick_repos(max_repos: int) -> list[str]:
    cands = ch(f"""
        SELECT repo_name, count() AS c FROM github_events
        WHERE event_type = 'PullRequestEvent' AND action = 'opened'
          AND author_association IN {OUTSIDER}
          AND created_at >= '{OPEN_START}' AND created_at <= '{OPEN_END}'
        GROUP BY repo_name HAVING c BETWEEN 120 AND 4000
        ORDER BY c DESC LIMIT 700
    """)
    names = list(cands["repo_name"]) + [w for w in WATCHLIST]
    in_list = "(" + ",".join(f"'{n}'" for n in set(names)) + ")"
    stars = ch(f"""
        SELECT repo_name, count() AS stars FROM github_events
        WHERE event_type = 'WatchEvent' AND repo_name IN {in_list} AND created_at < '{DATA_END}'
        GROUP BY repo_name HAVING stars >= 500
    """)
    keep = set(stars["repo_name"])
    ordered = [n for n in cands["repo_name"] if n in keep][:max_repos]
    ordered += [w for w in WATCHLIST if w in keep and w not in ordered]
    log.info("repos: %d candidates, %d with 500+ stars, using %d", len(cands), len(keep), len(ordered))
    return ordered


def fetch(repos: list[str]) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    opened, closed, resp = [], [], []
    for i in range(0, len(repos), 40):
        chunk = "(" + ",".join(f"'{r}'" for r in repos[i : i + 40]) + ")"
        opened.append(
            ch(f"""
            SELECT repo_name, number, created_at, actor_login, author_association,
                   additions, deletions, changed_files, commits,
                   length(title) AS title_len, length(body) AS body_len,
                   match(body, '(?i)(fix|fixe[sd]|close[sd]?|resolve[sd]?) +#[0-9]+') AS refs_issue,
                   match(title, '(?i)\\\\b(doc|docs|readme|typo|spelling)\\\\b') AS is_docs,
                   match(title, '(?i)\\\\b(fix|bug|crash|error|issue)\\\\b') AS is_fix,
                   match(title, '(?i)\\\\b(add|feat|feature|support|implement)\\\\b') AS is_feat
            FROM github_events
            WHERE event_type = 'PullRequestEvent' AND action = 'opened' AND repo_name IN {chunk}
              AND created_at >= '{HIST_START}' AND created_at <= '{OPEN_END}'
        """)
        )
        closed.append(
            ch(f"""
            SELECT repo_name, number, min(created_at) AS closed_at,
                   max(merged_at > '2000-01-01') AS merged, max(merged_at) AS merged_ts
            FROM github_events
            WHERE event_type = 'PullRequestEvent' AND action = 'closed' AND repo_name IN {chunk}
              AND created_at >= '{HIST_START}' AND created_at <= '{DATA_END}'
            GROUP BY repo_name, number
        """)
        )
        resp.append(
            ch(f"""
            SELECT repo_name, number, min(created_at) AS first_maint_at
            FROM github_events
            WHERE event_type IN ('IssueCommentEvent', 'PullRequestReviewEvent', 'PullRequestReviewCommentEvent')
              AND author_association IN {MAINT} AND repo_name IN {chunk}
              AND created_at >= '{HIST_START}' AND created_at <= '{DATA_END}'
            GROUP BY repo_name, number
        """)
        )
        log.info("fetched %d/%d repos", min(i + 40, len(repos)), len(repos))
    o = pd.concat(opened).drop_duplicates(["repo_name", "number"])
    c = pd.concat(closed).rename(columns={"merged_ts": "merged_at"})
    r = pd.concat(resp)
    for df, cols in ((o, ["created_at"]), (c, ["closed_at", "merged_at"]), (r, ["first_maint_at"])):
        for col in cols:
            df[col] = pd.to_datetime(df[col], errors="coerce")
    return o, c, r


def build_features(o: pd.DataFrame, c: pd.DataFrame, r: pd.DataFrame) -> pd.DataFrame:
    prs = o.merge(c, on=["repo_name", "number"], how="left").merge(r, on=["repo_name", "number"], how="left")
    is_bot = prs["actor_login"].astype(str).str.contains(r"\[bot\]$|-bot$|^dependabot|^renovate", regex=True)
    prs["outsider"] = prs["author_association"].isin(OUTSIDER) & ~is_bot
    prs = prs.sort_values("created_at").reset_index(drop=True)
    rows = []
    for repo, g in prs.groupby("repo_name", sort=False):
        g = g.sort_values("created_at")
        outs = g[g["outsider"]]
        # sorted event arrays for point-in-time lookups
        close_ev = outs.dropna(subset=["closed_at"]).sort_values("closed_at")
        close_t = list(close_ev["closed_at"])
        close_m = list(close_ev["merged"].astype(int))
        merge_t = sorted(g.loc[g["merged"] == 1, "merged_at"].dropna())
        author_open: dict[str, list] = defaultdict(list)
        author_merge: dict[str, list] = defaultdict(list)
        for login, opened_at, merged, merged_at in zip(
            g["actor_login"], g["created_at"], g["merged"], g["merged_at"], strict=True
        ):
            author_open[login].append(opened_at)
            if merged == 1 and pd.notna(merged_at):
                author_merge[login].append(merged_at)
        for v in author_merge.values():
            v.sort()
        out_open = list(outs["created_at"])
        out_close = list(outs["closed_at"])
        out_resp = list(outs["first_maint_at"])
        far = pd.Timestamp.max
        backlog_closes: list = []  # close times of outsider PRs opened more than 30 days before t
        added = 0

        for p in outs.to_dict("records"):
            t = p["created_at"]
            if t < pd.Timestamp(OPEN_START) or t > pd.Timestamp(OPEN_END):
                continue
            t90 = t - timedelta(days=90)
            lo, hi = bisect.bisect_left(close_t, t90), bisect.bisect_left(close_t, t)
            closed_90 = hi - lo
            merged_90 = sum(close_m[lo:hi])
            # response times of outsider PRs opened in the prior 90 days, as known at time t
            j0, j1 = bisect.bisect_left(out_open, t90), bisect.bisect_left(out_open, t)
            waits = []
            for k in range(j0, j1):
                fr = out_resp[k]
                if pd.notna(fr) and fr < t:
                    waits.append((fr - out_open[k]).total_seconds() / 3600)
                elif (pd.isna(out_close[k]) or out_close[k] >= t) and (t - out_open[k]).days >= 2:
                    # still unanswered at time t: count the wait so far
                    waits.append((t - out_open[k]).total_seconds() / 3600)
            t30 = t - timedelta(days=30)
            k30 = bisect.bisect_left(out_open, t30)
            while added < k30:
                bisect.insort(backlog_closes, far if pd.isna(out_close[added]) else out_close[added])
                added += 1
            backlog = len(backlog_closes) - bisect.bisect_left(backlog_closes, t)
            mi = bisect.bisect_left(merge_t, t)
            last_merge = merge_t[mi - 1] if mi else None
            merges_30 = mi - bisect.bisect_left(merge_t, t30)
            a_prev = bisect.bisect_left(author_open[p["actor_login"]], t)
            a_merged = bisect.bisect_left(author_merge.get(p["actor_login"], []), t)
            merged_30d = int(p["merged"] == 1 and pd.notna(p["merged_at"]) and p["merged_at"] - t <= timedelta(days=30))
            rows.append(
                {
                    "repo": repo,
                    "number": p["number"],
                    "opened_at": t,
                    "label": merged_30d,
                    "outside_closed_90d": closed_90,
                    "outside_merged_90d": merged_90,
                    "merge_rate_shrunk": (merged_90 + 1) / (closed_90 + 2),
                    "median_first_response_h": statistics.median(waits) if waits else None,
                    "open_pr_backlog": backlog,
                    "days_since_merge": (t - last_merge).total_seconds() / 86400 if last_merge is not None else None,
                    "merges_30d": merges_30,
                    "outside_prs_90d": j1 - j0,
                    "author_prev_prs": a_prev,
                    "author_prev_merged": a_merged,
                    "author_is_contributor": int(p["author_association"] == "CONTRIBUTOR"),
                    "additions": p["additions"],
                    "deletions": p["deletions"],
                    "changed_files": p["changed_files"],
                    "commits": p["commits"],
                    "title_len": p["title_len"],
                    "body_len": p["body_len"],
                    "refs_issue": p["refs_issue"],
                    "is_docs": p["is_docs"],
                    "is_fix": p["is_fix"],
                    "is_feat": p["is_feat"],
                    "dow": t.dayofweek,
                    "hour_utc": t.hour,
                }
            )
    return pd.DataFrame(rows)


def main(max_repos: int = 160) -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    OUT.mkdir(parents=True, exist_ok=True)
    raw = OUT / "raw.pkl"
    if raw.exists():
        o, c, r = pd.read_pickle(raw)
        log.info("using cached raw events from %s (delete it to refetch)", raw)
    else:
        o, c, r = fetch(pick_repos(max_repos))
        pd.to_pickle((o, c, r), raw)
    log.info("events: %d opened, %d closed, %d with maintainer response", len(o), len(c), len(r))
    df = build_features(o, c, r)
    df = df[~df["repo"].str.contains(re.compile(r"(?i)awesome|leetcode|homework"))]
    df.to_csv(OUT / "dataset.csv", index=False)
    log.info(
        "dataset: %d PRs from %d repos, merge rate %.3f -> %s",
        len(df),
        df["repo"].nunique(),
        df["label"].mean(),
        OUT / "dataset.csv",
    )


if __name__ == "__main__":
    main()
