"""Optional LightGBM scorer. Used only when ml/train.py decided "ship"; otherwise score v1 stays."""

from __future__ import annotations

import json
import logging
import math
from functools import lru_cache
from pathlib import Path
from typing import Any

from .config import ROOT

log = logging.getLogger(__name__)
MODEL_PATH = Path(__file__).resolve().parents[1] / "ml" / "model_live.txt"
REPORT_PATH = ROOT / "web" / "data" / "model_report.json"


@lru_cache(maxsize=1)
def load() -> tuple[Any, dict] | None:
    if not (MODEL_PATH.exists() and REPORT_PATH.exists()):
        return None
    report = json.loads(REPORT_PATH.read_text(encoding="utf-8"))
    if report.get("decision") != "ship":
        return None
    try:
        import lightgbm as lgb
    except ImportError:
        log.warning("model says ship but lightgbm is not installed; using score v1")
        return None
    return lgb.Booster(model_file=str(MODEL_PATH)), report


def live_features(sig: dict[str, Any]) -> list[float]:
    closed = sig.get("outside_prs_closed_90d") or 0
    merged = sig.get("outside_prs_merged_90d") or 0
    nan = math.nan
    return [
        (merged + 1) / (closed + 2),
        float(closed),
        sig["median_first_response_h"] if sig.get("median_first_response_h") is not None else nan,
        float(min(sig.get("open_pr_backlog") or 0, 100)),
        sig["days_since_maintainer_merge"] if sig.get("days_since_maintainer_merge") is not None else nan,
    ]


def merge_probability(sig: dict[str, Any] | None) -> tuple[float, str] | None:
    """P(an outsider PR here is merged within 30 days), or None when v1 should be used."""
    loaded = load()
    if not loaded or not sig:
        return None
    booster, report = loaded
    p = float(booster.predict([live_features(sig)])[0])
    return p, f"lgbm-{report['trained_at'][:10]}"
