"""ShortsPilot – Xavier Memes: Official YouTube Data API v3 Uploader Companion.

Enforces the exact locked title & hashtags:
  Xavier memes funny #memes #xavier #xaviermemes
Never alters metadata, never exposes secrets, and uses resumable upload.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.request
from pathlib import Path

FIXED_TITLE = "Xavier memes funny #memes #xavier #xaviermemes"
FIXED_DESCRIPTION = "Xavier memes funny #memes #xavier #xaviermemes"
FIXED_TAGS = ["memes", "xavier", "xaviermemes"]


def upload_short(video_path: Path, access_token: str, privacy: str = "private", publish_at: str | None = None) -> dict:
    if not video_path.exists():
        raise FileNotFoundError(f"Video file not found: {video_path}")

    body_dict = {
        "snippet": {
            "title": FIXED_TITLE,
            "description": FIXED_DESCRIPTION,
            "tags": FIXED_TAGS,
            "categoryId": "23",
        },
        "status": {
            "privacyStatus": "private" if publish_at else privacy,
            "selfDeclaredMadeForKids": False,
        },
    }
    if publish_at:
        body_dict["status"]["publishAt"] = publish_at

    file_bytes = video_path.read_bytes()
    init_req = urllib.request.Request(
        "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
        method="POST",
        data=json.dumps(body_dict).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json; charset=UTF-8",
            "X-Upload-Content-Length": str(len(file_bytes)),
            "X-Upload-Content-Type": "video/mp4",
        },
    )

    with urllib.request.urlopen(init_req, timeout=30) as init_resp:
        upload_url = init_resp.headers.get("Location")
        if not upload_url:
            raise RuntimeError("Missing resumable upload Location header from YouTube API.")

    put_req = urllib.request.Request(
        upload_url,
        method="PUT",
        data=file_bytes,
        headers={"Content-Type": "video/mp4"},
    )
    with urllib.request.urlopen(put_req, timeout=300) as put_resp:
        result = json.loads(put_resp.read().decode("utf-8"))
        vid = result.get("id")
        return {
            "youtubeVideoId": vid,
            "youtubeUrl": f"https://youtube.com/shorts/{vid}" if vid else None,
        }


if __name__ == "__main__":
    token = os.environ.get("YOUTUBE_ACCESS_TOKEN", "")
    if len(sys.argv) < 2 or not token:
        print("Usage: YOUTUBE_ACCESS_TOKEN=... python youtube_uploader.py <video_file>")
        sys.exit(1)
    print(json.dumps(upload_short(Path(sys.argv[1]), token), indent=2))
