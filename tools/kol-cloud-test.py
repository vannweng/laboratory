"""Test public Instagram access from a GitHub-hosted runner."""
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
import instaloader


def main():
    loader = instaloader.Instaloader(max_connection_attempts=1, request_timeout=30)
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    results = []
    for username in ("carrielee_cla", "harryleeai"):
        result = {"username": username, "ok": False, "posts": []}
        try:
            profile = instaloader.Profile.from_username(loader.context, username)
            for index, post in enumerate(profile.get_posts()):
                published = post.date_utc.replace(tzinfo=timezone.utc)
                result["posts"].append({
                    "shortcode": post.shortcode,
                    "published_at": published.isoformat(),
                    "within_24_hours": published >= cutoff,
                })
                if index >= 4:
                    break
            result["ok"] = True
        except Exception as error:
            result["error"] = str(error)
        results.append(result)
        if not result["ok"]:
            break
    report = {"checked_at": datetime.now(timezone.utc).isoformat(), "results": results}
    Path("kol-cloud-test.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if len(results) != 2 or not all(result["ok"] for result in results):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
