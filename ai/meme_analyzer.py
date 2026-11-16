"""ShortsPilot – Xavier Memes: AI Meme Analyzer Companion CLI.

Calls the ShortsPilot backend endpoint (/api/videos/:id/analyze) so Gemini API
keys stay strictly server-side and fixed metadata is never altered.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.request

SERVER_URL = os.environ.get("SHORTSPILOT_URL", "http://localhost:3000")


def analyze_video_by_id(video_id: str) -> dict:
    req = urllib.request.Request(
        f"{SERVER_URL}/api/videos/{video_id}/analyze",
        method="POST",
        data=b"{}",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python ai/meme_analyzer.py <video_id>")
        sys.exit(1)
    print(json.dumps(analyze_video_by_id(sys.argv[1]), indent=2))
