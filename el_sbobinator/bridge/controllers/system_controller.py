"""
System integration IPC bridge controller.
"""

from __future__ import annotations

import os
from typing import TYPE_CHECKING

import webview

from el_sbobinator.bridge.bridge_utils import (
    _ALLOWED_URL_PREFIXES,
    _path_under_root,
    bridge_error,
    bridge_ok,
)
from el_sbobinator.services import config_service
from el_sbobinator.utils import file_ops
from el_sbobinator.utils.logging_utils import redact_secrets

if TYPE_CHECKING:
    import logging

    from el_sbobinator.pipeline.pipeline_adapter import PipelineAdapter


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
            return bridge_ok(result=result)
        except Exception as e:
            self._logger.exception("Validazione ambiente fallita.")
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

    def send_collaboration_signal(self, room: str, payload: str) -> dict:
        """Relay a collaboration room signal/update across all local pywebview windows on the desktop for instant zero-latency testing."""
        if not room or not payload:
            return bridge_error("Parametri non validi")
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
        return bridge_ok()
