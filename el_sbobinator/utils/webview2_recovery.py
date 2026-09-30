"""
WebView2 runtime detection, fallback recovery page, and lifecycle monitor.
"""

from __future__ import annotations

import os
import sys
import threading
from html import escape
from typing import Any


def _check_webview2_native() -> bool:
    """Check if pywebview or WebView2 .NET/COM loader detects a usable runtime."""
    try:
        import webview.platforms.winforms as wf

        if getattr(wf, "is_chromium", False):
            return True

        # If pywebview's initial probe missed the runtime, attempt to load edgechromium
        # directly and verify CoreWebView2Environment; wire it up so pywebview avoids MSHTML.
        try:
            from webview.platforms import edgechromium as Chromium

            env = getattr(Chromium, "CoreWebView2Environment", None)
            if env is not None and hasattr(env, "GetAvailableBrowserVersionString"):
                version = env.GetAvailableBrowserVersionString(None)
                if version and str(version).strip():
                    wf.Chromium = Chromium
                    wf.is_chromium = True
                    return True
        except Exception:
            pass
    except Exception:
        pass
    return False


def _check_webview2_registry() -> bool:
    """Check Windows registry across channels, scopes (HKCU/HKLM), and 32/64-bit views."""
    try:
        import winreg
    except Exception:
        return False

    guid_list = (
        "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",  # Evergreen Runtime
        "{2CD8A007-E189-409D-A2C8-9AF4EF3C72AA}",  # Beta
        "{0D50BFEC-CD6A-4F9A-964C-C7416E3ACB10}",  # Dev
        "{65C35B14-6C1D-4122-AC46-7148CC9D6497}",  # Canary
    )

    roots = (
        getattr(winreg, "HKEY_CURRENT_USER", 1),
        getattr(winreg, "HKEY_LOCAL_MACHINE", 2),
    )
    key_read = getattr(winreg, "KEY_READ", 0x20019)
    access_flags = [key_read]
    if hasattr(winreg, "KEY_WOW64_64KEY"):
        access_flags.append(key_read | winreg.KEY_WOW64_64KEY)
    if hasattr(winreg, "KEY_WOW64_32KEY"):
        access_flags.append(key_read | winreg.KEY_WOW64_32KEY)

    # 1. EdgeUpdate Clients and ClientState keys across all channels
    for root in roots:
        for guid in guid_list:
            for branch in (
                rf"SOFTWARE\Microsoft\EdgeUpdate\Clients\{guid}",
                rf"SOFTWARE\Microsoft\EdgeUpdate\ClientState\{guid}",
                rf"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{guid}",
                rf"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\ClientState\{guid}",
            ):
                for flag in access_flags:
                    try:
                        with winreg.OpenKey(root, branch, 0, flag) as key:
                            for val_name in ("pv", "version", "EBWebView"):
                                try:
                                    val, _ = winreg.QueryValueEx(key, val_name)
                                    if str(val).strip():
                                        return True
                                except Exception:
                                    continue
                    except Exception:
                        continue

    # 2. Windows Uninstall keys
    for root in roots:
        for branch in (
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Microsoft EdgeWebView",
            r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Microsoft EdgeWebView",
        ):
            for flag in access_flags:
                try:
                    with winreg.OpenKey(root, branch, 0, flag) as key:
                        for val_name in (
                            "DisplayVersion",
                            "Version",
                            "InstallLocation",
                        ):
                            try:
                                val, _ = winreg.QueryValueEx(key, val_name)
                                if str(val).strip():
                                    return True
                            except Exception:
                                continue
                except Exception:
                    continue

    return False


def _check_webview2_filesystem(extra_dirs: tuple[str, ...] | None = None) -> bool:
    """Verify if msedgewebview2.exe or EmbeddedBrowserWebView.dll exist in known folders."""
    base_dirs: list[str] = []
    if extra_dirs:
        base_dirs.extend(extra_dirs)
    else:
        for env_var in ("ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"):
            val = os.environ.get(env_var, "")
            if val:
                base_dirs.append(
                    os.path.join(val, "Microsoft", "EdgeWebView", "Application")
                )

    for base_dir in base_dirs:
        if not os.path.isdir(base_dir):
            continue
        try:
            for entry in os.scandir(base_dir):
                if entry.is_dir():
                    exe_path = os.path.join(entry.path, "msedgewebview2.exe")
                    if os.path.isfile(exe_path) and os.path.getsize(exe_path) > 0:
                        return True
                    for sub in ("x64", "x86", "arm64"):
                        dll_path = os.path.join(
                            entry.path, "EBWebView", sub, "EmbeddedBrowserWebView.dll"
                        )
                        if os.path.isfile(dll_path) and os.path.getsize(dll_path) > 0:
                            return True
        except Exception:
            continue
    return False


def has_webview2_runtime() -> bool:
    """Robust multi-tier detection for WebView2 Runtime on Windows.

    Checks:
    1. Native pywebview / CoreWebView2Environment loader
    2. Windows registry (all channels, scopes HKCU/HKLM, 32/64-bit views, Clients/ClientState/Uninstall)
    3. Filesystem existence in standard EdgeWebView application directories
    """
    if sys.platform != "win32":
        return True

    return (
        _check_webview2_native()
        or _check_webview2_registry()
        or _check_webview2_filesystem()
    )


def build_missing_webview2_html() -> str:
    """Generate HTML fallback error page shown when WebView2 is missing on Windows."""
    download_url = "https://go.microsoft.com/fwlink/p/?LinkId=2124703"
    repo_url = "https://developer.microsoft.com/en-us/microsoft-edge/webview2/"
    from el_sbobinator.services.config_service import get_config_dir

    log_path = os.path.join(get_config_dir(), "el_sbobinator.log")
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
        che non supporta la WebUI moderna. Senza WebView2 l&apos;applicazione non pu&ograve; caricare l&apos;interfaccia.
      </p>
      <p>
        Installa <strong>Microsoft Edge WebView2 Runtime</strong>
        per avviare l&apos;app normalmente.
      </p>
      <div class="actions">
        <a class="btn btn-primary" target="_blank" rel="noopener noreferrer" href="{escape(download_url)}">Scarica WebView2 Runtime</a>
        <a class="btn btn-secondary" target="_blank" rel="noopener noreferrer" href="{escape(repo_url)}">Dettagli tecnici</a>
      </div>
      <hr />
      <ol>
        <li>Clicca su <strong>Scarica WebView2 Runtime</strong> per scaricare l&apos;installer.</li>
        <li>Avvia il file scaricato e completa l&apos;installazione.</li>
        <li>El Sbobinator rileverà il completamento e si riavvierà automaticamente!</li>
      </ol>
      <p>Se il problema persiste, il log per l&apos;assistenza si trova qui:</p>
      <p><code style="word-break: break-all;">{escape(log_path)}</code></p>
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


def get_boot_bg_color() -> str:
    """Native background matching the HTML boot skeleton and CSS base (no flash)."""
    # Priority 1: explicit in-app preference (mirrors localStorage)
    try:
        from el_sbobinator.services.config_service import THEME_PREF_FILE

        with open(THEME_PREF_FILE, encoding="utf-8") as fh:
            pref = fh.read().strip()
        if pref == "dark":
            return "#191919"
        if pref == "light":
            return "#f7f6f3"
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
                return "#191919"  # dark  → matches --boot-bg dark & --bg-base dark
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
                return "#191919"
        except Exception:
            pass
    return "#f7f6f3"  # light (default)


def clear_webview2_cache(storage_dir: str, dist_path: str) -> None:
    """Auto cache-bust: clear WebView2 HTTP caches when a new build/version is detected."""
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


def start_webview2_monitor(window: Any, stop_event: threading.Event) -> None:
    """Start a background thread to poll for WebView2 installation when missing."""

    def _check_webview2_installation():
        import subprocess

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
