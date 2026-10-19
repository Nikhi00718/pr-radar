"""Telegram alerts and the daily 8:00 IST digest, sent to every subscriber of the public bot.

People subscribe with /start (handled by the website's /api/telegram webhook); each has their own minimum
score, languages and on/off switches. Every message is deduped per chat through the alerts table.
"""

from __future__ import annotations

import html
import logging
import time
from datetime import UTC, datetime, timedelta, timezone
from typing import Any

import httpx

from .config import Settings
from .store import Store

log = logging.getLogger(__name__)
IST = timezone(timedelta(hours=5, minutes=30))
SEND_GAP_S = 0.05  # Telegram allows ~30 messages/second across chats; stay well under it


def in_quiet_hours(now: datetime, s: Settings) -> bool:
    h = now.astimezone(IST).hour
    start, end = s.quiet_start_hour_ist, s.quiet_end_hour_ist
    return start <= h < end if start <= end else (h >= start or h < end)


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


def send_message(s: Settings, chat_id: int | str, text: str) -> str:
    """-> "ok", "blocked" (user blocked the bot or chat is gone) or "error"."""
    if not s.use_telegram:
        log.info("telegram not configured; would send to %s:\n%s", chat_id, text)
        return "error"
    for _attempt in range(3):
        r = httpx.post(
            f"https://api.telegram.org/bot{s.telegram_token}/sendMessage",
            json={"chat_id": chat_id, "text": text, "parse_mode": "HTML", "disable_web_page_preview": True},
            timeout=20,
        )
        time.sleep(SEND_GAP_S)
        if r.status_code == 200:
            return "ok"
        if r.status_code == 429:  # flood control: wait as told, then retry
            wait = (r.json().get("parameters") or {}).get("retry_after", 2)
            time.sleep(min(int(wait), 30))
            continue
        if r.status_code in (400, 403) and any(
            k in r.text for k in ("blocked by the user", "chat not found", "user is deactivated", "kicked")
        ):
            return "blocked"
        log.warning("telegram send failed for a chat: %s %s", r.status_code, r.text[:160])
        return "error"
    return "error"


def subscribers(store: Store, s: Settings, now: datetime) -> list[dict[str, Any]]:
    """Active subscribers. The owner's TELEGRAM_CHAT_ID is always subscribed (first run adds the row)."""
    try:
        rows = store.select("subscribers")
        table_ok = True
    except Exception:  # migration 0003 not applied yet: keep alerting the owner only
        log.warning("subscribers table missing; sending to TELEGRAM_CHAT_ID only")
        rows, table_ok = [], False
    if s.telegram_chat_id and s.telegram_chat_id.lstrip("-").isdigit():
        owner = int(s.telegram_chat_id)
        if not any(r["chat_id"] == owner for r in rows):
            row = {
                "chat_id": owner,
                "active": True,
                "min_score": s.alert_threshold,
                "langs": [],
                "alerts": True,
                "digest": True,
                "created_at": now.isoformat(),
                "updated_at": now.isoformat(),
                "cmd_count": 0,
            }
            if table_ok:
                store.upsert("subscribers", [row])
            rows.append(row)
    return [r for r in rows if r.get("active")]


def _deactivate(store: Store, sub: dict[str, Any], now: datetime) -> None:
    try:
        store.upsert("subscribers", [{**sub, "active": False, "updated_at": now.isoformat()}])
    except Exception:
        log.warning("could not mark a subscriber inactive")
        return
    log.info("a subscriber blocked the bot; marked inactive")


def matches(o: dict[str, Any], sub: dict[str, Any]) -> bool:
    if o.get("hidden") or o["score"] < float(sub.get("min_score") or 0.75):
        return False
    langs = [str(x).lower() for x in (sub.get("langs") or [])]
    return not langs or (o.get("language") or "").lower() in langs


def _legacy_owner_ids(s: Settings, sub: dict[str, Any]) -> bool:
    return bool(s.telegram_chat_id) and str(sub["chat_id"]) == str(s.telegram_chat_id)


def send_alerts(store: Store, s: Settings, payload: dict[str, Any], now: datetime) -> int:
    if not s.use_telegram:
        return 0
    if in_quiet_hours(now, s):
        log.info("quiet hours, no alerts")
        return 0
    sent_ids = {a["id"] for a in store.select("alerts", eq={"channel": "telegram"})}
    total = 0
    for sub in subscribers(store, s, now):
        if not sub.get("alerts", True):
            continue
        chat = sub["chat_id"]
        legacy = _legacy_owner_ids(s, sub)  # alerts sent before the bot went public used ids without a chat

        def already(o: dict[str, Any], chat: int = chat, legacy: bool = legacy) -> bool:
            return f"telegram:{chat}:issue:{o['id']}" in sent_ids or (
                legacy and f"telegram:issue:{o['id']}" in sent_ids
            )

        fresh = [o for o in payload["opportunities"] if matches(o, sub) and not already(o)][: s.max_alerts_per_run]
        if not fresh:
            continue
        text = "📡 <b>PR Radar</b> — new opportunities\n\n" + "\n\n".join(
            format_opportunity(o, s.site_url) for o in fresh
        )
        status = send_message(s, chat, text)
        if status == "blocked":
            _deactivate(store, sub, now)
        elif status == "ok":
            store.upsert(
                "alerts",
                [
                    {
                        "id": f"telegram:{chat}:issue:{o['id']}",
                        "target_id": f"issue:{o['id']}",
                        "channel": "telegram",
                        "sent_at": now.isoformat(),
                    }
                    for o in fresh
                ],
            )
            total += len(fresh)
    log.info("alerts sent: %d", total)
    return total


def digest_text(s: Settings, payload: dict[str, Any], sub: dict[str, Any], day: str) -> str:
    opps = [o for o in payload["opportunities"] if matches(o, {**sub, "min_score": 0.5})][:5]
    repos = sorted(
        (r for r in payload["repos"] if not r["hidden"]), key=lambda r: r.get("velocity") or 0, reverse=True
    )[:3]
    news = payload["news"][:3]
    lines = [f"☀️ <b>PR Radar digest</b> · {day}", "", "<b>Top opportunities</b>"]
    lines += [f"{i}. {format_opportunity(o, s.site_url)}" for i, o in enumerate(opps, 1)] or ["nothing matched today"]
    lines += ["", "<b>Trending repos</b>"]
    for r in repos:
        vel = f"+{r['velocity']:,.0f}★/day" if r.get("velocity") else f"{r['stars']:,}★"
        lines.append(f'• <a href="https://github.com/{_e(r["full_name"])}">{_e(r["full_name"])}</a> {vel}')
    lines += ["", "<b>News</b>"]
    lines += [f'• <a href="{_href(n["url"])}">{_e(n["title"])}</a>' for n in news]
    lines += ["", f'<a href="{_href(s.site_url)}">Open the radar →</a> · /settings to change what you get']
    return "\n".join(lines)


def send_digest(store: Store, s: Settings, payload: dict[str, Any], now: datetime) -> int:
    if not s.use_telegram:
        log.info("telegram not configured; no digest")
        return 0
    day = now.astimezone(IST).date().isoformat()
    sent_ids = {a["id"] for a in store.select("alerts", eq={"channel": "telegram"})}
    sent = 0
    for sub in subscribers(store, s, now):
        if not sub.get("digest", True):
            continue
        chat = sub["chat_id"]
        key = f"telegram:{chat}:digest:{day}"
        if key in sent_ids or (_legacy_owner_ids(s, sub) and f"telegram:digest:{day}" in sent_ids):
            continue
        status = send_message(s, chat, digest_text(s, payload, sub, day))
        if status == "blocked":
            _deactivate(store, sub, now)
        elif status == "ok":
            store.upsert(
                "alerts",
                [
                    {
                        "id": key,
                        "target_id": f"digest:{day}",
                        "channel": "telegram",
                        "sent_at": datetime.now(UTC).isoformat(),
                    }
                ],
            )
            sent += 1
    log.info("digests sent: %d", sent)
    return sent
