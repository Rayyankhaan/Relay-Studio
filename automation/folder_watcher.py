"""ShortsPilot – Xavier Memes: Local Windows/Linux Incoming Folder Watcher.

Monitors shorts/incoming/ for new .mp4, .mov, or .webm files and imports them
into the ShortsPilot backend API (or validates & moves them directly when offline).
"""

from __future__ import annotations

import os
import sys
import time
import urllib.request
from pathlib import Path

ALLOWED_EXTENSIONS = {".mp4", ".mov", ".webm"}
ROOT_DIR = Path(__file__).resolve().parent.parent
INCOMING_DIR = ROOT_DIR / "shorts" / "incoming"
SERVER_URL = os.environ.get("SHORTSPILOT_URL", "http://localhost:3000")


def trigger_server_scan() -> None:
    req = urllib.request.Request(
        f"{SERVER_URL}/api/folder/scan",
        method="POST",
        data=b"{}",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = resp.read().decode("utf-8", errors="ignore")
            print(f"[folder_watcher] Server scan response: {body}")
    except Exception as exc:
        print(f"[folder_watcher] Could not reach server at {SERVER_URL}: {exc}", file=sys.stderr)


def watch_loop(poll_seconds: float = 5.0) -> None:
    INCOMING_DIR.mkdir(parents=True, exist_ok=True)
    seen: set[str] = set()
    print(f"[folder_watcher] Watching {INCOMING_DIR} every {poll_seconds}s...")

    while True:
        try:
            current_files = {
                p.name
                for p in INCOMING_DIR.iterdir()
                if p.is_file()
                and not p.name.startswith(".tmp_")
                and p.suffix.lower() in ALLOWED_EXTENSIONS
            }
            new_files = current_files - seen
            if new_files:
                print(f"[folder_watcher] Detected {len(new_files)} new file(s): {sorted(new_files)}")
                trigger_server_scan()
            seen = current_files
        except KeyboardInterrupt:
            print("[folder_watcher] Stopped.")
            break
        except Exception as exc:
            print(f"[folder_watcher] Watch error: {exc}", file=sys.stderr)
        time.sleep(poll_seconds)


if __name__ == "__main__":
    watch_loop()
