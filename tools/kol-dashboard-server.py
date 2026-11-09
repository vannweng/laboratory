#!/usr/bin/env python3
"""Serve the local Life Lab preview and its private KOL update feed."""

from __future__ import annotations

import json
import os
import sqlite3
import time
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATABASE = Path.home() / "KOL追蹤" / "kolwatch.db"


def iso_time(timestamp: float | None) -> str | None:
    if timestamp is None:
        return None
    return datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat()


def latest_updates() -> dict[str, object]:
    if not DATABASE.exists():
        return {"items": [], "tracked_count": 0, "last_checked_at": None}
    cutoff = time.time() - 24 * 60 * 60
    with sqlite3.connect(f"file:{DATABASE}?mode=ro", uri=True) as connection:
        connection.row_factory = sqlite3.Row
        rows = connection.execute(
            """
            SELECT username, shortcode, kind, caption, posted_at, detected_at
            FROM history
            WHERE detected_at >= ?
            ORDER BY detected_at DESC
            LIMIT 30
            """,
            (cutoff,),
        ).fetchall()
        tracked_count = connection.execute(
            "SELECT COUNT(*) FROM kols WHERE state = 'active'"
        ).fetchone()[0]
        latest_check = connection.execute(
            "SELECT MAX(last_checked_at) FROM kols"
        ).fetchone()[0]
    return {
        "items": [
            {
                "username": row["username"],
                "shortcode": row["shortcode"],
                "kind": row["kind"],
                "caption": row["caption"],
                "posted_at": iso_time(row["posted_at"]),
                "detected_at": iso_time(row["detected_at"]),
            }
            for row in rows
        ],
        "tracked_count": tracked_count,
        "last_checked_at": iso_time(latest_check),
    }


class DashboardHandler(SimpleHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        if urlparse(self.path).path == "/api/kol/recent":
            payload = json.dumps(latest_updates(), ensure_ascii=False).encode("utf-8")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        super().do_GET()


if __name__ == "__main__":
    os.chdir(PROJECT_ROOT)
    server = ThreadingHTTPServer(("127.0.0.1", 8001), DashboardHandler)
    print("生活實驗室本機資料預覽：http://127.0.0.1:8001/inspiration/")
    server.serve_forever()
