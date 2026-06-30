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
# ElSbobinatorApi: exposed to JS via pywebview js_api
# ---------------------------------------------------------------------------


class ElSbobinatorApi:
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

    # ---- Settings ----

    def load_settings(self) -> dict:
        """Load saved config from disk."""
        try:
            cfg = load_config()
            result: dict = {
                "api_key": cfg.get("api_key", ""),
                "fallback_keys": cfg.get("fallback_keys", []),
                "preferred_model": cfg.get("preferred_model", DEFAULT_MODEL),
                "fallback_models": cfg.get("fallback_models", []),
                "available_models": list(MODEL_OPTIONS),
                "has_protected_key": bool(cfg.get("has_protected_key")),
                "api_key_insecure": bool(cfg.get("api_key_insecure")),
                "api_key_insecure_reason": str(
                    cfg.get("api_key_insecure_reason") or ""
                ),
            }
            if cfg.get("config_recovered_from"):
                result["config_recovered_from"] = cfg["config_recovered_from"]
            return result
        except Exception:
            # DEFAULT_FALLBACK_MODELS is intentionally an empty tuple — no built-in
            # fallbacks are shipped; the user configures their own in Settings.
            # The error-path list therefore evaluates to [] by design.
            return {
                "api_key": "",
                "fallback_keys": [],
                "preferred_model": DEFAULT_MODEL,
                "fallback_models": list(DEFAULT_FALLBACK_MODELS),
                "available_models": list(MODEL_OPTIONS),
                "has_protected_key": False,
                "api_key_insecure": False,
                "api_key_insecure_reason": "",
            }

    def save_settings(
        self,
        api_key: str | None,
        fallback_keys: list[str],
        preferred_model: str,
        fallback_models: list[str],
    ) -> dict:
        """Save config to disk."""
        try:
            save_config(
                api_key,
                fallback_keys=fallback_keys,
                preferred_model=preferred_model,
                fallback_models=fallback_models,
            )
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": redact_secrets(e)}

    def save_theme_preference(self, theme: str) -> None:
        """Persist theme preference to disk so the native window gets the right background on next launch."""
        try:
            if theme not in ("light", "dark"):
                return
            os.makedirs(os.path.dirname(THEME_PREF_FILE), exist_ok=True)
            with open(THEME_PREF_FILE, "w", encoding="utf-8") as fh:
                fh.write(theme)
        except Exception:
            pass

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

    def get_completed_sessions(self, limit: int = 20) -> dict:
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
                # Migration: if the stored path (e.g. old Desktop copy) is gone,
                # look for the same filename inside the session dir and fix session.json.
                if html_path and not os.path.isfile(str(html_path)):
                    session_copy = os.path.join(
                        session_dir, os.path.basename(str(html_path))
                    )
                    if not os.path.isfile(session_copy):
                        continue  # HTML truly missing, no fallback candidate; skip
                    html_path = session_copy
                    try:
                        from el_sbobinator.core.shared import (
                            _atomic_write_json,
                        )

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
        import shutil

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

    def _resolve_retry_session(self, session_dir: str) -> tuple[str, str]:
        session_root = os.path.realpath(self._get_session_root())
        abs_dir = os.path.realpath(str(session_dir or ""))
        if not _path_under_root(abs_dir, session_root):
            raise ValueError("Sessione non valida.")
        session_path = os.path.join(abs_dir, "session.json")
        if not os.path.isfile(session_path):
            raise FileNotFoundError("Sessione non trovata.")
        return abs_dir, session_path

    def _push_retry_completion_status(
        self, remaining: list, cancelled: bool, quota_exhausted: bool
    ) -> None:
        if not remaining:
            self._push_console(
                "REVISIONE COMPLETATA CON SUCCESSO! ✅ Tutti i blocchi sono stati revisionati."
            )
        else:
            if cancelled:
                self._push_console(
                    "REVISIONE INTERROTTA! ⚠ Operazione annullata dall'utente."
                )
            elif quota_exhausted:
                self._push_console(
                    "REVISIONE INTERROTTA! ⚠ Quota giornaliera API esaurita. Riprova domani."
                )
            else:
                self._push_console(
                    f"REVISIONE COMPLETATA CON AVVISI! ⚠ Rimangono {len(remaining)} blocchi non revisionati."
                )

    def retry_failed_revision_blocks(self, session_dir: str) -> dict:
        """Retry only macro blocks that were included unrevised in a done session."""
        if self._adapter.is_running:
            return {
                "ok": False,
                "error": "Elaborazione in corso: riprova al termine.",
            }
        retry_lock: threading.Lock | None = None
        retry_global_lock_acquired = False
        retry_lock_acquired = False
        _retry_count_incremented = False
        try:
            from google import genai

            from el_sbobinator.core.model_registry import build_model_state
            from el_sbobinator.core.prompts import PROMPT_REVISIONE
            from el_sbobinator.pipeline.pipeline_session import read_text_file
            from el_sbobinator.services.config_service import safe_output_basename
            from el_sbobinator.services.export_service import export_final_html_document
            from el_sbobinator.services.generation_service import (
                load_fallback_keys,
                request_new_api_key,
            )
            from el_sbobinator.services.revision_service import (
                retry_failed_revision_blocks as _retry_failed_revision_blocks,
            )

            abs_dir, session_path = self._resolve_retry_session(session_dir)

            retry_global_lock_acquired = self._retry_global_lock.acquire(blocking=False)
            if not retry_global_lock_acquired:
                return {
                    "ok": False,
                    "error": "Retry gia' in corso: riprova al termine.",
                }

            lock_key = os.path.normcase(abs_dir)
            with self._retry_locks_mutex:
                retry_lock = self._retry_locks.setdefault(lock_key, threading.Lock())
            retry_lock_acquired = retry_lock.acquire(blocking=False)
            if not retry_lock_acquired:
                return {
                    "ok": False,
                    "error": "Retry gia' in corso per questa sessione.",
                }
            with self._pipeline_lifecycle_lock:
                if self._adapter.is_running:
                    return {
                        "ok": False,
                        "error": "Elaborazione in corso: riprova al termine.",
                    }
                self._retry_active_count += 1
            _retry_count_incremented = True

            session = _load_json(session_path)
            if not isinstance(session, dict) or session.get("stage") != "done":
                return {"ok": False, "error": "Sessione non completata."}
            if _retry_would_overwrite_user_html(
                session, self._existing_html_for_session(session, abs_dir)
            ):
                return {
                    "ok": False,
                    "conflict": True,
                    "error": "HTML modificato dall'utente: retry annullato per evitare sovrascritture.",
                    "session_dir": abs_dir,
                }
            failed_blocks = session.get("revision_failed_blocks", [])
            no_failed_blocks = _retry_no_failed_blocks_response(
                session, failed_blocks, abs_dir
            )
            if no_failed_blocks is not None:
                return no_failed_blocks

            cfg = load_config()
            api_key = str(cfg.get("api_key") or "").strip()
            if not api_key:
                return {
                    "ok": False,
                    "error": "API key mancante: aggiungila nelle impostazioni.",
                }

            settings = session.get("settings", {}) if isinstance(session, dict) else {}
            primary_model = str(
                settings.get("model") or cfg.get("preferred_model") or DEFAULT_MODEL
            ).strip()
            fallback_models = settings.get("fallback_models") or cfg.get(
                "fallback_models", []
            )
            model_state = build_model_state(primary_model, fallback_models)
            client = genai.Client(api_key=api_key)
            retry_cancel_event = threading.Event()
            runtime = _RetryRuntime(self._adapter, retry_cancel_event)
            fallback_keys = load_fallback_keys()

            def _save_session() -> bool:
                try:
                    save_session(session_path, session)
                    return True
                except Exception:
                    return False

            def _request_fallback_key() -> str | None:
                key = request_new_api_key(runtime, runtime.cancelled)
                if not key or not str(key).strip():
                    retry_cancel_event.set()
                return key

            def _on_model_switched(_old: str, new: str) -> None:
                session.setdefault("settings", {})
                session["settings"]["effective_model"] = new
                _save_session()

            phase2_revised_dir = os.path.join(abs_dir, "phase2_revised")
            client, retry_result = _retry_failed_revision_blocks(
                client=client,
                model_name=primary_model,
                model_state=model_state,
                phase2_revised_dir=phase2_revised_dir,
                session=session,
                save_session=_save_session,
                runtime=runtime,
                cancelled=runtime.cancelled,
                fallback_keys=fallback_keys,
                request_fallback_key=_request_fallback_key,
                prompt_revisione=PROMPT_REVISIONE,
                on_model_switched=_on_model_switched,
            )

            retried_blocks = list(retry_result.get("retried_blocks", []))
            remaining = list(retry_result.get("failed_blocks", []))
            cancelled = bool(retry_result.get("cancelled"))
            quota_exhausted = bool(retry_result.get("quota_exhausted"))
            zero_response = _retry_zero_retried_response(
                retried_blocks=retried_blocks,
                remaining=remaining,
                cancelled=cancelled,
                quota_exhausted=quota_exhausted,
                session_dir=abs_dir,
                html_path=str(session.get("outputs", {}).get("html", "") or ""),
            )
            if zero_response is not None:
                return zero_response

            input_path = str(session.get("input", {}).get("path", "") or "")
            _title, html_path = export_final_html_document(
                input_path=input_path,
                phase2_revised_dir=phase2_revised_dir,
                fallback_body="",
                read_text=read_text_file,
                output_dir=abs_dir,
                fallback_output_dir=abs_dir,
                safe_output_basename=safe_output_basename,
                revision_failed_blocks=remaining,
            )
            session.setdefault("outputs", {})
            session["outputs"]["html"] = html_path
            session.setdefault("settings", {})
            session["settings"]["effective_model"] = model_state.current
            mark_html_exported(session)
            _save_session()
            invalidate_session_storage_cache()
            evict_html_paths_under(abs_dir + os.sep)
            with self._text_cache_lock:
                self._text_cache.pop(html_path, None)
            with self._sessions_cache_lock:
                self._sessions_cache = None
                self._sessions_cache_gen += 1

            self._push_retry_completion_status(
                remaining=remaining,
                cancelled=cancelled,
                quota_exhausted=quota_exhausted,
            )
            return {
                "ok": True,
                "retried_blocks": retried_blocks,
                "remaining_failed_blocks": remaining,
                "completion_status": "completed_with_warnings"
                if remaining
                else "completed",
                "html_path": html_path,
                "session_dir": abs_dir,
                "effective_model": model_state.current,
                "cancelled": cancelled,
                "quota_exhausted": quota_exhausted,
            }
        except Exception as e:
            return {"ok": False, "error": redact_secrets(e)}
        finally:
            if _retry_count_incremented:
                with self._pipeline_lifecycle_lock:
                    self._retry_active_count -= 1
            if retry_lock is not None and retry_lock_acquired:
                retry_lock.release()
            if retry_global_lock_acquired:
                self._retry_global_lock.release()

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

    def cleanup_old_sessions(
        self,
        max_age_days: int = SESSION_CLEANUP_MAX_AGE_DAYS,
        dry_run: bool = False,
    ) -> dict:
        """Delete incomplete session folders older than max_age_days days."""
        try:
            with self._cleanup_lock:
                result = cleanup_orphan_sessions(
                    max(1, int(max_age_days)),
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
        max_age_days: int = SESSION_CLEANUP_MAX_AGE_DAYS,
        dry_run: bool = True,
    ) -> dict:
        """Count or delete completed session folders older than max_age_days days."""
        try:
            with self._cleanup_lock:
                result = _cleanup_completed_sessions(
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
            if sys.platform == "win32":
                os.startfile(session_root)  # type: ignore[attr-defined]
            elif sys.platform == "darwin":
                subprocess.Popen(["open", session_root])
            else:
                subprocess.Popen(["xdg-open", session_root])
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": redact_secrets(e)}

    # ---- Full-text search ----

    def search_sessions(self, query: str, limit: int = 10) -> dict:
        """Search the plain-text content of every completed session HTML.

        Returns up to *limit* sessions that contain *query*, ordered by
        descending match count.  Each entry includes up to 3 context snippets
        with ``before / match / after`` fields for client-side highlighting.
        """
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

                    # mtime-keyed cache: re-read only when file changed
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

    # ---- Archive Folders ----

    def get_archive_folders(self) -> dict:
        """Return the user-defined archive folders."""
        try:
            from el_sbobinator.services.folders_service import (
                get_folders as _get_archive_folders,
            )

            folders = _get_archive_folders()
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

    # ---- Processing ----

    def _start_processing_guard(self, mark_running: bool = False) -> dict | None:
        with self._pipeline_lifecycle_lock:
            if self._adapter.is_running:
                return {"ok": False, "error": "Elaborazione già in corso"}
            if self._retry_active_count > 0:
                return {"ok": False, "error": "Retry in corso: riprova al termine."}
            if mark_running:
                self._adapter.is_running = True
        return None

    def _low_disk_warning_for_files(
        self, files: list[BridgeFileItem]
    ) -> LowDiskWarningPayload | None:
        from el_sbobinator.pipeline.pipeline_session import (
            estimate_disk_space,
            normalize_stage,
        )

        try:
            cfg = load_config()
            defaults = build_default_pipeline_settings(cfg)
            default_session = {"settings": defaults}
            default_settings, _changed = load_and_sanitize_settings(default_session)
        except Exception:
            return None

        worst: LowDiskWarningPayload | None = None
        for file_info in files:
            file_path = str(file_info.get("path", "") or "")
            if not file_path:
                continue
            try:
                duration = float(file_info.get("duration", 0) or 0)
            except Exception:
                duration = 0.0
            if duration <= 0 and os.path.exists(file_path):
                try:
                    from el_sbobinator.services.audio_service import (
                        probe_media_duration,
                    )

                    probed_duration, _reason = probe_media_duration(file_path)
                    duration = float(probed_duration or 0)
                except Exception:
                    duration = 0.0
            if duration <= 0:
                continue
            try:
                paths = resolve_session_paths(file_path)
            except Exception:
                continue
            stage = "phase1"
            next_start_sec = 0
            settings = default_settings
            try:
                if os.path.exists(paths.session_path):
                    saved = _load_json(paths.session_path)
                    if isinstance(saved, dict):
                        settings, _changed = load_and_sanitize_settings(saved)
                        stage = normalize_stage(saved)
                        phase1 = saved.get("phase1", {})
                        if isinstance(phase1, dict):
                            next_start_sec = int(phase1.get("next_start_sec", 0) or 0)
            except Exception:
                stage = "phase1"
                next_start_sec = 0
                settings = default_settings
            for estimate in estimate_disk_space(
                paths.session_dir,
                duration,
                settings,
                stage,
                next_start_sec,
            ):
                if not estimate.is_clearly_insufficient:
                    continue
                payload: LowDiskWarningPayload = {
                    "needed_bytes": int(estimate.needed_bytes),
                    "free_bytes": int(estimate.free_bytes),
                    "location": estimate.location,
                    "kind": estimate.kind,
                    "file_name": str(
                        file_info.get("name", "") or os.path.basename(file_path)
                    ),
                }
                if worst is None:
                    worst = payload
                    continue
                worst_deficit = int(worst["needed_bytes"]) - int(worst["free_bytes"])
                deficit = int(payload["needed_bytes"]) - int(payload["free_bytes"])
                if deficit > worst_deficit:
                    worst = payload
        return worst

    def _persist_processing_config(
        self,
        api_key: str,
        preferred_model: str | None,
        fallback_models: list[str] | None,
    ) -> None:
        try:
            save_config(
                api_key,
                preferred_model=preferred_model or None,
                fallback_models=fallback_models
                if isinstance(fallback_models, list)
                else None,
            )
        except Exception:
            pass

    def _low_disk_start_response(
        self, files: list[BridgeFileItem], override_low_disk: bool
    ) -> dict | None:
        if override_low_disk:
            return None
        low_disk_warning = self._low_disk_warning_for_files(files)
        if low_disk_warning is None:
            return None
        return {
            "ok": False,
            "error": "Spazio libero insufficiente.",
            "low_disk_warning": low_disk_warning,
        }

    def _prepare_start_processing(
        self,
        files: list[BridgeFileItem],
        api_key: str,
        preferred_model: str | None,
        fallback_models: list[str] | None,
        override_low_disk: bool,
    ) -> dict | None:
        guard_error = self._start_processing_guard()
        if guard_error is not None:
            return guard_error
        validation_error = self._validate_processing_files(files)
        if validation_error is not None:
            return {"ok": False, "error": validation_error}
        self._persist_processing_config(api_key, preferred_model, fallback_models)
        low_disk_response = self._low_disk_start_response(files, override_low_disk)
        if low_disk_response is not None:
            return low_disk_response
        return self._start_processing_guard(mark_running=True)

    def start_processing(
        self,
        files: list[BridgeFileItem],
        api_key: str,
        resume_session: bool = True,
        preferred_model: str | None = None,
        fallback_models: list[str] | None = None,
        override_low_disk: bool = False,
    ) -> dict:
        """Start the pipeline in a background thread."""
        if not files or not api_key:
            return {"ok": False, "error": "File o API key mancanti"}
        start_error = self._prepare_start_processing(
            files,
            api_key,
            preferred_model,
            fallback_models,
            override_low_disk,
        )
        if start_error is not None:
            return start_error

        # Cleanup orphan temp files
        try:
            removed = cleanup_orphan_temp_chunks()
            if removed > 0:
                self._push_console(f"[*] Pulizia: rimossi {removed} file temporanei.")
        except Exception:
            pass

        # Setup adapter
        self._cancel_event.clear()
        self._adapter.file_temporanei = []
        self._adapter._run_started_monotonic = time.monotonic()
        self._adapter._step_times = {}
        self._adapter.reset_run_state(api_key)

        # Process files sequentially in background
        def _run():
            from el_sbobinator.pipeline.pipeline import esegui_sbobinatura

            active_api_key = api_key
            completed_count = 0
            completed_with_warnings_count = 0
            failed_count = 0
            current_index: int | None = None
            current_file_id = ""
            quota_exhausted = False
            try:
                for idx, file_info in enumerate(files):
                    if self._cancel_event.is_set():
                        break
                    try:
                        current_index = idx
                        current_file_id = str(file_info.get("id", "") or "")
                        self._adapter.reset_run_state(active_api_key)
                        file_path = file_info.get("path", "")
                        if not file_path or not os.path.exists(file_path):
                            self._push_console(f"[!] File non trovato: {file_path}")
                            ff_payload: FileFailedPayload = {
                                "index": idx,
                                "id": file_info.get("id", ""),
                                "error": "File non trovato.",
                            }
                            self._adapter.emit("fileFailed", ff_payload, batched=False)
                            failed_count += 1
                            current_index = None
                            current_file_id = ""
                            continue

                        self._push_console(f"\n{'=' * 50}")
                        self._push_console(
                            f"  File {idx + 1}/{len(files)}: {os.path.basename(file_path)}"
                        )
                        self._push_console(f"{'=' * 50}")
                        current_payload: SetCurrentFilePayload = {
                            "index": idx,
                            "id": file_info.get("id", ""),
                            "total": len(files),
                        }
                        self._adapter.emit(
                            "setCurrentFile", current_payload, batched=False
                        )
                        file_resume_override = file_info.get("resume_session")
                        file_resume_session = (
                            bool(file_resume_override)
                            if file_resume_override is not None
                            else resume_session
                        )
                        file_allow_completed_destroy = bool(
                            file_info.get("allow_completed_destroy", False)
                        )

                        esegui_sbobinatura(
                            file_path,
                            active_api_key,
                            self._adapter,
                            resume_session=file_resume_session,
                            allow_completed_destroy=file_allow_completed_destroy,
                        )
                        if self._adapter.effective_api_key:
                            active_api_key = self._adapter.effective_api_key

                        last_run_status = self._adapter.last_run_status
                        if (
                            self._cancel_event.is_set()
                            or last_run_status == "cancelled"
                        ) and last_run_status != "failed":
                            break

                        if last_run_status in ("completed", "completed_with_warnings"):
                            if self._adapter.last_output_html and os.path.exists(
                                self._adapter.last_output_html
                            ):
                                revision_failed_blocks = list(
                                    self._adapter.last_revision_failed_blocks or []
                                )
                                completion_status = (
                                    "completed_with_warnings"
                                    if last_run_status == "completed_with_warnings"
                                    or revision_failed_blocks
                                    else "completed"
                                )
                                fd_payload: FileDonePayload = {
                                    "index": idx,
                                    "id": file_info.get("id", ""),
                                    "output_html": self._adapter.last_output_html,
                                    "output_dir": self._adapter.last_output_dir or "",
                                    "completion_status": completion_status,
                                    "revision_failed_blocks": revision_failed_blocks,
                                    "primary_model": self._adapter.last_primary_model
                                    or "",
                                    "effective_model": self._adapter.last_effective_model
                                    or "",
                                }
                                self._adapter.emit(
                                    "fileDone", fd_payload, batched=False
                                )
                                if completion_status == "completed_with_warnings":
                                    completed_with_warnings_count += 1
                                else:
                                    completed_count += 1
                            else:
                                ff_payload2: FileFailedPayload = {
                                    "index": idx,
                                    "id": file_info.get("id", ""),
                                    "error": "Output HTML non generato.",
                                }
                                self._adapter.emit(
                                    "fileFailed", ff_payload2, batched=False
                                )
                                failed_count += 1
                        else:
                            error_detail = (
                                getattr(self._adapter, "last_run_error_detail", None)
                                or ""
                            )
                            error_message = (
                                redact_secrets(self._adapter.last_run_error)
                                or "Elaborazione non completata."
                            )
                            error_detail = redact_secrets(error_detail)
                            ff_payload3: FileFailedPayload = {
                                "index": idx,
                                "id": file_info.get("id", ""),
                                "error": error_message,
                            }
                            if error_detail:
                                ff_payload3["error_detail"] = error_detail
                            self._adapter.emit("fileFailed", ff_payload3, batched=False)
                            failed_count += 1
                            if ff_payload3["error"] in {
                                "quota_daily_limit_phase1",
                                "quota_daily_limit_phase2",
                            }:
                                quota_exhausted = True
                                break
                        current_index = None
                        current_file_id = ""
                    except Exception as e:
                        if current_index is not None:
                            ff_payload4: FileFailedPayload = {
                                "index": current_index,
                                "id": current_file_id,
                                "error": redact_secrets(e) or "Errore fatale.",
                            }
                            self._adapter.emit("fileFailed", ff_payload4, batched=False)
                            failed_count += 1
                        self._push_console(f"[!] Errore su file {idx + 1}: {e}")
                        current_index = None
                        current_file_id = ""
            except Exception as e:
                self._push_console(f"[!] Errore fatale: {e}")
            finally:
                self._adapter.is_running = False
                with self._sessions_cache_lock:
                    self._sessions_cache = None
                    self._sessions_cache_gen += 1
                payload: ProcessDonePayload = {
                    "cancelled": bool(
                        self._cancel_event.is_set()
                        or self._adapter.last_run_status == "cancelled"
                    ),
                    "completed": completed_count,
                    "completed_with_warnings": completed_with_warnings_count,
                    "failed": failed_count,
                    "total": len(files),
                }
                if quota_exhausted:
                    payload["quota_exhausted"] = True
                self._adapter.emit("processDone", payload, batched=False)

        self._processing_thread = threading.Thread(target=_run, daemon=True)
        self._processing_thread.start()
        return {"ok": True}

    def answer_regenerate(self, regenerate: bool | None) -> dict:
        """Called by React when user clicks Use Saved or Regenerate."""
        self._adapter.answer_regenerate(regenerate)
        return {"ok": True}

    def answer_new_key(self, key: str | None) -> dict:
        """Called by React when user submits a replacement API key."""
        self._adapter.answer_new_key(key or "")
        return {"ok": True}

    def stop_processing(self) -> dict:
        """Request cancellation."""
        self._cancel_event.set()
        self._adapter.cancel_pending_prompts()
        thread = self._processing_thread
        if not self._adapter.is_running and (thread is None or not thread.is_alive()):
            payload: ProcessDonePayload = {
                "cancelled": True,
                "completed": 0,
                "failed": 0,
                "total": 0,
            }
            self._adapter.emit("processDone", payload, batched=False)
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

    def ask_session_folder(self) -> dict:
        """Open a folder-picker dialog and return the user-selected path."""
        try:
            if self._window is None:
                return {"ok": False, "error": "Finestra non disponibile"}
            result = self._window.create_file_dialog(webview.FOLDER_DIALOG)
            if not result:
                return {"ok": False, "cancelled": True}
            path = str(result[0]) if isinstance(result, list | tuple) else str(result)
            return {"ok": True, "path": path}
        except Exception as e:
            return {"ok": False, "error": redact_secrets(e)}

    def move_session_root(self, new_path: str) -> dict:
        """Start an async move of the session-storage folder to new_path."""
        new_path = str(new_path or "").strip()
        if not new_path or not os.path.isabs(new_path):
            return {"ok": False, "error": "Percorso non valido"}
        old_root = get_session_root()
        if os.path.normcase(os.path.realpath(new_path)) == os.path.normcase(
            os.path.realpath(old_root)
        ):
            return {"ok": False, "error": "Percorso identico a quello attuale"}
        if _path_under_root(
            os.path.normcase(os.path.realpath(new_path)),
            os.path.normcase(os.path.realpath(old_root)),
        ):
            return {
                "ok": False,
                "error": "La destinazione è dentro la cartella attuale",
            }
        if self._processing_thread is not None and self._processing_thread.is_alive():
            return {"ok": False, "error": "Impossibile spostare durante l'elaborazione"}
        with self._move_lock:
            if self._move_state.get("status") == "moving":
                return {"ok": False, "error": "Spostamento già in corso"}
            self._move_state = {
                "status": "moving",
                "moved": 0,
                "total": 0,
                "error": None,
            }
        thread = threading.Thread(
            target=self._do_move_session_root,
            args=(old_root, new_path),
            daemon=True,
            name="session-move",
        )
        thread.start()
        return {"ok": True, "started": True}

    def get_session_move_status(self) -> dict:
        """Return the current status of an ongoing or completed session move."""
        with self._move_lock:
            return dict(self._move_state)

    def _do_move_session_root(self, old_root: str, new_path: str) -> None:
        """Background worker: moves session root, using atomic rename when possible.

        Fast path (same filesystem): removes the empty new_path stub we just
        created, then calls os.rename(old_root, new_path) which is atomic on
        both POSIX and Windows NTFS.

        Cross-device fallback: moves items one-by-one.  On any mid-loop
        failure SESSION_ROOT is still updated to new_path so the app scans
        the files that made it there; the error message identifies how many
        sessions remain at old_root.
        """
        import shutil as _shutil

        try:
            items = os.listdir(old_root) if os.path.isdir(old_root) else []
        except Exception:
            items = []
        total = len(items)
        with self._move_lock:
            self._move_state = {
                "status": "moving",
                "moved": 0,
                "total": total,
                "error": None,
            }
        try:
            os.makedirs(new_path, exist_ok=True)
        except Exception as e:
            with self._move_lock:
                self._move_state = {
                    "status": "error",
                    "moved": 0,
                    "total": total,
                    "error": redact_secrets(e),
                }
            return
        try:
            if os.listdir(new_path):
                with self._move_lock:
                    self._move_state = {
                        "status": "error",
                        "moved": 0,
                        "total": total,
                        "error": "Cartella di destinazione non vuota",
                    }
                return
        except Exception as e:
            with self._move_lock:
                self._move_state = {
                    "status": "error",
                    "moved": 0,
                    "total": total,
                    "error": redact_secrets(e),
                }
            return

        # Fast path: atomic rename (same filesystem).
        # Remove the empty stub we just created so rename can take its place.
        try:
            os.rmdir(new_path)
            os.rename(old_root, new_path)
            self._finish_move(new_path)
            with self._move_lock:
                self._move_state = {
                    "status": "done",
                    "moved": total,
                    "total": total,
                    "error": None,
                }
            return
        except OSError:
            # Cross-device link, or new_path reappeared, or other OS error.
            # Recreate the stub and fall through to item-by-item copy.
            os.makedirs(new_path, exist_ok=True)

        # Cross-device fallback: item-by-item.
        moved = 0
        error_msg: str | None = None
        failed_item: str | None = None
        for name in items:
            src = os.path.join(old_root, name)
            dst = os.path.join(new_path, name)
            try:
                _shutil.move(src, dst)
                moved += 1
                with self._move_lock:
                    self._move_state["moved"] = moved
            except Exception as e:
                error_msg = str(e)
                failed_item = name
                break

        # Always update SESSION_ROOT to new_path.  If the move was partial,
        # the app must scan new_path (not the half-emptied old_root) going
        # forward; the error message describes what remains at old_root.
        self._finish_move(new_path)

        if error_msg is not None:
            remaining = total - moved
            split_note = (
                f" {moved} sessioni spostate; {remaining} rimasta/e in {old_root}."
                if remaining > 0
                else ""
            )
            with self._move_lock:
                self._move_state = {
                    "status": "error",
                    "moved": moved,
                    "total": total,
                    "error": f"Errore spostamento {failed_item}: {error_msg}.{split_note}",
                }
            return

        try:
            os.rmdir(old_root)
        except Exception:
            pass
        with self._move_lock:
            self._move_state = {
                "status": "done",
                "moved": moved,
                "total": total,
                "error": None,
            }

    def _finish_move(self, new_path: str) -> None:
        """Persist new SESSION_ROOT and invalidate all caches after a move."""
        set_session_root(new_path)
        try:
            save_session_root_to_config(new_path)
        except Exception:
            pass
        invalidate_session_storage_cache()
        with self._sessions_cache_lock:
            self._sessions_cache = None
            self._sessions_cache_gen += 1

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

    # ---- Console push helper ----

    def _push_console(self, msg: str):
        self._adapter.emit("appendConsole", redact_secrets(msg), batched=False)


# ---------------------------------------------------------------------------
# Re-exports for backward compatibility
# ---------------------------------------------------------------------------

from el_sbobinator.webview_entry import main

if __name__ == "__main__":
    main()
