"""Fetch a bounded Instagram batch and publish a feed for GitHub Pages."""
import json
import os
import re
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
FEED = ROOT / "inspiration/feed.json"


def api(path, token, payload=None):
    body = None if payload is None else json.dumps(payload).encode()
    request = Request(
        "https://api.brightdata.com/datasets/v3/" + path,
        data=body,
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
    )
    with urlopen(request, timeout=90) as response:
        return json.load(response)


def normalize(rows, usernames, now):
    items = {}
    errors = []
    cutoff = now - timedelta(hours=24)
    for row in rows:
        if row.get("error"):
            # This service also uses dead_page for an empty date range.
            if "no public posts" not in row["error"].lower():
                errors.append({"url": row.get("input", {}).get("url"), "message": row["error"]})
            continue
        username = row.get("user_posted", "").lower()
        url = row.get("url", "")
        match = re.fullmatch(r"https://www\.instagram\.com/(p|reel)/([A-Za-z0-9_-]+)/?", url)
        published_raw = row.get("date_posted")
        if username not in usernames or not match or not published_raw:
            errors.append({"message": "A returned record has missing or invalid post fields"})
            continue
        published = datetime.fromisoformat(published_raw.replace("Z", "+00:00"))
        if cutoff <= published <= now:
            items[match[2]] = {
                "username": username, "shortcode": match[2],
                "kind": match[1], "caption": row.get("description") or "",
                "posted_at": published.isoformat(), "detected_at": now.isoformat(),
            }
    return sorted(items.values(), key=lambda item: item["posted_at"], reverse=True), errors


def main():
    token = os.environ.get("BRIGHTDATA_API_TOKEN")
    if not token:
        raise SystemExit("Add the BRIGHTDATA_API_TOKEN repository secret before running this workflow.")
    html = (ROOT / "inspiration/index.html").read_text()
    usernames = list(dict.fromkeys(re.findall(r'class="account-name">([^<]+)<', html)))
    now = datetime.now(timezone.utc)
    payload = {"input": [
        {"url": f"https://www.instagram.com/{name}/", "num_of_posts": 3,
         "start_date": (now - timedelta(days=2)).strftime("%m-%d-%Y"),
         "end_date": (now + timedelta(days=1)).strftime("%m-%d-%Y")}
        for name in usernames
    ], "limit_per_input": 3}
    result = api("trigger?dataset_id=gd_lk5ns7kz21pck8jpis&type=discover_new&discover_by=url&include_errors=true", token, payload)
    snapshot = result["snapshot_id"]
    for attempt in range(40):
        progress = api("progress/" + snapshot, token)
        if progress.get("status") == "ready":
            break
        if progress.get("status") == "failed":
            raise SystemExit("Bright Data collection failed. Existing feed is preserved.")
        time.sleep(15)
    else:
        raise SystemExit("Bright Data collection timed out. Existing feed is preserved.")
    rows = api("snapshot/" + snapshot + "?format=json", token)
    if not isinstance(rows, list):
        raise SystemExit("Unexpected Bright Data response. Existing feed is preserved.")
    items, errors = normalize(rows, usernames, datetime.now(timezone.utc))
    if errors:
        raise SystemExit(f"Collection returned {len(errors)} errors. Existing feed is preserved.")
    feed = {"items": items, "tracked_count": len(usernames), "last_checked_at": datetime.now(timezone.utc).isoformat()}
    temporary = FEED.with_suffix(".tmp")
    temporary.write_text(json.dumps(feed, ensure_ascii=False, indent=2) + "\n")
    temporary.replace(FEED)
    print(f"Updated {len(usernames)} accounts, {len(items)} posts published in the last 24 hours.")


if __name__ == "__main__":
    main()
