"""
Application entry point for El Sbobinator (pywebview).

Contains: _ConsoleTee, get_dist_path(), has_webview2_runtime(),
build_missing_webview2_html(), and main().
"""

from __future__ import annotations

import os
import sys
import threading
import warnings
from collections.abc import Callable
from typing import TYPE_CHECKING, Any

import webview

from el_sbobinator.core.media_server import LocalMediaServer
from el_sbobinator.utils.logging_utils import redact_secrets
from el_sbobinator.utils.webview2_recovery import (
    build_missing_webview2_html,
    clear_webview2_cache,
    get_boot_bg_color,
    has_webview2_runtime,
    start_webview2_monitor,
)
from el_sbobinator.utils.win32_window_utils import (
    apply_windows_dark_mode,
    get_window_hwnd,
    get_window_position,
)

# Backward-compatibility aliases
_apply_windows_dark_mode = apply_windows_dark_mode
_get_window_hwnd = get_window_hwnd
_get_window_position = get_window_position
_boot_bg_color = get_boot_bg_color
_clear_webview2_cache = clear_webview2_cache
_start_webview2_monitor = start_webview2_monitor

# Suppress benign requests warning about chardet/charset_normalizer failing to import
warnings.filterwarnings(
    "ignore", message="Unable to find acceptable character detection dependency"
)

# ---------------------------------------------------------------------------
# Console interceptor
# ---------------------------------------------------------------------------

_MAX_CONSOLE_LINE_LEN = 2000


class _ConsoleTee:
    """Intercept print() calls and forward to React console too."""

    def __init__(self, original, api: ElSbobinatorApi):  # type: ignore[name-defined]  # noqa: F821
        self._original = original  # May be None for .pyw on Windows
        self._api = api

    def write(self, text):
        if self._original is not None:
            try:
                self._original.write(text)
            except Exception:
                pass
        if text and text.strip():
            line = redact_secrets(text.rstrip())
            if len(line) > _MAX_CONSOLE_LINE_LEN:
                line = line[:_MAX_CONSOLE_LINE_LEN] + "\u2026 [troncato]"
            self._api._push_console(line)

    def flush(self):
        if self._original is not None:
            try:
                self._original.flush()
            except Exception:
                pass


# ---------------------------------------------------------------------------
# Entry-point helpers
# ---------------------------------------------------------------------------


def get_dist_path() -> str:
    """Locate the webui dist folder (works both in dev and PyInstaller)."""
    if getattr(sys, "frozen", False):
        # PyInstaller bundle
        base = sys._MEIPASS  # type: ignore
    else:
        base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    dist = os.path.join(base, "webui", "dist", "index.html")
    if os.path.exists(dist):
        return dist
    # Fallback: relative to cwd
    alt = os.path.join(os.getcwd(), "webui", "dist", "index.html")
    if os.path.exists(alt):
        return alt
    raise FileNotFoundError(
        f"Non trovo webui/dist/index.html. Esegui 'npm run build' nella cartella webui/.\n"
        f"Cercato in: {dist} e {alt}"
    )


def build_close_handler(
    api: Any,
    window: webview.Window,
    stop_event: threading.Event | None = None,
) -> Callable[[], bool | None]:
    """Return a closing event handler that prompts for confirmation if busy."""

    def _on_closing() -> bool | None:
        if getattr(api, "_force_close", False):
            if stop_event is not None:
                stop_event.set()
            LocalMediaServer.shutdown_all()
            return None

        if getattr(api, "is_busy", lambda: False)():
            adapter = getattr(api, "_adapter", None)
            if adapter is not None and getattr(adapter, "window", None) is not None:
                try:
                    adapter.emit("requestQuitConfirmation", {}, batched=False)
                    return False
                except Exception:
                    pass

            # Fallback to native confirmation dialog if WebUI is not ready/available
            confirmed = False
            try:
                confirmed = bool(
                    window.create_confirmation_dialog(
                        "El Sbobinator - Elaborazione in corso",
                        "Un'elaborazione è attualmente in corso.\n\n"
                        "Se chiudi l'applicazione, l'elaborazione verrà interrotta e i progressi correnti potrebbero andare persi.\n\n"
                        "Vuoi davvero uscire?",
                    )
                )
            except Exception:
                confirmed = True

            if not confirmed:
                return False

            if hasattr(api, "request_shutdown"):
                try:
                    api.request_shutdown(timeout=1.5)
                except Exception:
                    pass

        if stop_event is not None:
            stop_event.set()
        LocalMediaServer.shutdown_all()
        return None

    return _on_closing


def main():
    from el_sbobinator.app_webview import ElSbobinatorApi

    api = ElSbobinatorApi()

    # Intercept stdout/stderr to forward to React console
    sys.stdout = _ConsoleTee(sys.__stdout__, api)
    sys.stderr = _ConsoleTee(sys.__stderr__, api)

    dist_path = get_dist_path()
    webview2_available = has_webview2_runtime()

    # Storage path for WebView2 profile cache (avoids re-init freeze)
    storage_dir = os.path.join(
        os.environ.get("LOCALAPPDATA", os.path.expanduser("~")),
        "El Sbobinator",
        "webview_cache",
    )
    os.makedirs(storage_dir, exist_ok=True)

    _clear_webview2_cache(storage_dir, dist_path)

    win_w, win_h = 900, 820
    _pos_kwargs = _get_window_position(win_w, win_h)

    stop_event: threading.Event | None = None

    if webview2_available:
        window = webview.create_window(
            "El Sbobinator",
            dist_path,
            js_api=api,
            width=win_w,
            height=win_h,
            **_pos_kwargs,
            min_size=(750, 620),
            background_color=_boot_bg_color(),
            maximized=True,
        )
    else:
        print(
            "[!] Microsoft Edge WebView2 Runtime non trovato. Mostro schermata di recupero."
        )
        window = webview.create_window(
            "El Sbobinator",
            html=build_missing_webview2_html(),
            width=win_w,
            height=win_h,
            **_pos_kwargs,
            min_size=(750, 620),
            background_color=_boot_bg_color(),
            maximized=True,
        )

        stop_event = threading.Event()
        _start_webview2_monitor(window, stop_event)

    api.set_window(window)

    def _on_shown():
        if sys.platform == "win32":
            hwnd = _get_window_hwnd(window)
            if hwnd:
                is_dark = _boot_bg_color() == "#191919"
                _apply_windows_dark_mode(hwnd, is_dark)

    window.events.shown += _on_shown

    window.events.closing += build_close_handler(api, window, stop_event)

    try:
        from webview.dom import _dnd_state

        _dnd_state["num_listeners"] += 1
    except Exception:
        pass

    webview.start(
        private_mode=False,
        storage_path=storage_dir,
        debug=False,
    )


if __name__ == "__main__":
    main()
