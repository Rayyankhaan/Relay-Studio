"""ShortsPilot – Xavier Memes: Trending Meme Audio Research Trigger."""

from __future__ import annotations

import json
import os
import sys
import urllib.request

SERVER_URL = os.environ.get("SHORTSPILOT_URL", "http://localhost:3000")


def run_audio_research(focus_topic: str = "") -> dict:
    payload = json.dumps({"focusTopic": focus_topic}).encode("utf-8")
    req = urllib.request.Request(
        f"{SERVER_URL}/api/audio/research",
        method="POST",
        data=payload,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


if __name__ == "__main__":
    topic = " ".join(sys.argv[1:]).strip()
    print(json.dumps(run_audio_research(topic), indent=2))
