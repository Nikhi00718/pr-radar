"""Train LightGBM merge-probability models and compare them with score v1 on a time split.

Two models:
  * full   - every feature, including PR size and author history. Shows what is learnable.
  * live   - only features the live collector has when ranking an *issue* (no PR exists yet):
             repo signals, plus author history fixed to "first-time contributor" at inference.
             This is the fair comparison with score v1 and the only one that can replace it.

Decision rule: ship `live` if its test AUC beats v1 by at least 0.02.

    uv run python -m ml.train      # writes ml/model_live.txt and web/data/model_report.json
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score

from radar.config import DATA_DIR, ROOT
from radar.score import WEIGHTS, signal_components

log = logging.getLogger("ml.train")
TEST_FROM = "2025-04-01"
SHIP_MARGIN = 0.02
LIVE_CAP = 80  # live signals look at the newest 80 PRs, so counts above this never appear at inference

FULL_FEATURES = [
    "merge_rate_shrunk",
    "outside_closed_90d",
    "outside_merged_90d",
    "median_first_response_h",
    "open_pr_backlog",
    "days_since_merge",
    "merges_30d",
    "outside_prs_90d",
    "author_prev_prs",
    "author_prev_merged",
    "author_is_contributor",
    "additions",
    "deletions",
    "changed_files",
    "commits",
    "title_len",
    "body_len",
    "refs_issue",
    "is_docs",
    "is_fix",
    "is_feat",
    "dow",
    "hour_utc",
]
LIVE_FEATURES = [
    "merge_rate_live",
    "outside_closed_live",
    "median_first_response_h",
    "backlog_live",
    "days_since_merge",
]
MODEL_DIR = Path(__file__).parent
REPORT = ROOT / "web" / "data" / "model_report.json"


def add_live_columns(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    closed = df["outside_closed_90d"].clip(upper=LIVE_CAP)
    frac = np.where(df["outside_closed_90d"] > 0, df["outside_merged_90d"] / df["outside_closed_90d"].replace(0, 1), 0)
    merged = (frac * closed).round()
    df["outside_closed_live"] = closed
    df["merge_rate_live"] = (merged + 1) / (closed + 2)
    df["backlog_live"] = df["open_pr_backlog"].clip(upper=100)
    return df


def v1_score(row: pd.Series) -> float:
    sig = {
        "outside_prs_closed_90d": int(min(row["outside_closed_90d"], LIVE_CAP)),
        "outside_prs_merged_90d": int(
            round(row["merge_rate_live"] * (min(row["outside_closed_90d"], LIVE_CAP) + 2) - 1)
        ),
        "median_first_response_h": None if pd.isna(row["median_first_response_h"]) else row["median_first_response_h"],
        "open_pr_backlog": int(row["backlog_live"]),
        "days_since_maintainer_merge": None if pd.isna(row["days_since_merge"]) else row["days_since_merge"],
        "ai_policy": "unknown",
    }
    parts, _ = signal_components(sig)
    return sum(WEIGHTS[k] * parts[k] for k in ("merge_rate", "fast_response", "low_backlog", "active_maintainers"))


def fit(train: pd.DataFrame, feats: list[str]) -> lgb.Booster:
    train = train.sort_values("opened_at")
    cut = int(len(train) * 0.85)
    tr, va = train.iloc[:cut], train.iloc[cut:]
    params = {
        "objective": "binary",
        "metric": "auc",
        "learning_rate": 0.04,
        "num_leaves": 31,
        "min_data_in_leaf": 200,
        "feature_fraction": 0.85,
        "bagging_fraction": 0.8,
        "bagging_freq": 1,
        "lambda_l2": 5.0,
        "verbose": -1,
        "seed": 7,
    }
    return lgb.train(
        params,
        lgb.Dataset(tr[feats], tr["label"]),
        num_boost_round=3000,
        valid_sets=[lgb.Dataset(va[feats], va["label"])],
        callbacks=[lgb.early_stopping(150, verbose=False)],
    )


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    df = pd.read_csv(DATA_DIR / "ml" / "dataset.csv", parse_dates=["opened_at"])
    df = add_live_columns(df)
    test_from = pd.Timestamp(TEST_FROM, tz=df["opened_at"].dt.tz)
    train, test = df[df["opened_at"] < test_from], df[df["opened_at"] >= test_from]
    log.info("rows %d (train %d, test %d), base rate %.3f", len(df), len(train), len(test), df["label"].mean())

    full = fit(train, FULL_FEATURES)
    live = fit(train, LIVE_FEATURES)
    auc_full = roc_auc_score(test["label"], full.predict(test[FULL_FEATURES], num_iteration=full.best_iteration))
    auc_live = roc_auc_score(test["label"], live.predict(test[LIVE_FEATURES], num_iteration=live.best_iteration))
    auc_v1 = roc_auc_score(test["label"], test.apply(v1_score, axis=1))
    decision = "ship" if auc_live - auc_v1 >= SHIP_MARGIN else "keep-v1"
    log.info("AUC full %.4f | live %.4f | v1 %.4f -> %s", auc_full, auc_live, auc_v1, decision)

    live.save_model(str(MODEL_DIR / "model_live.txt"), num_iteration=live.best_iteration)
    gains = full.feature_importance("gain")
    top = sorted(zip(FULL_FEATURES, gains, strict=True), key=lambda x: -x[1])[:10]
    report = {
        "trained_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "rows": int(len(df)),
        "test_rows": int(len(test)),
        "repos": int(df["repo"].nunique()),
        "base_rate": round(float(df["label"].mean()), 4),
        "auc_model": round(float(auc_live), 4),
        "auc_full": round(float(auc_full), 4),
        "auc_v1": round(float(auc_v1), 4),
        "decision": decision,
        "label": "merged within 30 days",
        "split": f"time split: train < {TEST_FROM} <= test (PRs opened 2024-07..2025-08)",
        "top_features": [{"name": n, "gain": round(float(g), 1)} for n, g in top],
        "live_features": LIVE_FEATURES,
    }
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, indent=2), encoding="utf-8")
    log.info("report -> %s", REPORT)


if __name__ == "__main__":
    main()
