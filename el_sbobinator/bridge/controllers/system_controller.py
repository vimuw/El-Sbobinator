"""
System integration IPC bridge controller.
"""

from __future__ import annotations

import os
import sys
from typing import TYPE_CHECKING

import webview

from el_sbobinator.bridge.bridge_utils import (
    _ALLOWED_URL_PREFIXES,
    _path_under_root,
    bridge_error,
    bridge_ok,
)
from el_sbobinator.core.model_registry import DEFAULT_MODEL
from el_sbobinator.services import config_service
from el_sbobinator.utils import file_ops
from el_sbobinator.utils.logging_utils import redact_secrets

if TYPE_CHECKING:
    import logging

    from el_sbobinator.pipeline.pipeline_adapter import PipelineAdapter


def _truncate_notification_text(text: str, max_units: int) -> str:
    """Fit Windows WCHAR buffers, reserving the caller's terminator space."""
    if sum(2 if ord(char) > 0xFFFF else 1 for char in text) <= max_units:
        return text
    units = 0
    end = 0
    for char in text:
        width = 2 if ord(char) > 0xFFFF else 1
        if units + width > max_units - 1:
            break
        units += width
        end += 1
    return text[:end] + "…"


class SystemControllerMixin:
    """Mixin providing system integration IPC methods."""

    if TYPE_CHECKING:
        _logger: logging.Logger
        _adapter: PipelineAdapter

        def _get_session_root(self) -> str: ...

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

            result = _validate_env(
                api_key=api_key,
                validate_api_key=bool(check_api_key),
                preferred_model=preferred_model,
                fallback_models=fallback_models,
            )
            from el_sbobinator.services.diagnostics_service import (
                save_validation_snapshot,
            )

            save_validation_snapshot(result)
            return bridge_ok(result=result)
        except Exception as e:
            self._logger.exception("Validazione ambiente fallita.")
            return bridge_error(e)

    def get_api_usage(
        self,
        api_key: str | None = None,
        fallback_keys: list[str] | None = None,
        preferred_model: str | None = None,
        fallback_models: list[str] | None = None,
        force_refresh: bool = False,
    ) -> dict:
        """Get daily Gemini API request usage and quota stats per key and per model."""
        try:
            from el_sbobinator.services.config_service import load_config
            from el_sbobinator.services.usage_service import get_daily_usage

            cfg = load_config()
            key_val = api_key if api_key is not None else cfg.get("api_key")
            fb_keys = (
                fallback_keys
                if fallback_keys is not None
                else cfg.get("fallback_keys", [])
            )
            pref_model = preferred_model or cfg.get("preferred_model", DEFAULT_MODEL)
            fb_models = (
                fallback_models
                if fallback_models is not None
                else cfg.get("fallback_models", [])
            )

            usage = get_daily_usage(
                primary_key=key_val,
                fallback_keys=fb_keys,
                primary_model=pref_model,
                fallback_models=fb_models,
                force_refresh=force_refresh,
            )
            return bridge_ok(result=usage)
        except Exception as e:
            self._logger.exception("Recupero quote API fallito.")
            return bridge_error(e)

    def get_diagnostic_report(
        self,
        api_key: str | None = None,
        fallback_keys: list[str] | None = None,
        preferred_model: str | None = None,
        fallback_models: list[str] | None = None,
        session_dir: str | None = None,
        frontend_version: str | None = None,
    ) -> dict:
        """Keep legacy arguments compatible; collect support data locally."""
        try:
            from el_sbobinator.services.diagnostics_service import collect_files

            files = collect_files(
                self._get_session_root(), session_dir, frontend_version
            )
            return bridge_ok(report=files["report.md"])
        except Exception as exc:
            self._logger.exception("Generazione report diagnostico fallita.")
            return bridge_error(exc)

    def list_diagnostic_sessions(self) -> dict:
        try:
            from el_sbobinator.services.diagnostics_service import list_sessions

            return bridge_ok(sessions=list_sessions(self._get_session_root()))
        except Exception as exc:
            return bridge_error(exc)

    def export_diagnostics(
        self, session_dir: str | None = None, frontend_version: str | None = None
    ) -> dict:
        try:
            from el_sbobinator.services.diagnostics_service import (
                collect_files,
                export_bundle,
            )

            files = collect_files(
                self._get_session_root(), session_dir, frontend_version
            )
            window = getattr(self, "_window", None)
            if not window:
                return bridge_error("Esportazione disponibile nell'app desktop.")
            selected = window.create_file_dialog(
                webview.SAVE_DIALOG,
                save_filename="El-Sbobinator-diagnostica.zip",
                file_types=("Diagnostica (*.zip)",),
            )
            if not selected:
                return bridge_ok(cancelled=True)
            target = str(
                selected[0] if isinstance(selected, list | tuple) else selected
            )
            return bridge_ok(target_path=export_bundle(target, files))
        except Exception as exc:
            self._logger.exception("Esportazione diagnostica fallita.")
            return bridge_error(exc)

    def record_frontend_event(
        self, kind: str, message: str = "", stack: str = ""
    ) -> dict:
        if kind not in ("ready", "error", "unhandledrejection", "react"):
            return bridge_error("Evento diagnostico non supportato.")
        if not isinstance(message, str) or not isinstance(stack, str):
            return bridge_error("Evento diagnostico non valido.")
        from el_sbobinator.utils.logging_utils import (
            BOOT_ID,
            get_startup_diagnostic,
            record_incident,
            record_startup_diagnostic,
        )

        if kind == "ready":
            snapshot = get_startup_diagnostic()
            if (
                snapshot.get("boot_id") != BOOT_ID
                or snapshot.get("status") == "ui_ready"
            ):
                return bridge_ok()
            record_startup_diagnostic(**{**snapshot, "status": "ui_ready"})
        else:
            record_incident("frontend." + kind, message[:3000], stack[:6000])
        return bridge_ok()

    def open_logs_folder(self) -> dict:
        """Open the local logs directory in the default system file manager."""
        try:
            from el_sbobinator.services.config_service import get_config_dir

            log_dir = get_config_dir()
            os.makedirs(log_dir, exist_ok=True)
            file_ops.open_path_with_default_app(log_dir)
            return bridge_ok()
        except Exception as e:
            self._logger.exception("Apertura cartella log fallita.")
            return bridge_error(e)

    def open_file(self, path: str) -> dict:
        """Open a local file/folder with the system default handler."""
        if not isinstance(path, str):
            return bridge_error("Path non valido: deve essere una stringa.")
        if path.lower().startswith(("http://", "https://")):
            return bridge_error("Usa open_url per aprire URL.")
        try:
            real_path = os.path.realpath(path)
            allowed_roots = [
                os.path.realpath(
                    config_service.get_desktop_dir()
                ),  # Desktop / OneDrive Desktop
                os.path.realpath(self._get_session_root()),  # Session storage
            ]
            path_is_allowed = any(
                _path_under_root(real_path, root) for root in allowed_roots
            )
            if not path_is_allowed:
                return bridge_error(
                    "Accesso negato: path fuori dai percorsi consentiti."
                )
            file_ops.open_path_with_default_app(real_path)
            return bridge_ok()
        except Exception as e:
            return bridge_error(e)

    def open_url(self, url: str) -> dict:
        """Open an external URL in the system browser (allowlist only)."""
        if not isinstance(url, str) or not any(
            url.startswith(p) for p in _ALLOWED_URL_PREFIXES
        ):
            return bridge_error("URL non consentito.")
        try:
            file_ops.open_path_with_default_app(url)
            return bridge_ok()
        except Exception as e:
            return bridge_error(e)

    def flash_window(self) -> dict:
        """Fa lampeggiare l'icona dell'applicazione nella barra delle applicazioni per attirare l'attenzione dell'utente."""
        try:
            import sys

            if sys.platform == "win32":
                from el_sbobinator.utils.win32_window_utils import (
                    flash_window,
                    get_window_hwnd,
                )

                window = getattr(self, "_window", None)
                hwnd = get_window_hwnd(window)
                if hwnd:
                    flash_window(hwnd)
                return bridge_ok()
            elif sys.platform == "darwin":
                try:
                    from AppKit import NSApplication, NSCriticalRequest  # type: ignore

                    NSApplication.sharedApplication().requestUserAttention_(
                        NSCriticalRequest
                    )
                    return bridge_ok()
                except Exception:
                    pass
            return bridge_ok()
        except Exception as e:
            return bridge_error(e)

    def show_notification(self, title: str, message: str) -> dict:
        """Mostra una notifica toast nativa di sistema tramite plyer e attiva il lampeggio taskbar."""
        try:
            self.flash_window()
        except Exception:
            pass
        try:
            from plyer import notification

            if sys.platform == "win32":
                title = _truncate_notification_text(title, 63)
                message = _truncate_notification_text(message, 255)

            # On windows, notify requires an absolute path to a .ico file if we want an icon.
            # We'll omit the app_icon for simplicity and cross-platform compatibility.
            notification.notify(  # type: ignore[operator]
                title=title, message=message, app_name="El Sbobinator", timeout=5
            )
            return bridge_ok()
        except Exception as e:
            return bridge_error(e)

    def download_and_install_update(self, version: str) -> dict:
        """Download the correct installer for this OS, launch it, then quit the app."""
        from el_sbobinator.core.updater import (
            download_and_install_update as _download_and_install_update,
        )

        return _download_and_install_update(version, emit_fn=self._adapter.emit)
