"""Storage: Supabase (PostgREST) in production, SQLite in data/radar.db for local runs.

Both backends expose the same small interface, so collectors never care where rows go.
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterable
from pathlib import Path
from typing import Any, Protocol

import httpx

from .config import DATA_DIR, Settings

JSON_COLUMNS = {"topics", "labels", "tags", "reasons_json", "payload"}

# table -> (columns, conflict key). Mirrors supabase/migrations/0001_init.sql.
TABLES: dict[str, tuple[list[str], list[str]]] = {
    "repos": (
        ["id", "full_name", "description", "language", "topics", "source", "created_at", "first_seen_at"],
        ["id"],
    ),
    "repo_snapshots": (["repo_id", "taken_at", "stars", "forks", "open_prs", "open_issues"], ["repo_id", "taken_at"]),
    "repo_signals": (
        [
            "repo_id",
            "computed_at",
            "outside_prs_closed_90d",
            "outside_prs_merged_90d",
            "outside_merge_rate_90d",
            "median_first_response_h",
            "open_pr_backlog",
            "days_since_maintainer_merge",
            "ci_pass_rate",
            "has_contributing",
            "ai_policy",
            "ai_policy_evidence",
        ],
        ["repo_id"],
    ),
    "issues": (
        [
            "id",
            "repo_id",
            "number",
            "title",
            "url",
            "labels",
            "created_at",
            "comments",
            "assignee",
            "has_linked_pr",
            "state",
            "updated_seen",
        ],
        ["id"],
    ),
    "news_items": (["id", "source", "title", "url", "points", "comments", "published_at", "tags"], ["id"]),
    "scores": (
        ["target_type", "target_id", "score", "reasons_json", "model_version", "scored_at"],
        ["target_type", "target_id"],
    ),
    "alerts": (["id", "target_id", "channel", "sent_at"], ["id"]),
    "feedback": (["id", "target_id", "action", "at"], ["id"]),
    "site_snapshot": (["id", "generated_at", "payload"], ["id"]),
}


class Store(Protocol):
    def upsert(self, table: str, rows: Iterable[dict[str, Any]]) -> int: ...
    def insert(self, table: str, rows: Iterable[dict[str, Any]]) -> None: ...
    def select(
        self,
        table: str,
        *,
        eq: dict[str, Any] | None = None,
        gte: dict[str, Any] | None = None,
        order: str | None = None,
        desc: bool = False,
        limit: int | None = None,
    ) -> list[dict[str, Any]]: ...
    def delete(self, table: str, *, eq: dict[str, Any]) -> None: ...


def _clean(table: str, row: dict[str, Any]) -> dict[str, Any]:
    cols = TABLES[table][0]
    return {k: v for k, v in row.items() if k in cols}


class SQLiteStore:
    def __init__(self, path: Path | None = None) -> None:
        path = path or DATA_DIR / "radar.db"
        path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(path)
        self.conn.row_factory = sqlite3.Row
        for table, (cols, key) in TABLES.items():
            pk = ", ".join(key)
            col_sql = ", ".join(
                f"{c} INTEGER PRIMARY KEY AUTOINCREMENT" if (table == "feedback" and c == "id") else c for c in cols
            )
            tail = "" if table == "feedback" else f", PRIMARY KEY ({pk})"
            self.conn.execute(f"CREATE TABLE IF NOT EXISTS {table} ({col_sql}{tail})")
        self.conn.commit()

    @staticmethod
    def _enc(col: str, v: Any) -> Any:
        if col in JSON_COLUMNS and v is not None and not isinstance(v, str):
            return json.dumps(v)
        if isinstance(v, bool):
            return int(v)
        return v

    @staticmethod
    def _dec(row: sqlite3.Row) -> dict[str, Any]:
        out = dict(row)
        for k in JSON_COLUMNS & out.keys():
            if isinstance(out[k], str):
                out[k] = json.loads(out[k])
        return out

    def upsert(self, table: str, rows: Iterable[dict[str, Any]]) -> int:
        n = 0
        key = TABLES[table][1]
        for row in rows:
            row = _clean(table, row)
            cols = list(row)
            updates = ", ".join(f"{c}=excluded.{c}" for c in cols if c not in key) or f"{key[0]}={key[0]}"
            self.conn.execute(
                f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))}) "
                f"ON CONFLICT ({', '.join(key)}) DO UPDATE SET {updates}",
                [self._enc(c, row[c]) for c in cols],
            )
            n += 1
        self.conn.commit()
        return n

    def insert(self, table: str, rows: Iterable[dict[str, Any]]) -> None:
        for row in rows:
            row = _clean(table, row)
            cols = list(row)
            self.conn.execute(
                f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
                [self._enc(c, row[c]) for c in cols],
            )
        self.conn.commit()

    def select(self, table, *, eq=None, gte=None, order=None, desc=False, limit=None):
        sql, args, conds = f"SELECT * FROM {table}", [], []
        for k, v in (eq or {}).items():
            conds.append(f"{k} = ?")
            args.append(self._enc(k, v))
        for k, v in (gte or {}).items():
            conds.append(f"{k} >= ?")
            args.append(self._enc(k, v))
        if conds:
            sql += " WHERE " + " AND ".join(conds)
        if order:
            sql += f" ORDER BY {order} {'DESC' if desc else 'ASC'}"
        if limit:
            sql += f" LIMIT {int(limit)}"
        return [self._dec(r) for r in self.conn.execute(sql, args).fetchall()]

    def delete(self, table, *, eq):
        self.conn.execute(f"DELETE FROM {table} WHERE " + " AND ".join(f"{k} = ?" for k in eq), list(eq.values()))
        self.conn.commit()


class SupabaseStore:
    def __init__(self, url: str, key: str) -> None:
        self.client = httpx.Client(
            base_url=url.rstrip("/") + "/rest/v1",
            headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            timeout=60,
        )

    def upsert(self, table, rows):
        rows = [_clean(table, r) for r in rows]
        if not rows:
            return 0
        key = ",".join(TABLES[table][1])
        # PostgREST bulk upsert requires the same keys in every row.
        for i in range(0, len(rows), 500):
            chunk = rows[i : i + 500]
            r = self.client.post(
                f"/{table}",
                params={"on_conflict": key},
                json=chunk,
                headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
            )
            r.raise_for_status()
        return len(rows)

    def insert(self, table, rows):
        rows = [_clean(table, r) for r in rows]
        if rows:
            self.client.post(f"/{table}", json=rows, headers={"Prefer": "return=minimal"}).raise_for_status()

    def select(self, table, *, eq=None, gte=None, order=None, desc=False, limit=None):
        params: dict[str, str] = {"select": "*"}
        for k, v in (eq or {}).items():
            params[k] = f"eq.{str(v).lower() if isinstance(v, bool) else v}"
        for k, v in (gte or {}).items():
            params[k] = f"gte.{v}"
        if order:
            params["order"] = f"{order}.{'desc' if desc else 'asc'}"
        out: list[dict[str, Any]] = []
        page = 1000
        offset = 0
        while True:
            want = page if limit is None else min(page, limit - len(out))
            r = self.client.get(f"/{table}", params={**params, "limit": str(want), "offset": str(offset)})
            r.raise_for_status()
            batch = r.json()
            out.extend(batch)
            offset += len(batch)
            if len(batch) < want or (limit is not None and len(out) >= limit):
                return out

    def delete(self, table, *, eq):
        self.client.delete(f"/{table}", params={k: f"eq.{v}" for k, v in eq.items()}).raise_for_status()


def open_store(settings: Settings) -> Store:
    if settings.use_supabase:
        return SupabaseStore(settings.supabase_url, settings.supabase_key)  # type: ignore[arg-type]
    return SQLiteStore()
