"""Thin GitHub REST + GraphQL client with polite rate-limit handling."""

from __future__ import annotations

import logging
import time
from typing import Any

import httpx

log = logging.getLogger(__name__)


class GitHubError(RuntimeError):
    pass


class GitHub:
    def __init__(self, token: str | None) -> None:
        headers = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "pr-radar",
        }
        if token:
            headers["Authorization"] = f"Bearer {token}"
        self.has_token = bool(token)
        self.client = httpx.Client(base_url="https://api.github.com", headers=headers, timeout=60)
        self.graphql_cost = 0

    def _request(self, method: str, url: str, **kw: Any) -> httpx.Response:
        for attempt in range(5):
            try:
                r = self.client.request(method, url, **kw)
            except httpx.TransportError as e:
                log.warning("transport error %s (attempt %d)", e, attempt + 1)
                time.sleep(2**attempt)
                continue
            if r.status_code in (403, 429) and (
                r.headers.get("x-ratelimit-remaining") == "0" or "rate limit" in r.text.lower()
            ):
                reset = int(r.headers.get("x-ratelimit-reset", time.time() + 60))
                wait = int(r.headers.get("retry-after", max(5, reset - time.time() + 2)))
                if wait > 300:
                    raise GitHubError(f"rate limited for {wait}s on {url}")
                log.warning("rate limited, sleeping %ss", wait)
                time.sleep(wait)
                continue
            if r.status_code >= 500 or r.status_code == 502:
                time.sleep(2**attempt)
                continue
            return r
        raise GitHubError(f"giving up on {method} {url}")

    def get(self, url: str, **params: Any) -> Any:
        r = self._request("GET", url, params=params)
        if r.status_code == 404:
            return None
        if r.status_code >= 400:
            raise GitHubError(f"{r.status_code} {url}: {r.text[:200]}")
        return r.json()

    def search(self, kind: str, q: str, sort: str | None = None, per_page: int = 50, pages: int = 1) -> list[dict]:
        items: list[dict] = []
        for page in range(1, pages + 1):
            params: dict[str, Any] = {"q": q, "per_page": per_page, "page": page}
            if sort:
                params.update(sort=sort, order="desc")
            data = self.get(f"/search/{kind}", **params)
            if not data:
                break
            items.extend(data.get("items", []))
            if len(data.get("items", [])) < per_page:
                break
            time.sleep(2.1)  # search API: 30 requests/min
        return items

    def graphql(self, query: str, variables: dict[str, Any]) -> dict[str, Any]:
        if not self.has_token:
            raise GitHubError("GraphQL needs a token (set GH_TOKEN or sign in with gh)")
        r = self._request("POST", "/graphql", json={"query": query, "variables": variables})
        body = r.json()
        if body.get("errors") and not body.get("data"):
            raise GitHubError(str(body["errors"])[:300])
        if body.get("errors"):
            log.warning("graphql partial errors: %s", str(body["errors"])[:200])
        cost = ((body.get("data") or {}).get("rateLimit") or {}).get("cost")
        if cost:
            self.graphql_cost += cost
        return body["data"]
