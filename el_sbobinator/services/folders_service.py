"""
Archive folder management for El Sbobinator.

Folders are persisted in the same app-data directory as config.json,
in a file called ``folders.json``.

Data model::

    {
      "folders": [
        {
          "id": "<uuid>",
          "name": "Anatomia",
          "color": "#FF6B6B",
          "session_dirs": ["<absolute/session/dir>", ...]
        },
        ...
      ]
    }
"""

from __future__ import annotations

import json
import os

from el_sbobinator.services.config_service import CONFIG_FILE

FOLDERS_FILE = os.path.join(os.path.dirname(CONFIG_FILE), "folders.json")


def get_folders() -> list[dict]:
    """Return the saved folder list, or ``[]`` if the file is absent or corrupt."""
    try:
        if not os.path.isfile(FOLDERS_FILE):
            return []
        with open(FOLDERS_FILE, encoding="utf-8") as fh:
            data = json.load(fh)
        if not isinstance(data, dict):
            return []
        folders = data.get("folders", [])
        if not isinstance(folders, list):
            return []
        return [f for f in folders if isinstance(f, dict)]
    except Exception:
        return []


def save_folders(folders: list[dict]) -> None:
    """Atomically write *folders* to disk."""
    if not isinstance(folders, list):
        raise TypeError("folders must be a list")
    os.makedirs(os.path.dirname(FOLDERS_FILE), exist_ok=True)
    tmp = FOLDERS_FILE + ".tmp"
    payload = json.dumps({"folders": folders}, ensure_ascii=False, indent=2)
    try:
        with open(tmp, "w", encoding="utf-8") as fh:
            fh.write(payload)
        os.replace(tmp, FOLDERS_FILE)
    except Exception:
        try:
            os.remove(tmp)
        except Exception:
            pass
        raise
