"""Register the public bot with Telegram: webhook, command menu and descriptions.

uv run radar telegram-setup     (needs TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, RADAR_SITE_URL)
"""

from __future__ import annotations

import logging

import httpx

from .config import Settings

log = logging.getLogger(__name__)

COMMANDS = [
    ("start", "Subscribe to PR Radar alerts"),
    ("top", "Top 5 open-source issues right now"),
    ("settings", "Show your alert settings"),
    ("min", "Minimum score for alerts, e.g. /min 80"),
    ("lang", "Only these languages, e.g. /lang python rust"),
    ("alerts", "Instant alerts on or off"),
    ("digest", "8:00 AM IST digest on or off"),
    ("privacy", "What the bot stores about you"),
    ("stop", "Unsubscribe"),
]
DESCRIPTION = (
    "PR Radar finds open-source issues where an outside pull request is likely to get merged, "
    "and explains why. Send /start to get alerts and a daily digest. Free, no account needed."
)


def setup(s: Settings) -> int:
    if not (s.telegram_token and s.telegram_webhook_secret and s.site_url.startswith("https://")):
        log.error("need TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET and an https RADAR_SITE_URL")
        return 1
    api = f"https://api.telegram.org/bot{s.telegram_token}"
    calls = [
        (
            "setWebhook",
            {
                "url": s.site_url.rstrip("/") + "/api/telegram",
                "secret_token": s.telegram_webhook_secret,
                "allowed_updates": ["message"],
                "drop_pending_updates": True,
                "max_connections": 10,
            },
        ),
        ("setMyCommands", {"commands": [{"command": c, "description": d} for c, d in COMMANDS]}),
        ("setMyDescription", {"description": DESCRIPTION}),
        ("setMyShortDescription", {"short_description": "Open-source issues likely to get your PR merged."}),
    ]
    ok = True
    for method, body in calls:
        r = httpx.post(f"{api}/{method}", json=body, timeout=20)
        good = r.status_code == 200 and r.json().get("ok")
        ok &= bool(good)
        log.info("%s: %s", method, "ok" if good else r.text[:200])
    info = httpx.get(f"{api}/getWebhookInfo", timeout=20).json().get("result", {})
    log.info(
        "webhook url=%s pending=%s last_error=%s",
        info.get("url"),
        info.get("pending_update_count"),
        info.get("last_error_message"),
    )
    return 0 if ok else 1


def status(s: Settings) -> int:
    """Read-only health check: webhook state from Telegram and subscriber counts (no chat ids printed)."""
    from .store import open_store

    if not s.telegram_token:
        log.error("need TELEGRAM_BOT_TOKEN")
        return 1
    info = httpx.get(f"https://api.telegram.org/bot{s.telegram_token}/getWebhookInfo", timeout=20).json()
    r = info.get("result", {})
    log.info(
        "webhook url=%s pending=%s last_error=%s last_error_date=%s",
        r.get("url"),
        r.get("pending_update_count"),
        r.get("last_error_message"),
        r.get("last_error_date"),
    )
    try:
        subs = open_store(s).select("subscribers")
    except httpx.HTTPStatusError as e:  # PostgREST explains itself (e.g. table not found); no secrets in it
        log.error("subscribers table unavailable: %s %s", e.response.status_code, e.response.text[:300])
        return 1
    except Exception as e:
        log.error("subscribers table unavailable: %s", type(e).__name__)
        return 1
    active = sum(1 for x in subs if x.get("active"))
    log.info("subscribers: %d active, %d total", active, len(subs))
    return 0 if not r.get("last_error_message") else 1


def db_status(s: Settings) -> int:
    """Which Supabase project the collector talks to and which tables its API exposes (names only)."""
    from urllib.parse import urlparse

    if not (s.supabase_url and s.supabase_key):
        log.error("no SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY")
        return 1
    host = urlparse(s.supabase_url).hostname or "?"
    log.info("supabase project: %s", host.split(".")[0])
    r = httpx.get(
        s.supabase_url.rstrip("/") + "/rest/v1/",
        headers={"apikey": s.supabase_key, "Authorization": f"Bearer {s.supabase_key}"},
        timeout=20,
    )
    if r.status_code != 200:
        log.error("API root: %s %s", r.status_code, r.text[:200])
        return 1
    tables = sorted(p.strip("/") for p in (r.json().get("paths") or {}) if p.strip("/") and "/" not in p.strip("/"))
    log.info("tables exposed by the API: %s", ", ".join(tables) or "(none)")
    return 0 if "subscribers" in tables else 1
