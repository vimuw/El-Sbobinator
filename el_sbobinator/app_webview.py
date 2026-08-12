"""
PyWebView backend bridge for El Sbobinator.

This module contains ElSbobinatorApi, the JS-facing API class.
Supporting infrastructure lives in dedicated modules:
  - bridge_dispatcher.py  (_BridgeDispatcher)
  - pipeline_adapter.py   (_drain_dnd_paths, PipelineAdapter)
  - webview_entry.py      (_ConsoleTee, get_dist_path, has_webview2_runtime,
                           build_missing_webview2_html, main)
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time
from collections import OrderedDict
from typing import ClassVar

import webview

# Lazy imports to avoid loading heavy deps at startup:
# from el_sbobinator.pipeline.pipeline import esegui_sbobinatura  -- imported lazily in start_processing
# from el_sbobinator.services.audio_service import probe_media_duration -- imported lazily in _build_file_descriptor
# from el_sbobinator.services.validation_service import validate_environment -- imported lazily in validate_environment
from el_sbobinator.bridge.bridge_types import (
    BridgeFileItem,
    FileDonePayload,
    FileFailedPayload,
    LowDiskWarningPayload,
    ProcessDonePayload,
    SetCurrentFilePayload,
    ValidationResult,
)
from el_sbobinator.core.media_server import LocalMediaServer
from el_sbobinator.core.model_registry import DEFAULT_FALLBACK_MODELS, MODEL_OPTIONS
from el_sbobinator.core.session_store import (
    mark_html_exported,
    resolve_session_paths,
    save_session,
)
from el_sbobinator.core.shared import (
    DEFAULT_MODEL,
    SESSION_CLEANUP_MAX_AGE_DAYS,
    _atomic_write_json,
    _load_json,
    cleanup_orphan_sessions,
    cleanup_orphan_temp_chunks,
    get_session_root,
    get_session_storage_info,
    invalidate_session_storage_cache,
    migrate_legacy_session_root,
    set_session_root,
)
from el_sbobinator.core.shared import (
    cleanup_completed_sessions as _cleanup_completed_sessions,
)
from el_sbobinator.pipeline.pipeline_adapter import PipelineAdapter, _drain_dnd_paths
from el_sbobinator.pipeline.pipeline_settings import (
    build_default_pipeline_settings,
    load_and_sanitize_settings,
)
from el_sbobinator.services.config_service import (
    THEME_PREF_FILE,
    get_desktop_dir,
    load_config,
    save_config,
    save_session_root_to_config,
)
from el_sbobinator.utils.file_ops import (
    evict_html_paths_under,
    extract_html_shell,
    open_path_with_default_app,
    save_html_body_content,
)
from el_sbobinator.utils.file_ops import (
    read_html_content as read_html_file_content,
)
from el_sbobinator.utils.logging_utils import (
    configure_logging,
    get_logger,
    redact_secrets,
)

_TEXT_CACHE_MAX = 50

_ALLOWED_URL_PREFIXES: tuple[str, ...] = (
    "https://github.com/",
    "https://ko-fi.com/",
    "https://aistudio.google.com/",
)


def _normalize_revision_failed_blocks(value: object) -> list[int]:
    if not isinstance(value, list | tuple | set):
        return []
    return [int(idx) for idx in value if str(idx).strip().isdigit()]


def _safe_relpath(path: str, start: str) -> str | None:
    try:
        return os.path.relpath(path, start)
    except (OSError, ValueError):
        return None


def _candidate_from_relative(base_dir: str, rel_path: object) -> str | None:
    rel = str(rel_path or "").strip()
    if not rel or os.path.isabs(rel):
        return None
    return os.path.realpath(os.path.join(base_dir, rel))


class _RetryRuntime:
    def __init__(self, adapter: PipelineAdapter, cancel_event: threading.Event):
        self._adapter = adapter
        self._cancel_event = cancel_event
        self.effective_api_key: str | None = None

    def cancelled(self) -> bool:
        return self._cancel_event.is_set()

    def phase(self, _text: str) -> None:
        return None

    def progress(self, _value: float) -> None:
        return None

    def set_work_totals(self, *_args, **_kwargs) -> None:
        return None

    def update_work_done(self, *_args, **_kwargs) -> None:
        return None

    def register_step_time(self, *_args, **_kwargs) -> None:
        return None

    def set_effective_api_key(self, api_key: str | None) -> None:
        self.effective_api_key = str(api_key or "").strip() or None

    def ask_new_api_key(self, callback) -> bool:
        try:
            self._adapter.ask_new_api_key(callback)
            return True
        except Exception:
            return False

    def dismiss_new_api_key_prompt(self) -> None:
        try:
            self._adapter.dismiss_new_api_key_prompt()
        except Exception:
            pass


def _path_under_root(path: str, root: str) -> bool:
    """Return True if *path* equals or is nested under *root*.

    Uses os.path.normcase so the comparison is case-insensitive on Windows
    (where realpath does not canonicalise drive/folder casing).
    Both arguments must already be fully resolved (os.path.realpath) by the
    caller.
    """
    nc_path = os.path.normcase(path)
    nc_root = os.path.normcase(root)
    if nc_path == nc_root:
        return True
    if not nc_root.endswith(os.sep):
        nc_root += os.sep
    return nc_path.startswith(nc_root)


def _retry_zero_retried_response(
    *,
    retried_blocks: list,
    remaining: list,
    cancelled: bool,
    quota_exhausted: bool,
    session_dir: str,
    html_path: str,
) -> dict | None:
    if retried_blocks:
        return None
    if cancelled:
        error = "Operazione annullata."
    elif quota_exhausted:
        error = "Quota giornaliera esaurita: riprova domani."
    elif remaining:
        error = "Nessun blocco recuperato. Riprova piu tardi."
    else:
        return {
            "ok": True,
            "remaining_failed_blocks": remaining,
            "retried_blocks": retried_blocks,
            "html_path": html_path,
            "session_dir": session_dir,
        }
    return {
        "ok": False,
        "error": error,
        "remaining_failed_blocks": remaining,
        "retried_blocks": retried_blocks,
        "session_dir": session_dir,
        "cancelled": cancelled,
        "quota_exhausted": quota_exhausted,
    }


def _retry_would_overwrite_user_html(session: dict, existing_html: str | None) -> bool:
    user_edited = session.get("user_edited")
    return user_edited is True or (user_edited is None and existing_html is not None)


def _retry_no_failed_blocks_response(
    session: dict, failed_blocks: object, session_dir: str
) -> dict | None:
    if isinstance(failed_blocks, list) and failed_blocks:
        return None
    return {
        "ok": True,
        "retried_blocks": [],
        "remaining_failed_blocks": [],
        "html_path": session.get("outputs", {}).get("html", ""),
        "session_dir": session_dir,
    }


# ---------------------------------------------------------------------------
from el_sbobinator.bridge.controllers import (
    ExportControllerMixin,
    PipelineControllerMixin,
    SessionControllerMixin,
    SettingsControllerMixin,
)

# ElSbobinatorApi: exposed to JS via pywebview js_api
# ---------------------------------------------------------------------------


class ElSbobinatorApi(
    SettingsControllerMixin,
    SessionControllerMixin,
    PipelineControllerMixin,
    ExportControllerMixin,
):
    """Methods callable from React via window.pywebview.api.*"""

    _retry_global_lock: ClassVar[threading.Lock] = threading.Lock()
    _retry_locks: ClassVar[dict[str, threading.Lock]] = {}
    _retry_locks_mutex: ClassVar[threading.Lock] = threading.Lock()
    _ALLOWED_MEDIA_EXTS: ClassVar[set[str]] = {
        ".mp3",
        ".m4a",
        ".wav",
        ".ogg",
        ".flac",
        ".aac",
        ".mp4",
        ".mkv",
        ".webm",
    }
    _SUPPORTED_MEDIA_LABEL: ClassVar[str] = (
        "MP3, M4A, WAV, OGG, FLAC, AAC, MP4, MKV o WEBM"
    )
    _UNSUPPORTED_MEDIA_ERROR: ClassVar[str] = (
        "Formato non supportato. Seleziona un file audio/video: "
        f"{_SUPPORTED_MEDIA_LABEL}."
    )
    _UNREADABLE_MEDIA_ERROR: ClassVar[str] = (
        "Impossibile leggere la durata del file. Seleziona un file audio/video "
        f"valido: {_SUPPORTED_MEDIA_LABEL}."
    )

    def __init__(self):
        self._window: webview.Window | None = None
        self._cancel_event = threading.Event()
        self._adapter = PipelineAdapter(None, self._cancel_event)
        self._processing_thread: threading.Thread | None = None
        self._html_shell_cache: dict[str, tuple[str, str]] = {}
        self._resolved_path_cache: dict[str, str] = {}
        self._resolved_cache_lock = threading.Lock()
        self._sessions_cache: dict | None = None
        self._sessions_cache_ts: float = 0.0
        self._sessions_cache_gen: int = 0
        self._sessions_cache_lock = threading.Lock()
        self._text_cache: OrderedDict[str, tuple[float, str]] = OrderedDict()
        self._text_cache_lock = threading.Lock()
        self._move_state: dict = {
            "status": "idle",
            "moved": 0,
            "total": 0,
            "error": None,
        }
        self._move_lock = threading.Lock()
        self._retry_active_count: int = 0
        self._pipeline_lifecycle_lock = threading.Lock()
        self._cleanup_lock = threading.Lock()
        configure_logging()
        self._logger = get_logger("el_sbobinator.webview")
        # Initialise session root: apply persisted override or auto-migrate legacy path.
        try:
            _cfg = load_config()
            _custom_root = str(_cfg.get("session_root") or "").strip()
            if _custom_root and os.path.isabs(_custom_root):
                set_session_root(_custom_root)
            else:
                migrate_legacy_session_root()
        except Exception:
            pass
        self._startup_cleanup_thread = threading.Thread(
            target=self._cleanup_orphan_temp_chunks_on_startup,
            daemon=True,
            name="temp-chunks-startup-cleanup",
        )
        self._startup_cleanup_thread.start()
        self._prewarm_thread = threading.Thread(
            target=self.get_completed_sessions,
            daemon=True,
            name="sessions-prewarm",
        )
        self._prewarm_thread.start()

    def _cleanup_orphan_temp_chunks_on_startup(self) -> None:
        try:
            removed = cleanup_orphan_temp_chunks()
            if removed > 0 and self._adapter.window is not None:
                self._push_console(f"[*] Pulizia: rimossi {removed} file temporanei.")
        except Exception as exc:
            try:
                self._logger.debug("startup temp cleanup failed: %s", exc)
            except Exception:
                pass

    def set_window(self, window: webview.Window):
        self._window = window
        self._adapter.window = window

    def _find_candidate_audio_path(
        self,
        data: dict,
        session_dir: str,
        session_path: str | None = None,
        *,
        write_back: bool = True,
    ) -> str | None:
        """Return the first on-disk candidate audio path without any extension guard.

        Suitable for callers (e.g. ``get_completed_sessions``) that only need
        to *locate* the file, regardless of whether its extension is streamable.

        Side-effects (controlled by *write_back*):
            When *write_back* is ``True`` (the default) **and** a relocated
            candidate is found, ``data["input"]`` is mutated in-place **and**
            ``session.json`` is rewritten atomically so that subsequent
            look-ups are fast.  Pass ``write_back=False`` for a pure,
            side-effect-free look-up; the caller's dict is never touched and
            no file I/O is performed beyond the existence check.
        """
        input_data = data.get("input", {})
        if not isinstance(input_data, dict):
            return None
        current_path = str(input_data.get("path", "") or "").strip()
        if current_path and os.path.isfile(current_path):
            return current_path
        candidates: list[str] = []
        session_candidate = _candidate_from_relative(
            session_dir, input_data.get("path_rel_to_session")
        )
        if session_candidate:
            candidates.append(session_candidate)
        html_path = str(data.get("outputs", {}).get("html", "") or "")
        if html_path:
            html_candidate = _candidate_from_relative(
                os.path.dirname(os.path.realpath(html_path)),
                input_data.get("path_rel_to_html"),
            )
            if html_candidate:
                candidates.append(html_candidate)
        for candidate in candidates:
            # No extension guard here — accept any format that exists on disk.
            if not os.path.isfile(candidate):
                continue
            if write_back:
                input_data["path"] = candidate
                input_data["name"] = os.path.basename(candidate)
                try:
                    input_data["size"] = os.path.getsize(candidate)
                except Exception:
                    pass
                if session_path:
                    try:
                        _atomic_write_json(session_path, data)
                    except Exception:
                        pass
            return candidate
        return None

    def _resolve_completed_session_audio_path(
        self, data: dict, session_dir: str, session_path: str | None = None
    ) -> str | None:
        """Locate the audio path and return it only if it is streamable.

        Delegates discovery to :meth:`_find_candidate_audio_path` (no ext
        guard) and then applies ``_ALLOWED_STREAM_EXTS`` so that callers that
        need a streamable file (``stream_media_file``) stay safe.

        .. note::
            ``get_completed_sessions`` should call
            :meth:`_find_candidate_audio_path` directly so that sessions
            recorded in formats like ``.mkv`` or ``.webm`` are still surfaced
            in the archive list even when those extensions are not in
            ``_ALLOWED_STREAM_EXTS``.

        .. note::
            ``write_back=False`` is intentional: a streaming request must not
            rewrite ``session.json`` concurrently with ``get_completed_sessions``
            readers (no per-session file lock exists — TOCTOU).  Audio relinks
            are persisted exclusively through ``update_session_input_path``,
            which is the correct, guarded path.
        """
        candidate = self._find_candidate_audio_path(
            data, session_dir, session_path, write_back=False
        )
        if candidate is None:
            return None
        if os.path.splitext(candidate)[1].lower() not in self._ALLOWED_STREAM_EXTS:
            return None
        return candidate

    # ---- File Selection ----

    @staticmethod
    def _build_file_descriptor(path: str) -> BridgeFileItem:
        try:
            size = os.path.getsize(path)
        except Exception:
            size = 0
        try:
            from el_sbobinator.services.audio_service import probe_media_duration

            dur_val, _reason = probe_media_duration(path)
            duration = dur_val if dur_val else 0
        except Exception:
            duration = 0
        return {
            "id": path,
            "path": path,
            "name": os.path.basename(path),
            "size": size,
            "duration": duration,
        }

    @classmethod
    def _validate_media_path(
        cls, path: str, *, require_duration: bool = False
    ) -> tuple[bool, str, float | None]:
        normalized_path = str(path or "").strip()
        if not normalized_path or not os.path.isfile(normalized_path):
            return (
                False,
                "File non trovato. Seleziona un file audio/video esistente.",
                None,
            )
        ext = os.path.splitext(normalized_path)[1].lower()
        if ext not in cls._ALLOWED_MEDIA_EXTS:
            return False, cls._UNSUPPORTED_MEDIA_ERROR, None
        if not require_duration:
            return True, "", None
        try:
            from el_sbobinator.services.audio_service import probe_media_duration

            duration, _reason = probe_media_duration(normalized_path)
            duration_value = float(duration or 0)
        except Exception:
            duration_value = 0.0
        if duration_value <= 0:
            return False, cls._UNREADABLE_MEDIA_ERROR, None
        return True, "", duration_value

    def _build_valid_media_descriptor(self, path: str) -> BridgeFileItem | None:
        ok, error, _duration = self._validate_media_path(path)
        if not ok:
            self._push_console(f"⚠ {error}")
            return None
        return self._build_file_descriptor(path)

    def _validate_processing_files(self, files: list[BridgeFileItem]) -> str | None:
        for file_info in files:
            file_path = str(file_info.get("path", "") or "").strip()
            ok, error, probed_duration = self._validate_media_path(
                file_path, require_duration=True
            )
            if not ok:
                return error
            file_info["duration"] = float(probed_duration or 0)
        return None

    def ask_files(self) -> list[BridgeFileItem]:
        """Open native file dialog and return file info."""
        if not self._window:
            return []
        try:
            file_paths = self._window.create_file_dialog(
                webview.OPEN_DIALOG,
                allow_multiple=True,
                file_types=(
                    "Audio (*.mp3;*.m4a;*.wav;*.ogg;*.flac;*.aac)",
                    "Video (*.mp4;*.mkv;*.webm)",
                ),
            )
        except Exception:
            # Fallback without filters if the format is still rejected
            file_paths = self._window.create_file_dialog(
                webview.OPEN_DIALOG,
                allow_multiple=True,
            )
        if not file_paths:
            return []
        selected_paths = (
            [str(p) for p in file_paths]
            if isinstance(file_paths, list | tuple)
            else [str(file_paths)]
        )
        descriptors = []
        for path in selected_paths:
            descriptor = self._build_valid_media_descriptor(path)
            if descriptor is not None:
                descriptors.append(descriptor)
        return descriptors

    def ask_media_file(self) -> BridgeFileItem | None:
        """Open a native file dialog for a single media file."""
        if not self._window:
            return None
        try:
            file_paths = self._window.create_file_dialog(
                webview.OPEN_DIALOG,
                allow_multiple=False,
                file_types=(
                    "Audio (*.mp3;*.m4a;*.wav;*.ogg;*.flac;*.aac)",
                    "Video (*.mp4;*.mkv;*.webm)",
                ),
            )
        except Exception:
            file_paths = self._window.create_file_dialog(
                webview.OPEN_DIALOG,
                allow_multiple=False,
            )
        if not file_paths:
            return None
        selected_path = str(
            file_paths[0] if isinstance(file_paths, list | tuple) else file_paths
        )
        return self._build_valid_media_descriptor(selected_path)

    def check_path_exists(self, path: str) -> dict:
        """Check whether a persisted source path still exists on disk."""
        normalized_path = str(path or "").strip()
        return {
            "ok": True,
            "exists": bool(normalized_path and os.path.exists(normalized_path)),
        }

    _ALLOWED_DROP_EXTS: ClassVar[set[str]] = _ALLOWED_MEDIA_EXTS
    # Deliberately the same set as _ALLOWED_MEDIA_EXTS for now — every format
    # we accept for processing can also be streamed via stream_media_file.
    # If you ever narrow this set (e.g. to exclude .mkv / .webm), be aware
    # that _resolve_completed_session_audio_path uses _ALLOWED_STREAM_EXTS as
    # its extension guard: audio-relink in get_completed_sessions will then
    # silently return None for any format you remove, so the "replay" button
    # will stop working for sessions recorded in those formats.
    # See: _resolve_completed_session_audio_path vs _find_candidate_audio_path.
    _ALLOWED_STREAM_EXTS: ClassVar[set[str]] = _ALLOWED_MEDIA_EXTS

    def collect_dropped_files(self, names: list) -> dict:
        """Called by JS after postMessageWithAdditionalObjects('FilesDropped') to retrieve OS paths."""
        name_set = {str(n) for n in (names or [])}
        descriptors = []
        for _basename, fullpath in _drain_dnd_paths(name_set):
            ext = os.path.splitext(fullpath)[1].lower()
            if ext in self._ALLOWED_DROP_EXTS and os.path.isfile(fullpath):
                descriptors.append(self._build_file_descriptor(fullpath))
        if descriptors:
            self._adapter.emit("filesDropped", descriptors, batched=False)
        return {"ok": True}

    def validate_environment(
        self,
        api_key: str | None = None,
        check_api_key: bool = False,
        preferred_model: str | None = None,
        fallback_models: list[str] | None = None,
    ) -> dict:
        """Run an explicit environment validation without starting a full transcription."""
        try:
            from el_sbobinator.services.validation_service import (
                validate_environment as _validate_env,
            )

            result: ValidationResult = _validate_env(
                api_key=api_key,
                validate_api_key=bool(check_api_key),
                preferred_model=preferred_model,
                fallback_models=fallback_models,
            )
            return {"ok": True, "result": result}
        except Exception as e:
            self._logger.exception("Validazione ambiente fallita.")
            return {"ok": False, "error": redact_secrets(e)}

    def open_file(self, path: str) -> dict:
        """Open a local file/folder with the system default handler."""
        if not isinstance(path, str):
            return {"ok": False, "error": "Path non valido: deve essere una stringa."}
        if path.lower().startswith(("http://", "https://")):
            return {"ok": False, "error": "Usa open_url per aprire URL."}
        try:
            real_path = os.path.realpath(path)
            allowed_roots = [
                os.path.realpath(get_desktop_dir()),  # Desktop / OneDrive Desktop
                os.path.realpath(self._get_session_root()),  # Session storage
            ]
            path_is_allowed = any(
                _path_under_root(real_path, root) for root in allowed_roots
            )
            if not path_is_allowed:
                return {
                    "ok": False,
                    "error": "Accesso negato: path fuori dai percorsi consentiti.",
                }
            open_path_with_default_app(real_path)
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": redact_secrets(e)}

    def open_url(self, url: str) -> dict:
        """Open an external URL in the system browser (allowlist only)."""
        if not isinstance(url, str) or not any(
            url.startswith(p) for p in _ALLOWED_URL_PREFIXES
        ):
            return {"ok": False, "error": "URL non consentito."}
        try:
            open_path_with_default_app(url)
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": redact_secrets(e)}

    def read_html_content(self, path: str) -> dict:
        """Legge ed estrae il contenuto di un file HTML per l'anteprima."""
        if not isinstance(path, str) or not path.lower().endswith(".html"):
            return {"ok": False, "error": "Path non valido: deve essere un file .html."}
        # Path traversal protection: resolve and check against allowed roots.
        # Security: reject immediately only when the file EXISTS at a disallowed
        # path (genuine traversal attempt).  If the file is absent at that path
        # (e.g. stale html_path in session.json after a manual session move),
        # fall through to the session-dir fallback so the file can still be found.
        real_path = os.path.realpath(path)
        allowed_roots = [
            os.path.realpath(get_desktop_dir()),  # Desktop / OneDrive Desktop
            os.path.realpath(self._get_session_root()),  # Session storage
        ]
        path_is_allowed = any(
            _path_under_root(real_path, root) for root in allowed_roots
        )
        if not path_is_allowed and os.path.isfile(real_path):
            return {
                "ok": False,
                "error": "Accesso negato: path fuori dai percorsi consentiti.",
            }
        requested_real_path = real_path
        if not path_is_allowed or not os.path.isfile(real_path):
            _basename = os.path.basename(real_path)
            with self._resolved_cache_lock:
                cached_resolution = self._resolved_path_cache.get(requested_real_path)
                if cached_resolution and os.path.isfile(cached_resolution):
                    fallback = cached_resolution
                else:
                    fallback = self._find_html_in_session_dirs(_basename)
                    if not fallback:
                        fallback = self._rebuild_html_from_session(_basename)
                if fallback and os.path.isfile(fallback):
                    real_path = fallback
                    if not any(
                        _path_under_root(real_path, root) for root in allowed_roots
                    ):
                        return {
                            "ok": False,
                            "error": "Accesso negato: path fuori dai percorsi consentiti.",
                        }
                    self._resolved_path_cache[requested_real_path] = real_path
                else:
                    return {"ok": False, "error": "File non trovato."}
        else:
            with self._resolved_cache_lock:
                self._resolved_path_cache[requested_real_path] = real_path
        try:
            content = read_html_file_content(real_path)
            shell = extract_html_shell(content)
            if shell is not None:
                with self._resolved_cache_lock:
                    self._html_shell_cache[real_path] = shell
            return {"ok": True, "content": content}
        except Exception as e:
            return {"ok": False, "error": redact_secrets(e)}

    def _get_session_root(self) -> str:
        """Return the session storage root directory."""
        return get_session_root()

    def _find_html_in_session_dirs(self, basename: str) -> str | None:
        """Cerca un file HTML con lo stesso nome nelle cartelle di sessione.

        Usato come fallback quando il path originale (es. Desktop) non esiste piu'.
        Restituisce il path piu' recente per modifiche tra piu' sessioni candidate.
        """
        session_root = self._get_session_root()
        if not os.path.isdir(session_root):
            return None
        candidates: list[tuple[float, str]] = []
        try:
            for entry in os.scandir(session_root):
                if not entry.is_dir():
                    continue
                candidate = os.path.join(entry.path, basename)
                try:
                    st = os.stat(candidate)
                    candidates.append((st.st_mtime, os.path.realpath(candidate)))
                except (FileNotFoundError, OSError):
                    continue
        except Exception:
            return None
        if not candidates:
            return None
        candidates.sort(reverse=True)
        return candidates[0][1]

    def _rebuild_html_from_session(self, html_basename: str) -> str | None:
        """Ricostruisce l'HTML dai blocchi .md della sessione come ultimo fallback.

        Usato quando l'HTML manca sia al path originale sia nelle session dirs
        (es. sessioni create prima che l'HTML venisse salvato nella session dir).
        """
        from el_sbobinator.core.shared import _atomic_write_json
        from el_sbobinator.pipeline.pipeline_session import read_text_file
        from el_sbobinator.services.config_service import safe_output_basename
        from el_sbobinator.services.export_service import export_final_html_document

        session_root = self._get_session_root()
        if not os.path.isdir(session_root):
            return None
        try:
            candidates: list[tuple[float, str, dict]] = []
            for entry in os.scandir(session_root):
                if not entry.is_dir():
                    continue
                session_path = os.path.join(entry.path, "session.json")
                if not os.path.isfile(session_path):
                    continue
                try:
                    with open(session_path, encoding="utf-8") as fh:
                        session_data = json.load(fh)
                    existing_html = session_data.get("outputs", {}).get("html", "")
                    if not existing_html:
                        continue
                    if os.path.basename(str(existing_html)) != html_basename:
                        continue
                    phase2_revised_dir = os.path.join(entry.path, "phase2_revised")
                    if not os.path.isdir(phase2_revised_dir):
                        continue
                    if not session_data.get("input", {}).get("path", ""):
                        continue
                    if session_data.get("stage") != "done":
                        continue
                    mtime = os.path.getmtime(session_path)
                    candidates.append((mtime, entry.path, session_data))
                except Exception:
                    continue
            candidates.sort(key=lambda c: c[0], reverse=True)
            for _mtime, entry_path, session_data in candidates:
                session_path = os.path.join(entry_path, "session.json")
                phase2_revised_dir = os.path.join(entry_path, "phase2_revised")
                input_path = session_data["input"]["path"]
                try:
                    _, html_path = export_final_html_document(
                        input_path=input_path,
                        phase2_revised_dir=phase2_revised_dir,
                        fallback_body="",
                        read_text=read_text_file,
                        output_dir=entry_path,
                        fallback_output_dir=entry_path,
                        safe_output_basename=safe_output_basename,
                        revision_failed_blocks=_normalize_revision_failed_blocks(
                            session_data.get("revision_failed_blocks")
                        ),
                    )
                    if not os.path.isfile(html_path):
                        continue
                    # export derives its filename from input_path; if input_path
                    # was renamed after session creation the basename will differ
                    # from html_basename. Rename to the canonical basename so
                    # _find_html_in_session_dirs and save_html_content always
                    # resolve the same name.
                    if os.path.basename(html_path) != html_basename:
                        canonical_path = os.path.join(
                            os.path.dirname(html_path), html_basename
                        )
                        os.replace(html_path, canonical_path)
                        html_path = canonical_path
                    try:
                        session_data["outputs"]["html"] = html_path
                        _atomic_write_json(session_path, session_data)
                    except Exception:
                        pass
                    return os.path.realpath(html_path)
                except Exception:
                    continue
        except Exception:
            return None
        return None

    def _existing_html_for_session(self, session: dict, session_dir: str) -> str | None:
        """Return an existing HTML path for a session without rebuilding it."""
        html_path = str(session.get("outputs", {}).get("html", "") or "")
        if html_path and os.path.isfile(html_path):
            return os.path.realpath(html_path)

        try:
            if not os.path.isdir(session_dir):
                return None
            html_basename = os.path.basename(html_path) if html_path else ""
            if html_basename:
                session_copy = os.path.join(session_dir, html_basename)
                if os.path.isfile(session_copy):
                    return os.path.realpath(session_copy)
            for entry in os.scandir(session_dir):
                if entry.is_file() and entry.name.lower().endswith(".html"):
                    return os.path.realpath(entry.path)
        except Exception:
            return None
        return None

    def _mark_session_user_edited_for_html(self, real_path: str) -> None:
        try:
            session_path = os.path.join(os.path.dirname(real_path), "session.json")
            if not os.path.isfile(session_path):
                return
            session = _load_json(session_path)
            if not isinstance(session, dict) or bool(session.get("user_edited", False)):
                return
            session["user_edited"] = True
            save_session(session_path, session)
            with self._sessions_cache_lock:
                self._sessions_cache = None
                self._sessions_cache_gen += 1
        except Exception as exc:
            self._logger.debug(
                "Impossibile marcare sessione come modificata dall'utente: %s",
                exc,
            )

    def save_html_content(
        self, path: str, content: str, generation: int | None = None
    ) -> dict:
        """Aggiorna solo il contenuto del <body>, preservando head, stile e CSP dell'export originale."""
        if not isinstance(path, str) or not path.lower().endswith(".html"):
            return {"ok": False, "error": "Path non valido: deve essere un file .html."}
        # Path traversal protection: resolve and check against allowed roots.
        # Security: reject immediately only when the file EXISTS at a disallowed
        # path (genuine traversal attempt).  If absent (stale/moved path), fall
        # through to the session-dir fallback so edits can still reach the file.
        real_path = os.path.realpath(path)
        original_real_path = real_path
        allowed_roots = [
            os.path.realpath(get_desktop_dir()),  # Desktop / OneDrive Desktop
            os.path.realpath(self._get_session_root()),  # Session storage
        ]
        path_is_allowed = any(
            _path_under_root(real_path, root) for root in allowed_roots
        )
        if not path_is_allowed and os.path.isfile(real_path):
            return {
                "ok": False,
                "error": "Accesso negato: path fuori dai percorsi consentiti.",
            }
        if not path_is_allowed or not os.path.isfile(real_path):
            _basename = os.path.basename(real_path)
            with self._resolved_cache_lock:
                cached_resolution = self._resolved_path_cache.get(original_real_path)
                if cached_resolution and os.path.isfile(cached_resolution):
                    fallback = cached_resolution
                else:
                    fallback = self._find_html_in_session_dirs(_basename)
                    if not fallback:
                        fallback = self._rebuild_html_from_session(_basename)
                if fallback and os.path.isfile(fallback):
                    real_path = fallback
                    if not any(
                        _path_under_root(real_path, root) for root in allowed_roots
                    ):
                        return {
                            "ok": False,
                            "error": "Accesso negato: path fuori dai percorsi consentiti.",
                        }
                    self._resolved_path_cache[original_real_path] = real_path
                else:
                    return {"ok": False, "error": "File non trovato."}
        try:
            with self._resolved_cache_lock:
                shell = self._html_shell_cache.get(
                    real_path
                ) or self._html_shell_cache.get(original_real_path)
            gen = int(generation) if generation is not None else None
            saved = save_html_body_content(
                real_path, content, shell=shell, generation=gen
            )
            if saved:
                self._mark_session_user_edited_for_html(real_path)
                return {"ok": True, "saved": True}
            return {
                "ok": False,
                "saved": False,
                "error": "Salvataggio ignorato perché più vecchio dell'ultima versione.",
            }
        except Exception as e:
            return {"ok": False, "error": redact_secrets(e)}

    def show_notification(self, title: str, message: str) -> dict:
        """Mostra una notifica toast nativa di sistema tramite plyer."""
        try:
            from plyer import notification

            # On windows, notify requires an absolute path to a .ico file if we want an icon.
            # We'll omit the app_icon for simplicity and cross-platform compatibility.
            notification.notify(  # type: ignore[operator]
                title=title, message=message, app_name="El Sbobinator", timeout=5
            )
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": redact_secrets(e)}

    def stream_media_file(self, file_path: str, session_dir: str | None = None) -> dict:
        """Avvia o riavvia un micro-server HTTP per inviare l'audio nativo a React via streaming byte-range."""
        resolved_file_path = str(file_path or "").strip()
        if session_dir and (
            not resolved_file_path or not os.path.isfile(resolved_file_path)
        ):
            try:
                abs_dir, session_path = self._resolve_retry_session(str(session_dir))
                data = _load_json(session_path)
                if isinstance(data, dict):
                    fallback = self._resolve_completed_session_audio_path(
                        data, abs_dir, session_path
                    )
                    if fallback:
                        resolved_file_path = fallback
            except Exception:
                pass
        if not resolved_file_path:
            return {
                "ok": False,
                "error": "Nessun file audio trovato per questa sessione.",
            }
        ext = os.path.splitext(resolved_file_path)[1].lower()
        if ext not in self._ALLOWED_STREAM_EXTS:
            return {
                "ok": False,
                "error": "Tipo di file non supportato per lo streaming.",
            }
        try:
            return {
                "ok": True,
                "url": LocalMediaServer.stream_url_for_file(resolved_file_path),
            }
        except Exception as e:
            return {"ok": False, "error": redact_secrets(e)}

    def download_and_install_update(self, version: str) -> dict:
        """Download the correct installer for this OS, launch it, then quit the app."""
        from el_sbobinator.core.updater import (
            download_and_install_update as _download_and_install_update,
        )

        return _download_and_install_update(version, emit_fn=self._adapter.emit)

    def send_collaboration_signal(self, room: str, payload: str) -> dict:
        """Relay a collaboration room signal/update across all local pywebview windows on the desktop for instant zero-latency testing."""
        if not room or not payload:
            return {"ok": False, "error": "Parametri non validi"}
        room_clean = str(room).strip().lower()
        payload_str = str(payload)
        import json

        for w in webview.windows:
            try:
                w.evaluate_js(
                    f"window.__elSbobinatorReceiveCollabSignal && window.__elSbobinatorReceiveCollabSignal({json.dumps(room_clean)}, {json.dumps(payload_str)});"
                )
            except Exception:
                pass
        return {"ok": True}

    # ---- Console push helper ----

    def _push_console(self, msg: str):
        self._adapter.emit("appendConsole", redact_secrets(msg), batched=False)


# ---------------------------------------------------------------------------
# Re-exports for backward compatibility
# ---------------------------------------------------------------------------

from el_sbobinator.webview_entry import main

if __name__ == "__main__":
    main()
