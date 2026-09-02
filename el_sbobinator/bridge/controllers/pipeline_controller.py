"""
Pipeline execution and cancellation IPC bridge controller.
"""

from __future__ import annotations

import os
import threading
import time
from typing import TYPE_CHECKING, ClassVar

from el_sbobinator.bridge.bridge_types import (
    BridgeFileItem,
    FileDonePayload,
    FileFailedPayload,
    LowDiskWarningPayload,
    ProcessDonePayload,
    SetCurrentFilePayload,
)
from el_sbobinator.bridge.bridge_utils import (
    _normalize_revision_failed_blocks,
    _path_under_root,
    _retry_no_failed_blocks_response,
    _retry_would_overwrite_user_html,
    _retry_zero_retried_response,
    _RetryRuntime,
    _safe_relpath,
    bridge_error,
    bridge_ok,
)
from el_sbobinator.core.session_store import (
    mark_html_exported,
    resolve_session_paths,
    save_session,
)
from el_sbobinator.core.shared import (
    DEFAULT_MODEL,
    _atomic_write_json,
    _load_json,
    cleanup_orphan_temp_chunks,
    get_session_root,
    invalidate_session_storage_cache,
)
from el_sbobinator.pipeline.pipeline_adapter import PipelineAdapter
from el_sbobinator.pipeline.pipeline_settings import (
    build_default_pipeline_settings,
    load_and_sanitize_settings,
)
from el_sbobinator.services.config_service import load_config, save_config
from el_sbobinator.utils.file_ops import evict_html_paths_under
from el_sbobinator.utils.logging_utils import redact_secrets

if TYPE_CHECKING:
    from collections import OrderedDict


class PipelineControllerMixin:
    """Mixin providing pipeline execution, cancellation, retry, and low disk IPC methods."""

    _retry_global_lock: ClassVar[threading.Lock] = threading.Lock()
    _retry_locks: ClassVar[dict[str, threading.Lock]] = {}
    _retry_locks_mutex: ClassVar[threading.Lock] = threading.Lock()

    if TYPE_CHECKING:
        _adapter: PipelineAdapter
        _processing_thread: threading.Thread | None
        _cancel_event: threading.Event
        _pipeline_lifecycle_lock: threading.Lock
        _retry_active_count: int
        _sessions_cache: dict | None
        _sessions_cache_gen: int
        _sessions_cache_lock: threading.Lock
        _text_cache: OrderedDict[str, tuple[float, str]]
        _text_cache_lock: threading.Lock

        def _get_session_root(self) -> str: ...
        def _push_console(self, msg: str) -> None: ...
        def _existing_html_for_session(
            self, session: dict, session_dir: str
        ) -> str | None: ...
        def _validate_processing_files(self, files: list) -> str | None: ...

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
            return bridge_error("Elaborazione in corso: riprova al termine.")
        retry_lock: threading.Lock | None = None
        retry_global_lock_acquired = False
        retry_lock_acquired = False
        _retry_count_incremented = False
        try:
            from el_sbobinator.services import revision_service

            abs_dir, session_path = self._resolve_retry_session(session_dir)

            retry_global_lock_acquired = self._retry_global_lock.acquire(blocking=False)
            if not retry_global_lock_acquired:
                return bridge_error("Retry gia' in corso: riprova al termine.")

            lock_key = os.path.normcase(abs_dir)
            with self._retry_locks_mutex:
                retry_lock = self._retry_locks.setdefault(lock_key, threading.Lock())
            retry_lock_acquired = retry_lock.acquire(blocking=False)
            if not retry_lock_acquired:
                return bridge_error("Retry gia' in corso per questa sessione.")
            with self._pipeline_lifecycle_lock:
                if self._adapter.is_running:
                    return bridge_error("Elaborazione in corso: riprova al termine.")
                self._retry_active_count += 1
            _retry_count_incremented = True

            session = _load_json(session_path)
            if not isinstance(session, dict) or session.get("stage") != "done":
                return bridge_error("Sessione non completata.")
            if _retry_would_overwrite_user_html(
                session, self._existing_html_for_session(session, abs_dir)
            ):
                return bridge_error(
                    "HTML modificato dall'utente: retry annullato per evitare sovrascritture.",
                    conflict=True,
                    session_dir=abs_dir,
                )
            failed_blocks = session.get("revision_failed_blocks", [])
            no_failed_blocks = _retry_no_failed_blocks_response(
                session, failed_blocks, abs_dir
            )
            if no_failed_blocks is not None:
                return no_failed_blocks

            cfg = load_config()
            api_key = str(cfg.get("api_key") or "").strip()
            if not api_key:
                return bridge_error("API key mancante: aggiungila nelle impostazioni.")

            retry_cancel_event = threading.Event()
            runtime = _RetryRuntime(self._adapter, retry_cancel_event)

            result = revision_service.execute_failed_blocks_retry_workflow(
                session=session,
                session_path=session_path,
                session_dir=abs_dir,
                api_key=api_key,
                runtime=runtime,
                retry_cancel_event=retry_cancel_event,
                on_push_completion_status=self._push_retry_completion_status,
            )

            html_path = result.get("html_path")
            if html_path:
                with self._text_cache_lock:
                    self._text_cache.pop(html_path, None)
            with self._sessions_cache_lock:
                self._sessions_cache = None
                self._sessions_cache_gen += 1

            return result
        except Exception as e:
            return bridge_error(e)
        finally:
            if _retry_count_incremented:
                with self._pipeline_lifecycle_lock:
                    self._retry_active_count -= 1
            if retry_lock is not None and retry_lock_acquired:
                retry_lock.release()
            if retry_global_lock_acquired:
                self._retry_global_lock.release()

    def _start_processing_guard(self, mark_running: bool = False) -> dict | None:
        with self._pipeline_lifecycle_lock:
            if self._adapter.is_running:
                return bridge_error("Elaborazione già in corso")
            if self._retry_active_count > 0:
                return bridge_error("Retry in corso: riprova al termine.")
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
        return bridge_error(
            "Spazio libero insufficiente.", low_disk_warning=low_disk_warning
        )

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
            return bridge_error(validation_error)
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
            return bridge_error("File o API key mancanti")
        start_error = self._prepare_start_processing(
            files,
            api_key,
            preferred_model,
            fallback_models,
            override_low_disk,
        )
        if start_error is not None:
            return start_error

        try:
            removed = cleanup_orphan_temp_chunks()
            if removed > 0:
                self._push_console(f"[*] Pulizia: rimossi {removed} file temporanei.")
        except Exception:
            pass

        self._cancel_event.clear()
        self._adapter.file_temporanei = []
        self._adapter._run_started_monotonic = time.monotonic()
        self._adapter._step_times = {}
        self._adapter.reset_run_state(api_key)

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
                                self._emit_api_usage()
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
                self._emit_api_usage()

        self._processing_thread = threading.Thread(target=_run, daemon=True)
        self._processing_thread.start()
        return bridge_ok()

    def answer_regenerate(self, regenerate: bool | None) -> dict:
        """Called by React when user clicks Use Saved or Regenerate."""
        self._adapter.answer_regenerate(regenerate)
        return bridge_ok()

    def answer_new_key(self, key: str | None) -> dict:
        """Called by React when user submits a replacement API key."""
        self._adapter.answer_new_key(key or "")
        return bridge_ok()

    def _emit_api_usage(self) -> None:
        try:
            from el_sbobinator.services.config_service import load_config
            from el_sbobinator.services.usage_service import get_daily_usage

            cfg = load_config()
            usage = get_daily_usage(
                primary_key=cfg.get("api_key"),
                fallback_keys=cfg.get("fallback_keys", []),
                primary_model=cfg.get("preferred_model", "gemini-2.5-flash"),
                fallback_models=cfg.get("fallback_models", []),
            )
            self._adapter.emit("apiUsageUpdated", usage, batched=False)
        except Exception:
            pass

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
        return bridge_ok()
