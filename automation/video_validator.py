"""ShortsPilot – Xavier Memes: FFprobe Video Validation Companion Script."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


def inspect_video(video_path: Path) -> dict:
    cmd = [
        "ffprobe",
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        str(video_path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=True)
    data = json.loads(proc.stdout)
    streams = data.get("streams", [])
    fmt = data.get("format", {})

    video_stream = next((s for s in streams if s.get("codec_type") == "video"), None)
    audio_stream = next((s for s in streams if s.get("codec_type") == "audio"), None)
    if not video_stream:
        raise ValueError(f"No video stream found in {video_path}")

    width = int(video_stream.get("width", 0))
    height = int(video_stream.get("height", 0))
    duration = float(fmt.get("duration", 0.0))
    is_vertical_9x16 = height > width and abs((width / max(height, 1)) - (9 / 16)) < 0.08

    return {
        "file": video_path.name,
        "width": width,
        "height": height,
        "isVertical9x16": is_vertical_9x16,
        "durationSec": round(duration, 2),
        "hasAudio": audio_stream is not None,
        "videoCodec": video_stream.get("codec_name"),
        "formatName": fmt.get("format_name"),
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python video_validator.py <path_to_video>")
        sys.exit(1)
    print(json.dumps(inspect_video(Path(sys.argv[1])), indent=2))
