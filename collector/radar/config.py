"""Runtime settings. Everything tunable lives here or in environment variables."""

from __future__ import annotations

import os
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data"
WEB_SNAPSHOT = ROOT / "web" / "data" / "snapshot.json"

# Established repos worth watching for issues even when they are not new.
WATCHLIST: list[str] = [
    "vllm-project/vllm",
    "huggingface/transformers",
    "huggingface/diffusers",
    "huggingface/peft",
    "huggingface/trl",
    "huggingface/accelerate",
    "ultralytics/ultralytics",
    "pytorch/vision",
    "kornia/kornia",
    "roboflow/supervision",
    "mlflow/mlflow",
    "opencv/opencv-python",
    "Lightning-AI/pytorch-lightning",
    "sgl-project/sglang",
    "ollama/ollama",
    "ggml-org/llama.cpp",
    "langchain-ai/langchain",
    "run-llama/llama_index",
    "pydantic/pydantic",
    "fastapi/fastapi",
    "astral-sh/ruff",
    "astral-sh/uv",
    "microsoft/markitdown",
    "deepspeedai/DeepSpeed",
    "onnx/onnx",
]

NEWS_KEYWORDS: list[str] = [
    "pytorch",
    "llm",
    "inference",
    "cuda",
    "vision",
    "rust",
    "open source",
    "open-source",
    "transformer",
    "gpu",
    "diffusion",
    "agent",
    "python",
    "model",
    "github",
    "compiler",
    "vllm",
    "hugging face",
    "ollama",
    "llama",
    "kernel",
]

ISSUE_LABEL_HINTS: dict[str, float] = {
    # substring of a lowercased label -> label bonus (0..1)
    "good first issue": 1.0,
    "good-first-issue": 1.0,
    "beginner": 0.9,
    "easy": 0.8,
    "help wanted": 0.7,
    "help-wanted": 0.7,
    "contributions welcome": 0.7,
    "bug": 0.5,
}


# An issue carrying any of these (substring of a lowercased label) is not a PR target.
ISSUE_LABEL_BLOCK: list[str] = [
    "duplicate",
    "wontfix",
    "won't fix",
    "invalid",
    "stale",
    "not planned",
    "on hold",
    "blocked",
    "needs design",
    "needs decision",
    "discussion",
    "question",
    "rfc",
    "epic",
    "tracking",
]


def _gh_cli_token() -> str | None:
    """Fall back to the signed-in gh CLI token for local runs."""
    if not shutil.which("gh"):
        return None
    try:
        out = subprocess.run(["gh", "auth", "token"], capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.TimeoutExpired):
        return None
    token = out.stdout.strip()
    return token or None


@dataclass
class Settings:
    github_token: str | None = field(
        default_factory=lambda: os.getenv("GH_TOKEN") or os.getenv("GITHUB_TOKEN") or _gh_cli_token()
    )
    supabase_url: str | None = field(default_factory=lambda: os.getenv("SUPABASE_URL"))
    supabase_key: str | None = field(default_factory=lambda: os.getenv("SUPABASE_SERVICE_ROLE_KEY"))
    telegram_token: str | None = field(default_factory=lambda: os.getenv("TELEGRAM_BOT_TOKEN"))
    telegram_chat_id: str | None = field(default_factory=lambda: os.getenv("TELEGRAM_CHAT_ID"))

    new_repo_window_days: int = int(os.getenv("RADAR_NEW_REPO_DAYS", "30"))
    new_repo_min_stars: int = int(os.getenv("RADAR_NEW_REPO_MIN_STARS", "100"))
    new_repo_limit: int = int(os.getenv("RADAR_NEW_REPO_LIMIT", "40"))
    issue_repo_limit: int = int(os.getenv("RADAR_ISSUE_REPO_LIMIT", "45"))
    signals_ttl_hours: float = float(os.getenv("RADAR_SIGNALS_TTL_H", "8"))
    news_min_points: int = int(os.getenv("RADAR_NEWS_MIN_POINTS", "50"))

    alert_threshold: float = float(os.getenv("RADAR_ALERT_THRESHOLD", "0.75"))
    quiet_start_hour_ist: int = int(os.getenv("RADAR_QUIET_START", "0"))
    quiet_end_hour_ist: int = int(os.getenv("RADAR_QUIET_END", "7"))
    max_alerts_per_run: int = int(os.getenv("RADAR_MAX_ALERTS", "5"))
    site_url: str = os.getenv("RADAR_SITE_URL", "http://localhost:3000")
    # whose PRs feed the My PRs page and the "you've merged here" boost
    my_login: str = os.getenv("RADAR_MY_LOGIN", "Nikhi00718")

    @property
    def use_supabase(self) -> bool:
        return bool(self.supabase_url and self.supabase_key)

    @property
    def use_telegram(self) -> bool:
        return bool(self.telegram_token and self.telegram_chat_id)
