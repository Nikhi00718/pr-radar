"""Hacker News stories (Algolia API) and release feeds for watched repos."""

from __future__ import annotations

import logging
import re
import xml.etree.ElementTree as ET
from datetime import UTC, datetime, timedelta

import httpx

from .config import NEWS_KEYWORDS, WATCHLIST, Settings
from .store import Store

log = logging.getLogger(__name__)

ATOM = "{http://www.w3.org/2005/Atom}"


def match_tags(text: str) -> list[str]:
    low = text.lower()
    tags = []
    for kw in NEWS_KEYWORDS:
        if re.search(rf"(?<![a-z]){re.escape(kw)}(?![a-z])", low):
            tags.append(kw.replace("open-source", "open source"))
    return list(dict.fromkeys(tags))


def collect_hn(store: Store, s: Settings, now: datetime) -> int:
    since = int((now - timedelta(days=3)).timestamp())
    rows = []
    for page in range(3):
        r = httpx.get(
            "https://hn.algolia.com/api/v1/search_by_date",
            params={
                "tags": "story",
                "numericFilters": f"points>{s.news_min_points},created_at_i>{since}",
                "hitsPerPage": 100,
                "page": page,
            },
            timeout=30,
        )
        r.raise_for_status()
        hits = r.json().get("hits", [])
        for h in hits:
            title = h.get("title") or ""
            tags = match_tags(title)
            if not tags:
                continue
            rows.append(
                {
                    "id": f"hn:{h['objectID']}",
                    "source": "hn",
                    "title": title,
                    "url": h.get("url") or f"https://news.ycombinator.com/item?id={h['objectID']}",
                    "points": h.get("points") or 0,
                    "comments": h.get("num_comments") or 0,
                    "published_at": h["created_at"],
                    "tags": tags,
                }
            )
        if len(hits) < 100:
            break
    store.upsert("news_items", rows)
    log.info("hn stories kept: %d", len(rows))
    return len(rows)


def collect_releases(store: Store, now: datetime, repos: list[str] | None = None) -> int:
    rows = []
    cutoff = now - timedelta(days=14)
    with httpx.Client(timeout=20, headers={"User-Agent": "pr-radar"}) as client:
        for full in repos or WATCHLIST:
            try:
                r = client.get(f"https://github.com/{full}/releases.atom")
                r.raise_for_status()
                root = ET.fromstring(r.content)
            except (httpx.HTTPError, ET.ParseError) as e:
                log.debug("release feed failed for %s: %s", full, e)
                continue
            for entry in root.findall(f"{ATOM}entry")[:3]:
                updated = entry.findtext(f"{ATOM}updated")
                if not updated:
                    continue
                ts = datetime.fromisoformat(updated.replace("Z", "+00:00"))
                if ts < cutoff:
                    continue
                title = entry.findtext(f"{ATOM}title") or ""
                link = entry.find(f"{ATOM}link")
                url = link.get("href") if link is not None else f"https://github.com/{full}/releases"
                tag = url.rsplit("/", 1)[-1]
                rows.append(
                    {
                        "id": f"release:{full}@{tag}",
                        "source": "release",
                        "title": f"{full} {title}".strip(),
                        "url": url,
                        "points": None,
                        "comments": None,
                        "published_at": ts.astimezone(UTC).isoformat(),
                        "tags": ["release", full.split("/")[1].lower()],
                    }
                )
    store.upsert("news_items", rows)
    log.info("releases kept: %d", len(rows))
    return len(rows)
