"""
Prompts and model defaults shared with the web build.

generation_profile.json is the single source: the desktop pipeline reads it
here and the browser pipeline imports the same file (webui/src/generationProfile.ts).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

GENERATION_PROFILE: dict[str, Any] = json.loads(
    (Path(__file__).resolve().parent.parent / "generation_profile.json").read_text(
        encoding="utf-8"
    )
)
