"""Telegram alerts (deduped through the alerts table) and the daily 8:00 IST digest."""

from __future__ import annotations

import html
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from .config import Settings
from .store import Store

log = logging.getLogger(__name__)
IST = timezone(timedelta(hours=5, minutes=30))


def in_quiet_hours(now: datetime, s: Settings) -> bool:
    h = now.astimezone(IST).hour
    start, end = s.quiet_start_hour_ist, s.quiet_end_hour_ist
    return start <= h < end if start <= end else (h >= start or h < end)


def send_telegram(s: Settings, text: str) -> bool:
    if not s.use_telegram:
        log.info("telegram not configured; would send:\n%s", text)
        return False
    r = httpx.post(
        f"https://api.telegram.org/bot{s.telegram_token}/sendMessage",
        json={"chat_id": s.telegram_chat_id, "text": text, "parse_mode": "HTML", "disable_web_page_preview": True},
        timeout=20,
    )
    if r.status_code != 200:
        log.warning("telegram send failed: %s %s", r.status_code, r.text[:200])
        return False
    return True


def _e(x: Any) -> str:
    """Escape for Telegram HTML, including quotes so values can't break out of href="..."."""
    return html.escape(str(x), quote=True)


def _href(url: Any) -> str:
    u = str(url or "")
    return _e(u) if u.startswith(("https://", "http://")) else "#"


def format_opportunity(o: dict[str, Any], site: str) -> str:
    reasons = " · ".join(r["text"] for r in o["reasons"][:3])
    return (
        f'<b>{round(o["score"] * 100)}</b> · <a href="{_href(o["url"])}">{_e(o["repo"])}#{o["number"]}</a>\n'
        f"{_e(o['title'])}\n<i>{_e(reasons)}</i>"
    )


def send_alerts(store: Store, s: Settings, payload: dict[str, Any], now: datetime) -> int:
    if in_quiet_hours(now, s):
        log.info("quiet hours, no alerts")
        return 0
    sent_ids = {a["target_id"] for a in store.select("alerts", eq={"channel": "telegram"})}
    fresh = [
        o
        for o in payload["opportunities"]
        if o["score"] >= s.alert_threshold and f"issue:{o['id']}" not in sent_ids and not o["hidden"]
    ][: s.max_alerts_per_run]
    if not fresh:
        return 0
    text = "📡 <b>PR Radar</b> — new opportunities\n\n" + "\n\n".join(format_opportunity(o, s.site_url) for o in fresh)
    if send_telegram(s, text):
        store.upsert(
            "alerts",
            [
                {
                    "id": f"telegram:issue:{o['id']}",
                    "target_id": f"issue:{o['id']}",
                    "channel": "telegram",
                    "sent_at": now.isoformat(),
                }
                for o in fresh
            ],
        )
        return len(fresh)
    return 0


def send_digest(store: Store, s: Settings, payload: dict[str, Any], now: datetime) -> bool:
    day = now.astimezone(IST).date().isoformat()
    key = f"telegram:digest:{day}"
    if store.select("alerts", eq={"id": key}):
        log.info("digest already sent for %s", day)
        return False
    opps = [o for o in payload["opportunities"] if not o["hidden"]][:5]
    repos = sorted(
        (r for r in payload["repos"] if not r["hidden"]), key=lambda r: r.get("velocity") or 0, reverse=True
    )[:3]
    news = payload["news"][:3]
    lines = [f"☀️ <b>PR Radar digest</b> · {day}", "", "<b>Top opportunities</b>"]
    lines += [f"{i}. {format_opportunity(o, s.site_url)}" for i, o in enumerate(opps, 1)] or ["none above zero today"]
    lines += ["", "<b>Trending repos</b>"]
    for r in repos:
        vel = f"+{r['velocity']:,.0f}★/day" if r.get("velocity") else f"{r['stars']:,}★"
        lines.append(f'• <a href="https://github.com/{_e(r["full_name"])}">{_e(r["full_name"])}</a> {vel}')
    lines += ["", "<b>News</b>"]
    lines += [f'• <a href="{_href(n["url"])}">{_e(n["title"])}</a>' for n in news]
    lines += ["", f'<a href="{_href(s.site_url)}">Open the radar →</a>']
    if send_telegram(s, "\n".join(lines)):
        store.upsert(
            "alerts", [{"id": key, "target_id": f"digest:{day}", "channel": "telegram", "sent_at": now.isoformat()}]
        )
        return True
    return False
