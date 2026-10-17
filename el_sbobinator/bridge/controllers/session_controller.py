"""
Session management IPC bridge controller.
"""

from __future__ import annotations

import copy
import os
import shutil
import time
from typing import TYPE_CHECKING

from el_sbobinator.bridge.bridge_utils import (
    _path_under_root,
    _safe_relpath,
    bridge_error,
    bridge_ok,
)
from el_sbobinator.core.shared import (
    _atomic_write_json,
    cleanup_completed_sessions,
    cleanup_orphan_sessions,
    get_session_root,
    get_session_storage_info,
)
from el_sbobinator.services.archive_service import (
    list_completed_sessions,
    search_completed_sessions,
)
from el_sbobinator.services.session_audio_service import (
    attach_playback_audio,
    create_playback_audio,
    discard_playback_audio,
    discard_unlinked_playback_audio,
    managed_audio_path,
    playback_audio_path,
    session_audio_lock,
    session_metadata_lock,
)
from el_sbobinator.utils.file_ops import evict_html_paths_under

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
            return bridge_ok(
                total_bytes=info["total_bytes"],
                total_sessions=info["total_sessions"],
                session_root=get_session_root(),
            )
        except Exception as e:
            return bridge_error(
                e,
                total_bytes=0,
                total_sessions=0,
                session_root="",
            )

    def get_completed_sessions(self, limit: int = 0) -> dict:
        """Return the most recent completed sessions for the archive UI."""
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
        try:
            sessions, total = list_completed_sessions(
                session_root,
                limit=limit,
                find_audio_path_fn=getattr(self, "_find_candidate_audio_path", None),
            )
            result = bridge_ok(sessions=sessions, total=total)
            if not load_all:
                with self._sessions_cache_lock:
                    if self._sessions_cache_gen == gen_at_start:
                        self._sessions_cache = result
                        self._sessions_cache_ts = time.time()
            return {**result, "sessions": list(sessions)}
        except Exception as e:
            return bridge_error(e, sessions=[], total=0)

    def delete_session(self, session_dir: str) -> dict:
        """Permanently delete a single session folder from disk."""
        try:
            clean_dir = str(session_dir or "").strip()
            if not clean_dir:
                return bridge_error("Percorso non valido")
            session_root = self._get_session_root()
            abs_dir = os.path.realpath(clean_dir)
            abs_root = os.path.realpath(session_root)
            if not _path_under_root(abs_dir, abs_root):
                return bridge_error("Percorso non valido")
            if os.path.normcase(abs_dir) == os.path.normcase(abs_root):
                return bridge_error(
                    "Impossibile eliminare la cartella principale delle sessioni."
                )
            if not os.path.isdir(abs_dir):
                return bridge_error("Cartella non trovata")
            with session_audio_lock(abs_dir):
                self._evict_deleted_session_caches(abs_dir)
                shutil.rmtree(abs_dir)
            with self._sessions_cache_lock:
                self._sessions_cache = None
                self._sessions_cache_gen += 1
            return bridge_ok()
        except Exception as e:
            return bridge_error(e)

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

    def rename_session(self, session_dir: str, name: str) -> dict:
        """Change the display title without moving files or changing completion time."""
        import json

        try:
            if not isinstance(name, str):
                return bridge_error("Nome non valido")
            title = name.strip()
            if not title or len(title) > 200 or any(ord(c) < 32 for c in title):
                return bridge_error(
                    "Inserisci un nome da 1 a 200 caratteri, su una sola riga."
                )
            abs_dir = os.path.realpath(session_dir)
            abs_root = os.path.realpath(self._get_session_root())
            if abs_dir == abs_root or not _path_under_root(abs_dir, abs_root):
                return bridge_error("Percorso non valido")
            session_path = os.path.join(abs_dir, "session.json")
            if os.path.islink(session_path):
                return bridge_error("Percorso non valido")
            with session_metadata_lock(abs_dir):
                with open(session_path, encoding="utf-8") as handle:
                    data = json.load(handle)
                if not isinstance(data, dict) or data.get("stage") != "done":
                    return bridge_error("Puoi rinominare solo sbobine completate.")
                data["title"] = title
                data["title_is_custom"] = True
                _atomic_write_json(session_path, data)
            with self._sessions_cache_lock:
                self._sessions_cache = None
                self._sessions_cache_gen += 1
            return bridge_ok(name=title)
        except Exception as e:
            return bridge_error(e)

    def update_session_input_path(self, session_dir: str, new_path: str) -> dict:
        """Persist a relinked audio path to session.json."""
        import json as _json

        try:
            session_root = self._get_session_root()
            abs_dir = os.path.realpath(session_dir)
            abs_root = os.path.realpath(session_root)
            if not _path_under_root(abs_dir, abs_root):
                return bridge_error("Percorso non valido")
            session_path = os.path.join(abs_dir, "session.json")
            if not os.path.isfile(session_path):
                return bridge_error("session.json non trovato")
            with session_audio_lock(abs_dir):
                with open(session_path, encoding="utf-8") as fh:
                    data = _json.load(fh)
                if not isinstance(data, dict):
                    return bridge_error("session.json non valido")
                norm_path = str(new_path or "").strip()
                if not norm_path:
                    return bridge_error("Percorso vuoto")

                old_audio = playback_audio_path(data, abs_dir)
                created = create_playback_audio(
                    abs_dir,
                    norm_path,
                    stop_event=getattr(self, "_audio_cancel_event", None),
                )
                try:
                    with session_metadata_lock(abs_dir):
                        # Preserve metadata changed while FFmpeg was preparing the copy.
                        with open(session_path, encoding="utf-8") as fh:
                            data = _json.load(fh)

                        # Determine original document title from html_path or previous title
                        html_path = str(data.get("outputs", {}).get("html", "") or "")
                        html_title = ""
                        if html_path:
                            base = os.path.basename(html_path)
                            if base.endswith("_Sbobina.html"):
                                html_title = base[: -len("_Sbobina.html")]
                            elif base.endswith(".html"):
                                html_title = base[: -len(".html")]
                            else:
                                html_title = base

                        current_title = str(data.get("title") or "").strip()
                        current_input_name = ""
                        if isinstance(data.get("input"), dict):
                            current_input_name = str(
                                data["input"].get("name") or ""
                            ).strip()

                        if (
                            not data.get("title_is_custom")
                            and html_title
                            and (
                                not current_title or current_title == current_input_name
                            )
                        ):
                            data["title"] = html_title
                        elif not data.get("title_is_custom") and not current_title:
                            data["title"] = current_input_name or html_title

                        if not isinstance(data.get("input"), dict):
                            data["input"] = {}
                        data["input"]["path"] = norm_path
                        data["input"]["name"] = os.path.basename(norm_path)
                        data["input"].pop("path_rel_to_session", None)
                        data["input"].pop("path_rel_to_html", None)
                        session_rel = _safe_relpath(
                            os.path.realpath(norm_path), abs_dir
                        )
                        if session_rel:
                            data["input"]["path_rel_to_session"] = session_rel
                        html_path = str(data.get("outputs", {}).get("html", "") or "")
                        if html_path:
                            html_dir = os.path.dirname(os.path.realpath(html_path))
                            html_rel = _safe_relpath(
                                os.path.realpath(norm_path), html_dir
                            )
                            if html_rel:
                                data["input"]["path_rel_to_html"] = html_rel
                        try:
                            data["input"]["size"] = os.path.getsize(norm_path)
                        except Exception:
                            pass
                        data.pop("audio_removed", None)
                        attach_playback_audio(data, abs_dir, created)
                        _atomic_write_json(session_path, data)
                except Exception:
                    discard_playback_audio(created)
                    raise
                try:
                    discard_playback_audio(old_audio)
                except OSError:
                    # The new association is already durable; an old active stream
                    # must not make the relink appear to have failed. A later
                    # open retries the deletion.
                    pass
                discard_unlinked_playback_audio(abs_dir, keep=created)
                with self._sessions_cache_lock:
                    self._sessions_cache = None
                    self._sessions_cache_gen += 1
                return bridge_ok()
        except Exception as e:
            return bridge_error(e)

    def remove_session_audio(self, session_dir: str) -> dict:
        """Unlink and remove the associated audio from session.json."""
        import json as _json

        try:
            session_root = self._get_session_root()
            abs_dir = os.path.realpath(session_dir)
            abs_root = os.path.realpath(session_root)
            if not _path_under_root(abs_dir, abs_root):
                return bridge_error("Percorso non valido")
            session_path = os.path.join(abs_dir, "session.json")
            if not os.path.isfile(session_path):
                return bridge_error("session.json non trovato")
            with session_audio_lock(abs_dir), session_metadata_lock(abs_dir):
                with open(session_path, encoding="utf-8") as fh:
                    data = _json.load(fh)
                if not isinstance(data, dict):
                    return bridge_error("session.json non valido")

                previous = copy.deepcopy(data)
                old_audio = managed_audio_path(abs_dir, data.get("playback_audio"))

                # Determine original document title from html_path or previous title
                html_path = str(data.get("outputs", {}).get("html", "") or "")
                html_title = ""
                if html_path:
                    base = os.path.basename(html_path)
                    if base.endswith("_Sbobina.html"):
                        html_title = base[: -len("_Sbobina.html")]
                    elif base.endswith(".html"):
                        html_title = base[: -len(".html")]
                    else:
                        html_title = base

                current_title = str(data.get("title") or "").strip()
                current_input_name = ""
                if isinstance(data.get("input"), dict):
                    current_input_name = str(data["input"].get("name") or "").strip()

                # If current title was empty or identical to the audio name being removed, restore html_title
                if (
                    not data.get("title_is_custom")
                    and html_title
                    and (not current_title or current_title == current_input_name)
                ):
                    data["title"] = html_title
                elif not data.get("title_is_custom") and not current_title:
                    data["title"] = current_input_name or html_title

                if not isinstance(data.get("input"), dict):
                    data["input"] = {}
                data["input"]["path"] = ""
                data["input"]["name"] = ""
                data["input"].pop("path_rel_to_session", None)
                data["input"].pop("path_rel_to_html", None)
                data["input"]["size"] = 0
                data.pop("playback_audio", None)
                data["audio_removed"] = True

                _atomic_write_json(session_path, data)
                try:
                    discard_playback_audio(old_audio)
                except OSError:
                    _atomic_write_json(session_path, previous)
                    raise
                with self._sessions_cache_lock:
                    self._sessions_cache = None
                    self._sessions_cache_gen += 1
                return bridge_ok(name=data.get("title", ""))
        except Exception as e:
            return bridge_error(e)

    def touch_session_opened(self, session_dir: str) -> dict:
        """Record the last opened ISO timestamp in session.json."""
        import json as _json
        from datetime import UTC, datetime

        try:
            session_root = self._get_session_root()
            abs_dir = os.path.realpath(session_dir)
            abs_root = os.path.realpath(session_root)
            if not _path_under_root(abs_dir, abs_root):
                return bridge_error("Percorso non valido")
            session_path = os.path.join(abs_dir, "session.json")
            if not os.path.isfile(session_path):
                return bridge_error("session.json non trovato")
            with session_metadata_lock(abs_dir):
                with open(session_path, encoding="utf-8") as fh:
                    data = _json.load(fh)
                if not isinstance(data, dict):
                    return bridge_error("session.json non valido")

                now_iso = datetime.now(UTC).isoformat()
                data["last_opened_at"] = now_iso

                _atomic_write_json(session_path, data)
                with self._sessions_cache_lock:
                    self._sessions_cache = None
                    self._sessions_cache_gen += 1
                return bridge_ok(last_opened_at_iso=now_iso)
        except Exception as e:
            return bridge_error(e)

    def cleanup_old_sessions(
        self,
        max_age_days: int = 0,
        dry_run: bool = False,
    ) -> dict:
        """Delete incomplete session folders (defaults to all incomplete sessions, or older than max_age_days days)."""
        try:
            thread = getattr(self, "_processing_thread", None)
            if thread is not None and thread.is_alive():
                return bridge_error(
                    "Impossibile eseguire la pulizia durante un'elaborazione in corso.",
                    removed=0,
                    freed_bytes=0,
                    errors=0,
                    candidates=0,
                    preserved_completed=0,
                    missing_completed_html=0,
                )
            with self._cleanup_lock:
                result = cleanup_orphan_sessions(
                    max(0, int(max_age_days)),
                    dry_run=bool(dry_run),
                )
                if result["removed"] > 0:
                    with self._sessions_cache_lock:
                        self._sessions_cache = None
                        self._sessions_cache_gen += 1
                return bridge_ok(
                    removed=result["removed"],
                    freed_bytes=result["freed_bytes"],
                    errors=result["errors"],
                    candidates=result.get("candidates", result["removed"]),
                    preserved_completed=result.get("preserved_completed", 0),
                    missing_completed_html=result.get("missing_completed_html", 0),
                )
        except Exception as e:
            return bridge_error(
                e,
                removed=0,
                freed_bytes=0,
                errors=0,
                candidates=0,
                preserved_completed=0,
                missing_completed_html=0,
            )

    def cleanup_completed_sessions(
        self,
        max_age_days: int = 14,
        dry_run: bool = True,
    ) -> dict:
        """Count or delete completed session folders older than max_age_days days."""
        try:
            thread = getattr(self, "_processing_thread", None)
            if thread is not None and thread.is_alive():
                return bridge_error(
                    "Impossibile eseguire la pulizia durante un'elaborazione in corso.",
                    removed=0,
                    freed_bytes=0,
                    errors=0,
                    candidates=0,
                    preserved_completed=0,
                    missing_completed_html=0,
                )
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
                return bridge_ok(
                    removed=result["removed"],
                    freed_bytes=result["freed_bytes"],
                    errors=result["errors"],
                    candidates=result.get("candidates", result["removed"]),
                    preserved_completed=result.get("preserved_completed", 0),
                    missing_completed_html=result.get("missing_completed_html", 0),
                )
        except Exception as e:
            return bridge_error(
                e,
                removed=0,
                freed_bytes=0,
                errors=0,
                candidates=0,
                preserved_completed=0,
                missing_completed_html=0,
            )

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
            return bridge_ok()
        except Exception as e:
            return bridge_error(e)

    def search_sessions(self, query: str, limit: int = 100) -> dict:
        """Search plain-text content of every completed session HTML."""
        query = str(query).strip()
        if len(query) < 3 or len(query) > 200:
            return bridge_error(
                "Query troppo corta o troppo lunga", results=[], total=0
            )

        session_root = self._get_session_root()
        try:
            results, total_matches = search_completed_sessions(
                session_root=session_root,
                query=query,
                limit=limit,
                text_cache=getattr(self, "_text_cache", None),
                text_cache_lock=getattr(self, "_text_cache_lock", None),
                text_cache_max=_TEXT_CACHE_MAX,
            )
            return bridge_ok(results=results, total=total_matches)
        except Exception as e:
            return bridge_error(e, results=[], total=0)

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
            return bridge_ok(folders=folders)
        except Exception as e:
            return bridge_error(e, folders=[])

    def save_archive_folders(self, folders: list) -> dict:
        """Persist the archive folder list to disk."""
        try:
            if not isinstance(folders, list):
                return bridge_error("folders must be a list")
            from el_sbobinator.services.folders_service import (
                save_folders as _save_archive_folders,
            )

            _save_archive_folders(folders)
            return bridge_ok()
        except Exception as e:
            return bridge_error(e)
