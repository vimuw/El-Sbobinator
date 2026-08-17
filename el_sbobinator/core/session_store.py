"""
Session and autosave helpers for El Sbobinator.

The pipeline still owns the orchestration, but session persistence, root directory
management, file fingerprinting, storage calculation, and cleanup live here.
"""

from __future__ import annotations

import concurrent.futures
import copy
import hashlib
import json
import os
import platform
import shutil
import sys
import tempfile
import threading
import time
from dataclasses import dataclass
from datetime import datetime

from el_sbobinator.pipeline.pipeline_settings import build_default_pipeline_settings
from el_sbobinator.services.config_service import USER_HOME
from el_sbobinator.utils.file_ops import (
    _atomic_write_json,
    _atomic_write_text,
    _fsync_dir,
    _load_json,
    _safe_mkdir,
)

SESSION_CLEANUP_MAX_AGE_DAYS = 14
PRECONVERTED_AUDIO_FINAL = "el_sbobinator_preconverted_mono16k.mp3"
PRECONVERTED_AUDIO_PARTIAL = "el_sbobinator_preconverted_mono16k.partial.mp3"
SESSION_SCHEMA_VERSION = 1

_LEGACY_SESSION_ROOT = os.path.join(USER_HOME, ".el_sbobinator_sessions")
_DEFAULT_LEGACY_SESSION_ROOT = _LEGACY_SESSION_ROOT


def _get_default_session_root(user_home: str) -> str:
    """
    Return the default session-storage root for the current platform.
    - Windows: %LOCALAPPDATA%\\El Sbobinator\\sessions  (not synced by OneDrive)
    - macOS:   ~/Library/Caches/El Sbobinator/sessions   (excluded from iCloud)
    - Linux:   ~/.el_sbobinator_sessions                  (unchanged)
    """
    system = None
    if "el_sbobinator.core.shared" in sys.modules:
        shared_mod = sys.modules["el_sbobinator.core.shared"]
        if hasattr(shared_mod, "platform") and hasattr(shared_mod.platform, "system"):
            try:
                system = shared_mod.platform.system()
            except Exception:
                pass
    if system is None:
        system = platform.system()
    if system == "Windows":
        local_app_data = os.environ.get("LOCALAPPDATA") or os.path.join(
            user_home, "AppData", "Local"
        )
        return os.path.join(local_app_data, "El Sbobinator", "sessions")
    if system == "Darwin":
        return os.path.join(user_home, "Library", "Caches", "El Sbobinator", "sessions")
    return os.path.join(user_home, ".el_sbobinator_sessions")


SESSION_ROOT = _get_default_session_root(USER_HOME)
_last_set_session_root = SESSION_ROOT
_last_set_legacy_session_root = _LEGACY_SESSION_ROOT


def get_session_root() -> str:
    """Return the current session-storage root directory (may be overridden at runtime)."""
    global _last_set_session_root
    if "el_sbobinator.core.shared" in sys.modules:
        shared_mod = sys.modules["el_sbobinator.core.shared"]
        shared_root = getattr(shared_mod, "SESSION_ROOT", None)
        if shared_root is not None and shared_root != _last_set_session_root:
            return shared_root
    if SESSION_ROOT != _last_set_session_root:
        return SESSION_ROOT
    return SESSION_ROOT


def set_session_root(path: str) -> None:
    """Override the session-storage root directory at runtime."""
    global SESSION_ROOT, _last_set_session_root
    SESSION_ROOT = str(path)
    _last_set_session_root = SESSION_ROOT
    if "el_sbobinator.core.shared" in sys.modules:
        try:
            setattr(sys.modules["el_sbobinator.core.shared"], "SESSION_ROOT", str(path))  # noqa: B010
        except Exception:
            pass


def migrate_legacy_session_root() -> bool:
    """
    On first launch after an upgrade, move ~/.el_sbobinator_sessions to the new
    platform-appropriate default (LOCALAPPDATA on Windows, Library/Caches on macOS).
    No-op if the legacy path is absent, new default already exists, or both paths
    are identical (Linux). Returns True if migration was performed.
    """
    new_root = get_session_root()
    old_root = _LEGACY_SESSION_ROOT
    if "el_sbobinator.core.shared" in sys.modules:
        shared_mod = sys.modules["el_sbobinator.core.shared"]
        shared_legacy = getattr(shared_mod, "_LEGACY_SESSION_ROOT", None)
        if shared_legacy is not None and shared_legacy != _last_set_legacy_session_root:
            old_root = shared_legacy
    if (
        old_root == _last_set_legacy_session_root
        and _LEGACY_SESSION_ROOT != _last_set_legacy_session_root
    ):
        old_root = _LEGACY_SESSION_ROOT
    if os.path.normcase(os.path.normpath(new_root)) == os.path.normcase(
        os.path.normpath(old_root)
    ):
        return False  # Linux: paths are identical, nothing to do
    if not os.path.isdir(old_root):
        return False  # No legacy sessions to migrate
    if os.path.isdir(new_root):
        return False  # New location already exists; previous migration done
    try:
        os.makedirs(os.path.dirname(new_root), exist_ok=True)
        shutil.move(old_root, new_root)
        return True
    except Exception:
        return False


def _now_iso() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _file_fingerprint(path: str) -> dict:
    abs_path = os.path.abspath(path)
    st = os.stat(abs_path)
    return {
        "path": abs_path,
        "size": int(getattr(st, "st_size", 0)),
        "mtime": float(getattr(st, "st_mtime", 0.0)),
    }


def _partial_file_hash(path: str, max_bytes: int = 1048576) -> str:
    """
    Calcola SHA256 dei primi max_bytes del file.
    Usato per identificare file identici indipendentemente dal path.
    Leggere solo il primo 1 MB è veloce anche per file multi-gigabyte e riduce
    le collisioni su lezioni molto lunghe rispetto ai precedenti 64 KB.
    """
    try:
        hasher = hashlib.sha256()
        with open(path, "rb") as f:
            chunk = f.read(max_bytes)
            hasher.update(chunk)
        return hasher.hexdigest()
    except Exception:
        return ""


def _file_tail_hash(path: str, max_bytes: int = 1048576, file_size: int = -1) -> str:
    """
    Calcola SHA256 degli ultimi max_bytes del file.
    Complementa _partial_file_hash per distinguere file con stesso inizio ma
    diversa fine (es. lezioni dello stesso corso con intro identica).
    Per file più piccoli di max_bytes torna l'hash dell'intero file.
    """
    try:
        size = file_size if file_size >= 0 else os.path.getsize(path)
        offset = max(0, size - max_bytes)
        hasher = hashlib.sha256()
        with open(path, "rb") as f:
            if offset > 0:
                f.seek(offset)
            chunk = f.read(max_bytes)
            hasher.update(chunk)
        return hasher.hexdigest()
    except Exception:
        return ""


_session_id_cache: dict[tuple, str] = {}
_MAX_SESSION_CACHE_SIZE = 500  # LRU cap: at ~200 bytes per entry this stays well under 100 KB; prevents unbounded growth in long-running processes


def _session_id_for_file(path: str) -> str:
    """
    Genera ID sessione basato su size, head hash e tail hash.
    Il tail hash distingue file con intro identica ma contenuto diverso.
    mtime_ns partecipa solo alla cache process-local, non all'ID durevole.
    """
    abs_path = os.path.abspath(path)
    st = os.stat(abs_path)
    size = int(getattr(st, "st_size", 0))
    mtime_ns = int(getattr(st, "st_mtime_ns", 0)) or int(st.st_mtime * 1_000_000_000)

    cache_key = (abs_path, size, mtime_ns)
    _cached = _session_id_cache.get(cache_key)
    if _cached is not None:
        return _cached

    # LRU eviction: remove oldest entry if at capacity
    if len(_session_id_cache) >= _MAX_SESSION_CACHE_SIZE:
        _session_id_cache.pop(next(iter(_session_id_cache)))

    head_hash = _partial_file_hash(abs_path)
    tail_hash = (
        head_hash if size <= 1048576 else _file_tail_hash(abs_path, file_size=size)
    )
    blob = json.dumps(
        {
            "size": size,
            "head_hash": head_hash,
            "tail_hash": tail_hash,
        },
        sort_keys=True,
    ).encode("utf-8", errors="ignore")
    result = hashlib.sha256(blob).hexdigest()
    _session_id_cache[cache_key] = result
    return result


def _session_dir_for_file(path: str) -> str:
    return os.path.join(get_session_root(), _session_id_for_file(path))


# ==========================================
# STORAGE CALCULATION
# ==========================================
_storage_info_cache: dict | None = None
_storage_info_cache_time: float = 0.0
_storage_info_future: concurrent.futures.Future[dict] | None = None
_STORAGE_INFO_TTL: float = 30.0
_storage_info_lock = threading.Lock()
_storage_info_executor = concurrent.futures.ThreadPoolExecutor(
    max_workers=1, thread_name_prefix="storage_info"
)


def _folder_size(path: str) -> int:
    """Recursively compute folder size in bytes. Best-effort: skips unreadable files."""
    total = 0
    try:
        for dirpath, _, filenames in os.walk(path):
            for fname in filenames:
                if fname == PRECONVERTED_AUDIO_PARTIAL:
                    continue
                try:
                    total += os.path.getsize(os.path.join(dirpath, fname))
                except Exception:
                    pass
    except Exception:
        pass
    return total


def _folder_newest_mtime(path: str) -> float:
    """
    Return the newest mtime of any file inside the folder (recursive).
    Falls back to the directory mtime itself if no files found.
    Cross-platform: on Windows, directory mtime is NOT updated when files inside
    change, so scanning file mtimes is necessary for correctness.
    """
    newest = 0.0
    try:
        for dirpath, _, filenames in os.walk(path):
            for fname in filenames:
                try:
                    mtime = os.path.getmtime(os.path.join(dirpath, fname))
                    if mtime > newest:
                        newest = mtime
                except Exception:
                    pass
        if newest == 0.0:
            try:
                newest = os.path.getmtime(path)
            except Exception:
                pass
    except Exception:
        pass
    return newest


def _compute_session_storage_info() -> dict:
    """
    Blocking FS traversal - call via get_session_storage_info() which caches
    the result and offloads the work to a background thread.
    """
    total_bytes = 0
    total_sessions = 0
    root = get_session_root()
    try:
        if not os.path.isdir(root):
            return {"total_bytes": 0, "total_sessions": 0}
        for name in os.listdir(root):
            session_dir = os.path.join(root, name)
            if not os.path.isdir(session_dir):
                continue
            total_sessions += 1
            total_bytes += _folder_size(session_dir)
    except Exception:
        pass
    return {"total_bytes": total_bytes, "total_sessions": total_sessions}


def get_session_storage_info() -> dict:
    """
    Return total size in bytes and count of session folders in SESSION_ROOT.
    Result is cached for _STORAGE_INFO_TTL seconds.  The FS traversal runs in
    a dedicated single-worker thread so the caller is never blocked for longer
    than the OS I/O takes (bounded by a 10-second timeout).
    """
    global _storage_info_cache, _storage_info_cache_time, _storage_info_future
    now = time.time()
    with _storage_info_lock:
        if (
            _storage_info_cache is not None
            and (now - _storage_info_cache_time) < _STORAGE_INFO_TTL
        ):
            return dict(_storage_info_cache)
        compute_fn = _compute_session_storage_info
        if "el_sbobinator.core.shared" in sys.modules:
            shared_mod = sys.modules["el_sbobinator.core.shared"]
            if hasattr(shared_mod, "_compute_session_storage_info"):
                if (
                    shared_mod._compute_session_storage_info
                    is not _compute_session_storage_info
                ):
                    compute_fn = shared_mod._compute_session_storage_info
        if _storage_info_future is None or _storage_info_future.done():
            _storage_info_future = _storage_info_executor.submit(compute_fn)
        future = _storage_info_future
    try:
        result = future.result(timeout=10.0)
    except Exception:
        result = {"total_bytes": 0, "total_sessions": 0}
    with _storage_info_lock:
        _storage_info_cache = result
        _storage_info_cache_time = time.time()
    return dict(result)


def invalidate_session_storage_cache() -> None:
    """Bust the get_session_storage_info cache (call after deleting sessions)."""
    global _storage_info_cache, _storage_info_cache_time, _storage_info_future
    with _storage_info_lock:
        _storage_info_cache = None
        _storage_info_cache_time = 0.0
        _storage_info_future = None


# ==========================================
# ORPHAN CLEANUP
# ==========================================
_TEMP_CHUNK_AUDIO_EXTS = (".mp3", ".wav", ".m4a")


def _is_old_enough(path: str, now: float, max_age_seconds: int) -> bool:
    try:
        age = now - float(os.path.getmtime(path))
        return age >= max(0, int(max_age_seconds))
    except Exception:
        return False


def _cleanup_legacy_temp_chunks(tmpdir: str, now: float, max_age_seconds: int) -> int:
    removed = 0
    try:
        for name in os.listdir(tmpdir):
            low = name.lower()
            if not low.startswith("el_sbobinator_temp_"):
                continue
            if not low.endswith(_TEMP_CHUNK_AUDIO_EXTS):
                continue
            path = os.path.join(tmpdir, name)
            try:
                if not _is_old_enough(path, now, max_age_seconds):
                    continue
                os.remove(path)
                removed += 1
            except Exception:
                pass
    except Exception:
        pass
    return removed


def _cleanup_session_temp_chunks(now: float, max_age_seconds: int) -> int:
    removed = 0
    try:
        session_root = get_session_root()
        with os.scandir(session_root) as sessions:
            for session_entry in sessions:
                try:
                    if not session_entry.is_dir():
                        continue
                    temp_chunks_dir = os.path.join(session_entry.path, "temp_chunks")
                    if not os.path.isdir(temp_chunks_dir):
                        continue
                    with os.scandir(temp_chunks_dir) as run_dirs:
                        for run_entry in run_dirs:
                            try:
                                name = run_entry.name.lower()
                                if (
                                    not name.startswith("run_")
                                    or not run_entry.is_dir()
                                ):
                                    continue
                                run_dir_old = _is_old_enough(
                                    run_entry.path,
                                    now,
                                    max_age_seconds,
                                )
                                removed_in_run = 0
                                with os.scandir(run_entry.path) as chunk_files:
                                    for chunk_entry in chunk_files:
                                        try:
                                            chunk_name = chunk_entry.name.lower()
                                            if not chunk_entry.is_file():
                                                continue
                                            if not chunk_name.startswith("chunk_"):
                                                continue
                                            if not chunk_name.endswith(
                                                _TEMP_CHUNK_AUDIO_EXTS
                                            ):
                                                continue
                                            if not _is_old_enough(
                                                chunk_entry.path,
                                                now,
                                                max_age_seconds,
                                            ):
                                                continue
                                            os.remove(chunk_entry.path)
                                            removed += 1
                                            removed_in_run += 1
                                        except Exception:
                                            pass
                                if run_dir_old or removed_in_run > 0:
                                    try:
                                        os.rmdir(run_entry.path)
                                    except Exception:
                                        pass
                            except Exception:
                                pass
                except Exception:
                    pass
    except Exception:
        pass
    return removed


def cleanup_orphan_temp_chunks(max_age_seconds: int = 12 * 3600) -> int:
    """
    Best-effort cleanup of temp chunk files left behind by crashes/forced closes.
    """
    now = time.time()
    removed = _cleanup_legacy_temp_chunks(tempfile.gettempdir(), now, max_age_seconds)
    removed += _cleanup_session_temp_chunks(now, max_age_seconds)

    # Clean up orphaned Inno Setup executables from system Temp directory
    try:
        tmpdir = tempfile.gettempdir()
        for name in os.listdir(tmpdir):
            if name.startswith("El-Sbobinator-Setup-") and name.endswith(".exe"):
                path = os.path.join(tmpdir, name)
                if _is_old_enough(path, now, max_age_seconds):
                    try:
                        os.remove(path)
                        removed += 1
                    except Exception:
                        pass
    except Exception:
        pass

    return removed


def _resolve_session_html_path(session_dir: str, html_path: object) -> str:
    value = str(html_path or "").strip()
    if not value:
        return ""
    if os.path.isabs(value):
        return value
    return os.path.join(session_dir, value)


def _session_completed_html_exists(session_dir: str, session: dict) -> bool:
    outputs = session.get("outputs", {})
    html_path = str(outputs.get("html", "") if isinstance(outputs, dict) else "")
    resolved = _resolve_session_html_path(session_dir, html_path)
    if resolved and os.path.isfile(resolved):
        return True
    if html_path:
        fallback = os.path.join(session_dir, os.path.basename(html_path))
        if os.path.isfile(fallback):
            return True
    return False


def _session_cleanup_kind(session_dir: str) -> str:
    session_path = os.path.join(session_dir, "session.json")
    try:
        session = _load_json(session_path)
    except Exception:
        return "incomplete"
    if not isinstance(session, dict):
        return "incomplete"
    if str(session.get("stage", "")).strip().lower() != "done":
        return "incomplete"
    if _session_completed_html_exists(session_dir, session):
        return "completed"
    return "completed_missing_html"


def cleanup_orphan_sessions(
    max_age_days: int = SESSION_CLEANUP_MAX_AGE_DAYS,
    *,
    mode: str = "incomplete",
    dry_run: bool = False,
) -> dict:
    """
    Delete selected session folders in SESSION_ROOT whose newest file mtime is older
    than max_age_days days.  Returns a summary dict with keys:
      removed     - number of folders successfully deleted
      freed_bytes - total bytes freed
      errors      - number of folders that could not be deleted
    Best-effort: individual folder errors do not abort the whole sweep.
    """
    removed = 0
    freed_bytes = 0
    errors = 0
    candidates = 0
    preserved_completed = 0
    missing_completed_html = 0
    deleted_paths: list[str] = []
    mode = str(mode or "incomplete").strip().lower()
    if mode not in {"incomplete", "completed"}:
        raise ValueError("cleanup mode non valida")
    session_root = get_session_root()
    try:
        if not os.path.isdir(session_root):
            return {
                "removed": 0,
                "freed_bytes": 0,
                "errors": 0,
                "candidates": 0,
                "preserved_completed": 0,
                "missing_completed_html": 0,
                "deleted_paths": [],
            }
        now = time.time()
        cutoff = now - max(1, int(max_age_days)) * 86400
        for name in os.listdir(session_root):
            session_dir = os.path.join(session_root, name)
            if not os.path.isdir(session_dir):
                continue
            try:
                newest_mtime = _folder_newest_mtime(session_dir)
                if newest_mtime >= cutoff:
                    continue
                kind = _session_cleanup_kind(session_dir)
                if kind == "completed":
                    if mode == "incomplete":
                        preserved_completed += 1
                        continue
                elif kind == "completed_missing_html":
                    missing_completed_html += 1
                    if mode == "completed":
                        continue
                elif mode == "completed":
                    continue
                candidates += 1
                size = _folder_size(session_dir)
                if dry_run:
                    freed_bytes += size
                    continue
                shutil.rmtree(session_dir)
                removed += 1
                freed_bytes += size
                deleted_paths.append(session_dir)
            except Exception:
                errors += 1
    except Exception:
        pass
    if removed > 0 and not dry_run:
        invalidate_session_storage_cache()
    return {
        "removed": removed,
        "freed_bytes": freed_bytes,
        "errors": errors,
        "candidates": candidates,
        "preserved_completed": preserved_completed,
        "missing_completed_html": missing_completed_html,
        "deleted_paths": deleted_paths,
    }


def cleanup_completed_sessions(
    max_age_days: int = SESSION_CLEANUP_MAX_AGE_DAYS, *, dry_run: bool = False
) -> dict:
    return cleanup_orphan_sessions(
        max_age_days,
        mode="completed",
        dry_run=dry_run,
    )


class SessionCollisionError(Exception):
    """Raised when initialize_session_context would silently destroy a completed session.

    Occurs when resume_session=False and the computed session directory already
    contains a finished sbobina (stage=='done' + existing HTML output).  This
    protects against the fingerprint-collision scenario where two different
    recordings resolve to the same session ID and the newer file would wipe the
    older completed work without any user confirmation.
    """

    def __init__(self, session_dir: str) -> None:
        self.session_dir = session_dir
        super().__init__("session_collision")


@dataclass(frozen=True)
class SessionPaths:
    session_dir: str
    session_path: str
    phase1_chunks_dir: str
    phase2_revised_dir: str
    macro_path: str


def resolve_session_paths(
    input_path: str, session_dir_hint: str | None = None
) -> SessionPaths:
    try:
        _safe_mkdir(get_session_root())
    except Exception:
        pass

    try:
        session_dir = (
            os.path.abspath(session_dir_hint)
            if session_dir_hint
            else _session_dir_for_file(input_path)
        )
    except Exception:
        session_dir = os.path.join(
            tempfile.gettempdir(), "el_sbobinator_session_fallback"
        )

    return SessionPaths(
        session_dir=session_dir,
        session_path=os.path.join(session_dir, "session.json"),
        phase1_chunks_dir=os.path.join(session_dir, "phase1_chunks"),
        phase2_revised_dir=os.path.join(session_dir, "phase2_revised"),
        macro_path=os.path.join(session_dir, "phase2_macro_blocks.json"),
    )


def ensure_session_dirs(paths: SessionPaths) -> None:
    _safe_mkdir(paths.session_dir)
    _safe_mkdir(paths.phase1_chunks_dir)
    _safe_mkdir(paths.phase2_revised_dir)


def _completed_html_output_exists(paths: SessionPaths) -> bool:
    try:
        session = load_session(paths.session_path)
        if str(session.get("stage", "")).strip().lower() != "done":
            return False
        outputs = session.get("outputs", {})
        html_path = str(outputs.get("html", "") if isinstance(outputs, dict) else "")
        return bool(html_path and os.path.exists(html_path))
    except Exception:
        return False


def reset_session_dirs(
    paths: SessionPaths, *, allow_completed_destroy: bool = False
) -> None:
    if (
        not allow_completed_destroy
        and os.path.exists(paths.session_dir)
        and _completed_html_output_exists(paths)
    ):
        raise SessionCollisionError(paths.session_dir)
    if os.path.exists(paths.session_dir):
        import shutil

        shutil.rmtree(paths.session_dir, ignore_errors=True)
    ensure_session_dirs(paths)


def load_session(session_path: str):
    return _load_json(session_path)


def save_session(session_path: str, session: dict) -> None:
    session["updated_at"] = _now_iso()
    _atomic_write_json(session_path, session)


def _update_session(session: dict, updates: dict) -> dict:
    """Return a deep copy of the session before applying updates."""
    snapshot = copy.deepcopy(session)
    session.update(updates)
    return snapshot


def mark_html_exported(session: dict) -> dict:
    return _update_session(session, {"user_edited": False})


def new_session(input_path: str, settings: dict | None = None) -> dict:
    try:
        fp = _file_fingerprint(input_path)
    except Exception:
        fp = {"path": os.path.abspath(input_path), "size": None, "mtime": None}

    return {
        "schema_version": SESSION_SCHEMA_VERSION,
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
        "stage": "phase1",
        "input": fp,
        "settings": settings or build_default_pipeline_settings(),
        "phase1": {"next_start_sec": 0, "chunks_done": 0, "memoria_precedente": ""},
        "phase2": {"macro_total": 0, "revised_done": 0},
        "outputs": {},
        "last_error": None,
        "last_error_detail": None,
    }


def migrate_session(session: dict) -> tuple[dict, bool]:
    """Apply pending schema migrations in-place and return (session, was_changed).

    Migrations run sequentially so a session at any older version is always
    brought up to SESSION_SCHEMA_VERSION.  Callers own the deep-copy if needed.

    Adding a new migration: bump SESSION_SCHEMA_VERSION in shared.py and add an
    ``if version < N:`` block here that transforms/defaults the new fields.
    """
    try:
        version = int(session.get("schema_version", 0) or 0)
    except (ValueError, TypeError):
        version = 0
    changed = False

    if version < 1:
        # v0 (pre-versioning) → v1: fill in all required top-level keys.
        session.setdefault("stage", "phase1")
        session.setdefault("phase1", {})
        session.setdefault("phase2", {})
        session.setdefault("outputs", {})
        session.setdefault("last_error", None)
        session.setdefault("last_error_detail", None)
        session["schema_version"] = 1
        changed = True

    # Future migrations go here:
    # if version < 2:
    #     session.setdefault("new_field", default_value)
    #     session["schema_version"] = 2
    #     changed = True

    return session, changed


def clone_session_settings(session: dict) -> dict:
    try:
        return json.loads(json.dumps(session.get("settings", {}), ensure_ascii=False))
    except Exception:
        return dict(session.get("settings", {}))


__all__ = [
    "PRECONVERTED_AUDIO_FINAL",
    "PRECONVERTED_AUDIO_PARTIAL",
    "SESSION_CLEANUP_MAX_AGE_DAYS",
    "SESSION_ROOT",
    "SESSION_SCHEMA_VERSION",
    "_MAX_SESSION_CACHE_SIZE",
    "_STORAGE_INFO_TTL",
    "_TEMP_CHUNK_AUDIO_EXTS",
    "SessionCollisionError",
    "SessionPaths",
    "_cleanup_legacy_temp_chunks",
    "_cleanup_session_temp_chunks",
    "_completed_html_output_exists",
    "_compute_session_storage_info",
    "_file_fingerprint",
    "_file_tail_hash",
    "_folder_newest_mtime",
    "_folder_size",
    "_get_default_session_root",
    "_is_old_enough",
    "_now_iso",
    "_partial_file_hash",
    "_resolve_session_html_path",
    "_session_cleanup_kind",
    "_session_completed_html_exists",
    "_session_dir_for_file",
    "_session_id_cache",
    "_session_id_for_file",
    "_storage_info_cache",
    "_storage_info_cache_time",
    "_storage_info_executor",
    "_storage_info_future",
    "_storage_info_lock",
    "_update_session",
    "cleanup_completed_sessions",
    "cleanup_orphan_sessions",
    "cleanup_orphan_temp_chunks",
    "clone_session_settings",
    "ensure_session_dirs",
    "get_session_root",
    "get_session_storage_info",
    "invalidate_session_storage_cache",
    "load_session",
    "mark_html_exported",
    "migrate_legacy_session_root",
    "migrate_session",
    "new_session",
    "reset_session_dirs",
    "resolve_session_paths",
    "save_session",
    "set_session_root",
]
