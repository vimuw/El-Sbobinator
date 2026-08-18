"""
Session management IPC bridge controller.
"""

from __future__ import annotations

import os
import shutil
import time
from typing import TYPE_CHECKING

from el_sbobinator.bridge.bridge_utils import (
    _normalize_revision_failed_blocks,
    _path_under_root,
    _safe_relpath,
)
from el_sbobinator.core.shared import (
    _atomic_write_json,
    cleanup_completed_sessions,
    cleanup_orphan_sessions,
    get_session_root,
    get_session_storage_info,
)
from el_sbobinator.utils.file_ops import evict_html_paths_under
from el_sbobinator.utils.logging_utils import redact_secrets

if TYPE_CHECKING:
    import threading
    from collections import OrderedDict

_TEXT_CACHE_MAX = 50


class SessionControllerMixin:
    """Mixin providing session CRUD, search, folder, and cleanup IPC methods."""

    if TYPE_CHECKING:
        _processing_thread: threading.Thread | None
        _sessions_cache: dict | None
        _sessions_cache_ts: float
        _sessions_cache_gen: int
        _sessions_cache_lock: threading.Lock
        _resolved_path_cache: dict[str, str]
        _resolved_cache_lock: threading.Lock
        _html_shell_cache: dict[str, tuple[str, str]]
        _text_cache: OrderedDict[str, tuple[float, str]]
        _text_cache_lock: threading.Lock
        _cleanup_lock: threading.Lock

        def _get_session_root(self) -> str: ...
        def _find_candidate_audio_path(
            self,
            data: dict,
            session_dir: str,
            session_path: str,
            write_back: bool = True,
        ) -> str | None: ...

    def get_session_storage_info(self) -> dict:
        """Return total size and count of session folders in SESSION_ROOT."""
        try:
            info = get_session_storage_info()
            return {
                "ok": True,
                "total_bytes": info["total_bytes"],
                "total_sessions": info["total_sessions"],
                "session_root": get_session_root(),
            }
        except Exception as e:
            return {
                "ok": False,
                "error": redact_secrets(e),
                "total_bytes": 0,
                "total_sessions": 0,
                "session_root": "",
            }

    def get_completed_sessions(self, limit: int = 0) -> dict:
        """Return the most recent completed sessions for the archive UI."""
        import json as _json

        load_all = int(limit) <= 0
        with self._sessions_cache_lock:
            if (
                not load_all
                and self._sessions_cache is not None
                and time.time() - self._sessions_cache_ts < 5.0
            ):
                cached = self._sessions_cache
                return {**cached, "sessions": list(cached["sessions"])}
            gen_at_start = self._sessions_cache_gen

        session_root = self._get_session_root()
        if not os.path.isdir(session_root):
            return {"ok": True, "sessions": [], "total": 0}
        try:
            candidates: list[tuple[str, dict, str]] = []
            for entry in os.scandir(session_root):
                if not entry.is_dir():
                    continue
                session_path = os.path.join(entry.path, "session.json")
                if not os.path.isfile(session_path):
                    continue
                try:
                    with open(session_path, encoding="utf-8") as fh:
                        data = _json.load(fh)
                    if data.get("stage") != "done":
                        continue
                    html_path = data.get("outputs", {}).get("html", "")
                    if not html_path:
                        continue
                    candidates.append((data.get("updated_at", ""), data, entry.path))
                except Exception:
                    continue
            candidates.sort(key=lambda c: c[0], reverse=True)
            total = len(candidates)
            sessions = []
            effective_limit = len(candidates) if load_all else max(0, int(limit))
            for _ts, data, session_dir in candidates[:effective_limit]:
                html_path = data.get("outputs", {}).get("html", "")
                if html_path and not os.path.isfile(str(html_path)):
                    session_copy = os.path.join(
                        session_dir, os.path.basename(str(html_path))
                    )
                    if not os.path.isfile(session_copy):
                        continue
                    html_path = session_copy
                    try:
                        data["outputs"]["html"] = html_path
                        _atomic_write_json(
                            os.path.join(session_dir, "session.json"), data
                        )
                    except Exception:
                        pass
                input_path = self._find_candidate_audio_path(
                    data, session_dir, os.path.join(session_dir, "session.json")
                ) or data.get("input", {}).get("path", "")
                input_size = int(data.get("input", {}).get("size", 0) or 0)
                name = (
                    os.path.basename(input_path)
                    if input_path
                    else os.path.basename(str(html_path))
                )
                effective_model = data.get("settings", {}).get("effective_model", "")
                duration_sec = data.get("phase1", {}).get("duration_seconds")
                revision_failed_blocks = _normalize_revision_failed_blocks(
                    data.get("revision_failed_blocks", [])
                )
                raw_status = str(data.get("completion_status") or "")
                completion_status = (
                    "completed_with_warnings"
                    if raw_status == "completed_with_warnings" or revision_failed_blocks
                    else "completed"
                )
                last_opened_at_iso = data.get("last_opened_at", "")
                sessions.append(
                    {
                        "name": name,
                        "completed_at_iso": data.get("updated_at", ""),
                        "html_path": str(html_path),
                        "effective_model": effective_model,
                        "input_path": str(input_path),
                        "input_size": input_size,
                        "session_dir": str(session_dir),
                        "revision_failed_blocks": revision_failed_blocks,
                        "completion_status": completion_status,
                        **(
                            {"duration_sec": duration_sec}
                            if duration_sec is not None
                            else {}
                        ),
                        **(
                            {"last_opened_at_iso": str(last_opened_at_iso)}
                            if last_opened_at_iso
                            else {}
                        ),
                    }
                )
            result = {"ok": True, "sessions": sessions, "total": total}
            if not load_all:
                with self._sessions_cache_lock:
                    if self._sessions_cache_gen == gen_at_start:
                        self._sessions_cache = result
                        self._sessions_cache_ts = time.time()
            return {**result, "sessions": list(sessions)}
        except Exception as e:
            return {
                "ok": False,
                "error": redact_secrets(e),
                "sessions": [],
                "total": 0,
            }

    def delete_session(self, session_dir: str) -> dict:
        """Permanently delete a single session folder from disk."""
        try:
            session_root = self._get_session_root()
            abs_dir = os.path.realpath(session_dir)
            abs_root = os.path.realpath(session_root)
            if not _path_under_root(abs_dir, abs_root):
                return {"ok": False, "error": "Percorso non valido"}
            if not os.path.isdir(abs_dir):
                return {"ok": False, "error": "Cartella non trovata"}
            self._evict_deleted_session_caches(abs_dir)
            shutil.rmtree(abs_dir)
            with self._sessions_cache_lock:
                self._sessions_cache = None
                self._sessions_cache_gen += 1
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": redact_secrets(e)}

    def _invalidate_sessions_cache(self) -> None:
        with self._sessions_cache_lock:
            self._sessions_cache = None
            self._sessions_cache_gen += 1

    def _evict_deleted_session_caches(self, session_dir: str) -> None:
        abs_dir = os.path.realpath(session_dir)
        prefix = abs_dir + os.sep
        evict_html_paths_under(prefix)
        with self._resolved_cache_lock:
            resolved_to_evict = [
                key
                for key, value in self._resolved_path_cache.items()
                if value == abs_dir or str(value).startswith(prefix)
            ]
            for key in resolved_to_evict:
                del self._resolved_path_cache[key]
            shell_to_evict = [
                key for key in self._html_shell_cache if str(key).startswith(prefix)
            ]
            for key in shell_to_evict:
                del self._html_shell_cache[key]

    def update_session_input_path(self, session_dir: str, new_path: str) -> dict:
        """Persist a relinked audio path to session.json."""
        import json as _json

        try:
            session_root = self._get_session_root()
            abs_dir = os.path.realpath(session_dir)
            abs_root = os.path.realpath(session_root)
            if not _path_under_root(abs_dir, abs_root):
                return {"ok": False, "error": "Percorso non valido"}
            session_path = os.path.join(abs_dir, "session.json")
            if not os.path.isfile(session_path):
                return {"ok": False, "error": "session.json non trovato"}
            with open(session_path, encoding="utf-8") as fh:
                data = _json.load(fh)
            if not isinstance(data, dict):
                return {"ok": False, "error": "session.json non valido"}
            norm_path = str(new_path or "").strip()
            if not norm_path:
                return {"ok": False, "error": "Percorso vuoto"}
            if not isinstance(data.get("input"), dict):
                data["input"] = {}
            data["input"]["path"] = norm_path
            data["input"]["name"] = os.path.basename(norm_path)
            data["input"].pop("path_rel_to_session", None)
            data["input"].pop("path_rel_to_html", None)
            session_rel = _safe_relpath(os.path.realpath(norm_path), abs_dir)
            if session_rel:
                data["input"]["path_rel_to_session"] = session_rel
            html_path = str(data.get("outputs", {}).get("html", "") or "")
            if html_path:
                html_dir = os.path.dirname(os.path.realpath(html_path))
                html_rel = _safe_relpath(os.path.realpath(norm_path), html_dir)
                if html_rel:
                    data["input"]["path_rel_to_html"] = html_rel
            try:
                data["input"]["size"] = os.path.getsize(norm_path)
            except Exception:
                pass
            _atomic_write_json(session_path, data)
            with self._sessions_cache_lock:
                self._sessions_cache = None
                self._sessions_cache_gen += 1
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": redact_secrets(e)}

    def touch_session_opened(self, session_dir: str) -> dict:
        """Record the last opened ISO timestamp in session.json."""
        import json as _json
        from datetime import UTC, datetime

        try:
            session_root = self._get_session_root()
            abs_dir = os.path.realpath(session_dir)
            abs_root = os.path.realpath(session_root)
            if not _path_under_root(abs_dir, abs_root):
                return {"ok": False, "error": "Percorso non valido"}
            session_path = os.path.join(abs_dir, "session.json")
            if not os.path.isfile(session_path):
                return {"ok": False, "error": "session.json non trovato"}
            with open(session_path, encoding="utf-8") as fh:
                data = _json.load(fh)
            if not isinstance(data, dict):
                return {"ok": False, "error": "session.json non valido"}

            now_iso = datetime.now(UTC).isoformat()
            data["last_opened_at"] = now_iso

            _atomic_write_json(session_path, data)
            with self._sessions_cache_lock:
                self._sessions_cache = None
                self._sessions_cache_gen += 1
            return {"ok": True, "last_opened_at_iso": now_iso}
        except Exception as e:
            return {"ok": False, "error": redact_secrets(e)}

    def cleanup_old_sessions(
        self,
        max_age_days: int = 0,
        dry_run: bool = False,
    ) -> dict:
        """Delete incomplete session folders (defaults to all incomplete sessions, or older than max_age_days days)."""
        try:
            thread = getattr(self, "_processing_thread", None)
            if thread is not None and thread.is_alive():
                return {
                    "ok": False,
                    "error": "Impossibile eseguire la pulizia durante un'elaborazione in corso.",
                    "removed": 0,
                    "freed_bytes": 0,
                    "errors": 0,
                    "candidates": 0,
                    "preserved_completed": 0,
                    "missing_completed_html": 0,
                }
            with self._cleanup_lock:
                result = cleanup_orphan_sessions(
                    max(0, int(max_age_days)),
                    dry_run=bool(dry_run),
                )
                if result["removed"] > 0:
                    with self._sessions_cache_lock:
                        self._sessions_cache = None
                        self._sessions_cache_gen += 1
                return {
                    "ok": True,
                    "removed": result["removed"],
                    "freed_bytes": result["freed_bytes"],
                    "errors": result["errors"],
                    "candidates": result.get("candidates", result["removed"]),
                    "preserved_completed": result.get("preserved_completed", 0),
                    "missing_completed_html": result.get("missing_completed_html", 0),
                }
        except Exception as e:
            return {
                "ok": False,
                "error": redact_secrets(e),
                "removed": 0,
                "freed_bytes": 0,
                "errors": 0,
                "candidates": 0,
                "preserved_completed": 0,
                "missing_completed_html": 0,
            }

    def cleanup_completed_sessions(
        self,
        max_age_days: int = 14,
        dry_run: bool = True,
    ) -> dict:
        """Count or delete completed session folders older than max_age_days days."""
        try:
            thread = getattr(self, "_processing_thread", None)
            if thread is not None and thread.is_alive():
                return {
                    "ok": False,
                    "error": "Impossibile eseguire la pulizia durante un'elaborazione in corso.",
                    "removed": 0,
                    "freed_bytes": 0,
                    "errors": 0,
                    "candidates": 0,
                    "preserved_completed": 0,
                    "missing_completed_html": 0,
                }
            with self._cleanup_lock:
                result = cleanup_completed_sessions(
                    max(1, int(max_age_days)),
                    dry_run=bool(dry_run),
                )
                if result["removed"] > 0:
                    for deleted_dir in result.get("deleted_paths", []):
                        self._evict_deleted_session_caches(str(deleted_dir))
                    with self._sessions_cache_lock:
                        self._sessions_cache = None
                        self._sessions_cache_gen += 1
                    with self._text_cache_lock:
                        self._text_cache.clear()
                return {
                    "ok": True,
                    "removed": result["removed"],
                    "freed_bytes": result["freed_bytes"],
                    "errors": result["errors"],
                    "candidates": result.get("candidates", result["removed"]),
                    "preserved_completed": result.get("preserved_completed", 0),
                    "missing_completed_html": result.get("missing_completed_html", 0),
                }
        except Exception as e:
            return {
                "ok": False,
                "error": redact_secrets(e),
                "removed": 0,
                "freed_bytes": 0,
                "errors": 0,
                "candidates": 0,
                "preserved_completed": 0,
                "missing_completed_html": 0,
            }

    def open_session_folder(self) -> dict:
        """Open the session storage folder in the system file manager."""
        import subprocess
        import sys

        try:
            session_root = self._get_session_root()
            os.makedirs(session_root, exist_ok=True)
            real_root = os.path.realpath(session_root)
            if sys.platform == "win32":
                os.startfile(real_root)  # type: ignore[attr-defined]
            elif sys.platform == "darwin":
                subprocess.Popen(["open", real_root])
            else:
                subprocess.Popen(["xdg-open", real_root])
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": redact_secrets(e)}

    def search_sessions(self, query: str, limit: int = 10) -> dict:
        """Search plain-text content of every completed session HTML."""
        import json as _json

        from el_sbobinator.services.search_service import (
            extract_text_from_html,
            find_snippets,
        )

        query = str(query).strip()
        if len(query) < 3 or len(query) > 200:
            return {
                "ok": False,
                "error": "Query troppo corta o troppo lunga",
                "results": [],
            }

        session_root = self._get_session_root()
        if not os.path.isdir(session_root):
            return {"ok": True, "results": []}

        try:
            results = []
            for entry in os.scandir(session_root):
                if not entry.is_dir():
                    continue
                session_path = os.path.join(entry.path, "session.json")
                if not os.path.isfile(session_path):
                    continue
                try:
                    with open(session_path, encoding="utf-8") as fh:
                        data = _json.load(fh)
                    if data.get("stage") != "done":
                        continue
                    html_path = str(data.get("outputs", {}).get("html", ""))
                    if not html_path or not os.path.isfile(html_path):
                        continue

                    try:
                        mtime = os.path.getmtime(html_path)
                    except OSError:
                        continue
                    with self._text_cache_lock:
                        cached = self._text_cache.get(html_path)
                        if cached is not None and cached[0] == mtime:
                            self._text_cache.move_to_end(html_path)
                            text = cached[1]
                        else:
                            text = None
                    if text is None:
                        with open(html_path, encoding="utf-8", errors="replace") as fh:
                            raw_html = fh.read()
                        text = extract_text_from_html(raw_html)
                        with self._text_cache_lock:
                            self._text_cache[html_path] = (mtime, text)
                            if len(self._text_cache) > _TEXT_CACHE_MAX:
                                self._text_cache.popitem(last=False)

                    snippets, match_count = find_snippets(text, query)
                    if not snippets:
                        continue

                    input_path = data.get("input", {}).get("path", "")
                    name = (
                        os.path.basename(str(input_path))
                        if input_path
                        else os.path.basename(html_path)
                    )
                    results.append(
                        {
                            "session_dir": entry.path,
                            "name": name,
                            "html_path": html_path,
                            "completed_at_iso": data.get("updated_at", ""),
                            "snippets": snippets,
                            "match_count": match_count,
                        }
                    )
                except Exception:
                    continue

            results.sort(key=lambda r: r["match_count"], reverse=True)
            return {"ok": True, "results": results[: max(0, int(limit))]}
        except Exception as e:
            return {"ok": False, "error": redact_secrets(e), "results": []}

    def get_archive_folders(self) -> dict:
        """Return the user-defined archive folders with auto-reconciled session paths."""
        try:
            from el_sbobinator.services.folders_service import (
                get_folders as _get_archive_folders,
            )
            from el_sbobinator.services.folders_service import (
                reconcile_folders_with_session_root,
            )

            folders = _get_archive_folders()
            folders, _ = reconcile_folders_with_session_root(
                folders, self._get_session_root()
            )
            return {"ok": True, "folders": folders}
        except Exception as e:
            return {"ok": False, "error": redact_secrets(e), "folders": []}

    def save_archive_folders(self, folders: list) -> dict:
        """Persist the archive folder list to disk."""
        try:
            if not isinstance(folders, list):
                return {"ok": False, "error": "folders must be a list"}
            from el_sbobinator.services.folders_service import (
                save_folders as _save_archive_folders,
            )

            _save_archive_folders(folders)
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": redact_secrets(e)}
