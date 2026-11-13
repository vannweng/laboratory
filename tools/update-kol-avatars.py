"""Save missing Instagram profile pictures once for the static site."""
import os
import re
import time
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = spec_from_file_location("kol_feed", ROOT / "tools/update-kol-feed.py")
feed = module_from_spec(spec)
spec.loader.exec_module(feed)
AVATARS = ROOT / "inspiration/avatars"


def main():
    usernames = list(dict.fromkeys(re.findall(
        r'class="account-name">([^<]+)<',
        (ROOT / "inspiration/index.html").read_text(),
    )))
    pending = [name for name in usernames if not (AVATARS / f"{name}.jpg").exists()]
    if not pending:
        print("All profile pictures are already saved.")
        return
    token = os.environ["BRIGHTDATA_API_TOKEN"]
    result = feed.api(
        "trigger?dataset_id=gd_l1vikfch901nx3by4&include_errors=true",
        token, [{"url": f"https://www.instagram.com/{name}/"} for name in pending],
    )
    snapshot = result["snapshot_id"]
    for attempt in range(40):
        progress = feed.api("progress/" + snapshot, token)
        if progress.get("status") == "ready":
            break
        if progress.get("status") == "failed":
            raise RuntimeError("Profile collection failed")
        time.sleep(15)
    else:
        raise RuntimeError("Profile collection timed out")
    rows = feed.api("snapshot/" + snapshot + "?format=json", token)
    AVATARS.mkdir(exist_ok=True)
    for row in rows:
        profile_url = row.get("input", {}).get("url") or row.get("url", "")
        username = row.get("account") or row.get("username") or urlparse(profile_url).path.strip("/")
        if username not in pending:
            continue
        image_url = row.get("profile_image_link")
        if not image_url:
            print(f"No profile picture available for {username}")
            continue
        host = urlparse(image_url).hostname or ""
        if not (host.endswith(".cdninstagram.com") or host.endswith(".fbcdn.net")):
            print(f"Unexpected image host for {username}")
            continue
        try:
            with urlopen(Request(image_url, headers={"User-Agent": "Mozilla/5.0"}), timeout=30) as response:
                content = response.read(5_000_001)
            if len(content) > 5_000_000 or not content.startswith(b"\xff\xd8\xff"):
                print(f"Unsupported profile picture for {username}")
                continue
            target = AVATARS / f"{username}.jpg"
            temporary = target.with_suffix(".tmp")
            temporary.write_bytes(content)
            temporary.replace(target)
            print(f"Saved profile picture for {username}")
        except OSError as error:
            print(f"Could not save profile picture for {username}: {type(error).__name__}")


if __name__ == "__main__":
    main()
