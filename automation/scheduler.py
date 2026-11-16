"""ShortsPilot – Xavier Memes: 5-Per-Day EST Scheduler Companion Script."""

from __future__ import annotations

import os
import time
import urllib.request

SERVER_URL = os.environ.get("SHORTSPILOT_URL", "http://localhost:3000")
DEFAULT_TIMEZONE = "America/New_York"
DEFAULT_SLOTS = ["09:00", "12:00", "15:00", "18:00", "21:00"]


def run_tick() -> str:
    req = urllib.request.Request(
        f"{SERVER_URL}/api/scheduler/tick",
        method="POST",
        data=b"{}",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read().decode("utf-8", errors="ignore")


if __name__ == "__main__":
    print(f"[scheduler] Running 5/day {DEFAULT_TIMEZONE} tick loop against {SERVER_URL}")
    while True:
        try:
            print(f"[scheduler] {run_tick()}")
        except KeyboardInterrupt:
            break
        except Exception as exc:
            print(f"[scheduler] Tick error: {exc}")
        time.sleep(30)
