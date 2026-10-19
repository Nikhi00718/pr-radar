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
