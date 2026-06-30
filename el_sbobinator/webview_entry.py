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
from html import escape
from typing import Any

import webview

from el_sbobinator.core.media_server import LocalMediaServer

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
            line = text.rstrip()
            if len(line) > _MAX_CONSOLE_LINE_LEN:
                line = line[:_MAX_CONSOLE_LINE_LEN] + "… [troncato]"
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


def has_webview2_runtime() -> bool:
    """Mirror pywebview's Windows runtime detection to avoid silent MSHTML fallback."""
    if sys.platform != "win32":
        return True

    try:
        import winreg
    except Exception:
        return False

    runtime_keys = (
        (
            winreg.HKEY_CURRENT_USER,
            r"SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
        ),
        (
            winreg.HKEY_LOCAL_MACHINE,
            r"SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
        ),
        (
            winreg.HKEY_LOCAL_MACHINE,
            r"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
        ),
    )

    for root, key_path in runtime_keys:
        try:
            with winreg.OpenKey(root, key_path) as key:
                version, _ = winreg.QueryValueEx(key, "pv")
                if str(version).strip():
                    return True
        except Exception:
            continue

    return False


def build_missing_webview2_html() -> str:
    download_url = "https://go.microsoft.com/fwlink/p/?LinkId=2124703"
    repo_url = "https://developer.microsoft.com/en-us/microsoft-edge/webview2/"
    return f"""<!doctype html>
<html lang="it">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="X-UA-Compatible" content="IE=11" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>El Sbobinator</title>
    <style>
      body {{
        margin: 0;
        padding: 40px 20px;
        background: #f0f2f5;
        font-family: "Segoe UI", Arial, sans-serif;
        color: #222;
      }}
      .card {{
        max-width: 560px;
        margin: 20px auto;
        background: #ffffff;
        border: 1px solid #dde1e7;
        border-radius: 10px;
        padding: 36px 40px;
        box-shadow: 0 2px 12px rgba(0,0,0,0.08);
      }}
      h1 {{
        margin: 0 0 14px;
        font-size: 20px;
        font-weight: 700;
        color: #111;
        line-height: 1.3;
      }}
      p {{
        margin: 0 0 10px;
        font-size: 14px;
        line-height: 1.65;
        color: #555;
      }}
      code {{
        background: #eef0f3;
        padding: 2px 7px;
        border-radius: 5px;
        font-family: Consolas, monospace;
        font-size: 12.5px;
        color: #333;
      }}
      strong {{ color: #222; }}
      .actions {{
        margin: 22px 0 18px;
      }}
      a.btn {{
        display: inline-block;
        padding: 9px 18px;
        border-radius: 6px;
        font-size: 13.5px;
        font-weight: 600;
        text-decoration: none;
        margin-right: 8px;
      }}
      a.btn-primary {{
        background: #0f62fe;
        color: #ffffff;
        border: 1px solid #0f62fe;
      }}
      a.btn-secondary {{
        background: #ffffff;
        color: #0f62fe;
        border: 1px solid #c6d0e3;
      }}
      hr {{
        border: none;
        border-top: 1px solid #eef0f3;
        margin: 20px 0;
      }}
      ol {{
        margin: 0;
        padding-left: 22px;
        color: #666;
      }}
      li {{
        font-size: 13.5px;
        line-height: 1.75;
        margin: 4px 0;
      }}
      .status-box {{
        margin-top: 20px;
        padding: 10px 15px;
        background: #fffbe6;
        border: 1px solid #ffe58f;
        border-radius: 6px;
        font-size: 13.0px;
        color: #d46b08;
      }}
      @keyframes status-pulse {{
        0% {{
          opacity: 0.4;
          transform: scale(0.9);
        }}
        50% {{
          opacity: 1;
          transform: scale(1.1);
        }}
        100% {{
          opacity: 0.4;
          transform: scale(0.9);
        }}
      }}
      .status-dot {{
        display: inline-block;
        width: 8px;
        height: 8px;
        background-color: #faad14;
        border-radius: 50%;
        margin-right: 8px;
        vertical-align: middle;
        animation: status-pulse 1.8s infinite ease-in-out;
      }}
      .status-msg {{
        vertical-align: middle;
        font-weight: 600;
      }}
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Serve WebView2 per avviare l&apos;interfaccia</h1>
      <p>
        El Sbobinator sta usando il renderer Windows legacy <code>MSHTML</code>,
        che non supporta la WebUI moderna. Per questo la finestra rimane nera.
      </p>
      <p>
        Installa <strong>Microsoft Edge WebView2 Runtime</strong>
        per avviare l&apos;app normalmente.
      </p>
      <div class="actions">
        <a class="btn btn-primary" href="{escape(download_url)}">Scarica WebView2 Runtime</a>
        <a class="btn btn-secondary" href="{escape(repo_url)}">Dettagli tecnici</a>
      </div>
      <hr />
      <ol>
        <li>Clicca su <strong>Scarica WebView2 Runtime</strong> per scaricare l&apos;installer.</li>
        <li>Avvia il file scaricato e completa l&apos;installazione.</li>
        <li>El Sbobinator rileverà il completamento e si riavvierà automaticamente!</li>
      </ol>
      <div id="status-box" class="status-box">
        <span id="status-dot" class="status-dot"></span>
        <span id="status-msg" class="status-msg">Verifica dello stato di WebView2 in corso...</span>
      </div>
    </div>
    <script>
      setTimeout(function() {{
        var box = document.getElementById('status-box');
        var dot = document.getElementById('status-dot');
        var msg = document.getElementById('status-msg');
        if (box && dot && msg) {{
          box.style.background = '#fffbe6';
          box.style.borderColor = '#ffe58f';
          box.style.color = '#d46b08';
          dot.style.backgroundColor = '#faad14';
          msg.innerHTML = 'In attesa dell&apos;installazione di WebView2...';
        }}
      }}, 500);
    </script>
  </body>
</html>
"""


def _boot_bg_color() -> str:
    """Native background matching the HTML boot skeleton (no flash).

    Resolution order (mirrors index.html inline script):
      1. theme_pref.txt — written by save_theme_preference() whenever the user
         toggles the theme inside the app.  Equivalent to localStorage step.
      2. OS-level signal (registry / defaults).  Equivalent to prefers-color-scheme step.
    """
    # Priority 1: explicit in-app preference (mirrors localStorage)
    try:
        from el_sbobinator.services.config_service import THEME_PREF_FILE

        with open(THEME_PREF_FILE, encoding="utf-8") as fh:
            pref = fh.read().strip()
        if pref == "dark":
            return "#0f1115"
        if pref == "light":
            return "#f3f4f6"
    except Exception:
        pass
    # Priority 2: OS-level signal
    if sys.platform == "win32":
        try:
            import winreg

            with winreg.OpenKey(
                winreg.HKEY_CURRENT_USER,
                r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize",
            ) as key:
                value, _ = winreg.QueryValueEx(key, "AppsUseLightTheme")
            if value == 0:
                return "#0f1115"  # dark  → matches --boot-bg dark
        except Exception:
            pass
    elif sys.platform == "darwin":
        try:
            import subprocess

            result = subprocess.run(
                ["defaults", "read", "-g", "AppleInterfaceStyle"],
                capture_output=True,
                text=True,
                timeout=0.5,
            )
            if result.stdout.strip().lower() == "dark":
                return "#0f1115"
        except Exception:
            pass
    return "#f3f4f6"  # light (default)


def _clear_webview2_cache(storage_dir: str, dist_path: str) -> None:
    """Auto cache-bust: clear WebView2 HTTP caches when a new build/version is detected.

    In onefile PyInstaller mode the extracted files get a new mtime on every launch
    (new _MEI temp folder), so we use the EXE's own mtime instead — stable until the
    user installs a new version.
    IMPORTANT: only delete Cache dirs, NOT the full EBWebView profile — doing so would
    destroy localStorage (queue, editor sessions) on every restart.
    """
    try:
        import shutil

        mtime_file = os.path.join(storage_dir, ".build_mtime")
        if getattr(sys, "frozen", False):
            current_mtime = str(os.path.getmtime(sys.executable))
        else:
            current_mtime = str(os.path.getmtime(dist_path))
        stored_mtime = ""
        if os.path.exists(mtime_file):
            with open(mtime_file, encoding="utf-8") as _f:
                stored_mtime = _f.read().strip()
        if stored_mtime != current_mtime:
            default_profile = os.path.join(storage_dir, "EBWebView", "Default")
            _cleared = False
            _failed = False
            for cache_name in ("Cache", "Code Cache"):
                cache_dir = os.path.join(default_profile, cache_name)
                if os.path.exists(cache_dir):
                    try:
                        shutil.rmtree(cache_dir)
                        _cleared = True
                    except Exception as _e:
                        _failed = True
                        print(
                            f"[!] Impossibile svuotare cache WebView2 ({cache_name}): {_e}"
                        )
            if _cleared:
                print("[*] Cache WebView2 svuotata (nuova build rilevata).")
            if not _failed:
                with open(mtime_file, "w", encoding="utf-8") as _f:
                    _f.write(current_mtime)
    except Exception:
        pass


def _get_window_position(win_w: int, win_h: int) -> dict[str, Any]:
    """Center the window on screen (Windows only; other platforms let pywebview center by default)."""
    center_x: int | None = None
    center_y: int | None = None
    if sys.platform == "win32":
        try:
            import ctypes

            scr_w = ctypes.windll.user32.GetSystemMetrics(0)
            scr_h = ctypes.windll.user32.GetSystemMetrics(1)
            center_x = max(0, (scr_w - win_w) // 2)
            center_y = max(0, (scr_h - win_h) // 2)
        except Exception:
            center_x, center_y = 100, 50

    if center_x is not None and center_y is not None:
        return {"x": center_x, "y": center_y}
    return {}


def _start_webview2_monitor(window, stop_event: threading.Event) -> None:
    """Start a background thread to poll for WebView2 installation when missing."""

    def _check_webview2_installation():
        import os
        import subprocess
        import sys

        while not stop_event.is_set():
            if stop_event.wait(1.5):
                break

            if has_webview2_runtime():
                print("[*] WebView2 Runtime rilevato! Eseguo il riavvio...")
                js_code = """
                var box = document.getElementById('status-box');
                var dot = document.getElementById('status-dot');
                var msg = document.getElementById('status-msg');
                if (box && dot && msg) {
                    box.style.background = '#f6ffed';
                    box.style.borderColor = '#b7eb8f';
                    box.style.color = '#389e0d';
                    dot.style.backgroundColor = '#52c41a';
                    msg.innerHTML = 'Rilevato! Riavvio dell\\'app in corso...';
                }
                """
                try:
                    window.evaluate_js(js_code)
                except Exception:
                    pass

                stop_event.wait(2.0)
                if stop_event.is_set():
                    return

                if getattr(sys, "frozen", False):
                    args = [sys.executable, *sys.argv[1:]]
                else:
                    args = [sys.executable, *sys.argv] if sys.argv else [sys.executable]

                try:
                    subprocess.Popen(args)
                except Exception as e:
                    print(f"[!] Errore nel riavvio automatico: {e}")

                try:
                    window.destroy()
                except Exception:
                    pass
                os._exit(0)

    t = threading.Thread(target=_check_webview2_installation, daemon=True)
    t.start()


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
        )

        stop_event = threading.Event()
        _start_webview2_monitor(window, stop_event)

    api.set_window(window)

    def _on_closing():
        if stop_event is not None:
            stop_event.set()
        LocalMediaServer.shutdown_all()

    window.events.closing += _on_closing

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
