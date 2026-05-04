"""
Auto-update logic for El Sbobinator.

Downloads the platform-appropriate release asset from GitHub, launches the
installer (Windows) or mounts + copies the DMG (macOS), then schedules
a short-delay quit so the webview window closes cleanly.
"""

from __future__ import annotations

import hashlib
import logging
import os
import plistlib
import re
import ssl
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request

import certifi


def _verify_sha256(
    tmp_path: str, checksum_url: str, ssl_ctx: ssl.SSLContext
) -> str | None:
    """Download checksum file and verify tmp_path hash. Returns error string or None on success."""
    try:
        with urllib.request.urlopen(checksum_url, timeout=30, context=ssl_ctx) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            logging.getLogger(__name__).warning(
                "SHA-256 checksum file not found for this release (404) — skipping integrity check."
            )
            return None
        return f"Download checksum fallito: {e}"
    except Exception as e:
        return f"Download checksum fallito: {e}"

    parts = raw.split()
    if not parts:
        return "File checksum vuoto o malformato."
    expected = parts[0].lower()
    if not re.fullmatch(r"[0-9a-f]{64}", expected):
        return "Checksum SHA-256 non valido nel file di verifica."

    sha256 = hashlib.sha256()
    try:
        with open(tmp_path, "rb") as fh:
            while True:
                chunk = fh.read(65536)
                if not chunk:
                    break
                sha256.update(chunk)
    except OSError as e:
        return f"Lettura file temporaneo fallita: {e}"
    actual = sha256.hexdigest()

    if actual != expected:
        return "Verifica integrit\u00e0 fallita: il file scaricato non corrisponde al checksum atteso."
    return None


def _launch_windows_installer(tmp_path: str) -> None:
    """Launch the Windows installer EXE and schedule temp-file cleanup."""
    os.startfile(tmp_path)  # type: ignore[attr-defined]

    def _cleanup(path: str) -> None:
        for _ in range(3):
            time.sleep(5)
            try:
                os.unlink(path)
                return
            except PermissionError:
                pass
            except OSError:
                return

    threading.Thread(target=_cleanup, args=(tmp_path,), daemon=True).start()


def _install_macos_dmg(tmp_path: str) -> dict | None:
    """Mount DMG, copy app to /Applications, detach. Returns error dict or None on success."""
    try:
        result = subprocess.run(
            ["hdiutil", "attach", "-nobrowse", "-plist", tmp_path],
            capture_output=True,
            check=True,
            timeout=30,
        )
        plist = plistlib.loads(result.stdout)
        mount_point = None
        for entity in plist.get("system-entities", []):
            mp = entity.get("mount-point")
            if mp:
                mount_point = mp
                break
        if not mount_point:
            return {"ok": False, "error": "Impossibile montare il DMG."}
        try:
            app_src = os.path.join(mount_point, "El Sbobinator.app")
            app_dst = "/Applications/El Sbobinator.app"
            try:
                subprocess.run(
                    ["cp", "-R", app_src, app_dst],
                    check=True,
                    timeout=30,
                    capture_output=True,
                )
            except subprocess.CalledProcessError as cp_err:
                stderr = (
                    cp_err.stderr.decode("utf-8", errors="replace")
                    if cp_err.stderr
                    else ""
                )
                if "Permission denied" in stderr or "Operation not permitted" in stderr:
                    raise PermissionError(stderr) from cp_err
                raise
            subprocess.run(
                ["xattr", "-dr", "com.apple.quarantine", app_dst],
                check=False,
                timeout=30,
            )
        finally:
            subprocess.run(["hdiutil", "detach", mount_point], check=False, timeout=30)
        subprocess.Popen(["open", "/Applications/El Sbobinator.app"])
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
    return None


def download_and_install_update(version: str) -> dict:
    """Download the correct installer for this OS, launch it, then quit the app."""
    if not isinstance(version, str) or not re.fullmatch(r"v?\d+\.\d+\.\d+", version):
        return {"ok": False, "error": "Versione non valida."}

    version_clean = version.lstrip("v")

    if sys.platform == "win32":
        filename = f"El-Sbobinator-Setup-v{version_clean}.exe"
        suffix = ".exe"
    elif sys.platform == "darwin":
        filename = f"El-Sbobinator-v{version_clean}.dmg"
        suffix = ".dmg"
    else:
        return {"ok": False, "error": f"Piattaforma non supportata: {sys.platform}"}

    url = f"https://github.com/vimuw/El-Sbobinator/releases/download/v{version_clean}/{filename}"

    try:
        _ssl_ctx = ssl.create_default_context(cafile=certifi.where())
    except Exception as e:
        return {"ok": False, "error": f"Configurazione SSL fallita: {e}"}
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp_path = tmp.name
        with urllib.request.urlopen(url, timeout=120, context=_ssl_ctx) as resp:
            with open(tmp_path, "wb") as fh:
                while True:
                    chunk = resp.read(65536)
                    if not chunk:
                        break
                    fh.write(chunk)
    except Exception as e:
        return {"ok": False, "error": f"Download fallito: {e}"}

    integrity_error = _verify_sha256(tmp_path, url + ".sha256", _ssl_ctx)
    if integrity_error:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        return {"ok": False, "error": integrity_error}

    try:
        if sys.platform == "win32":
            _launch_windows_installer(tmp_path)
        else:
            err = _install_macos_dmg(tmp_path)
            if err is not None:
                return err
    except PermissionError:
        return {"ok": False, "error": "permission_denied"}
    except Exception as e:
        return {"ok": False, "error": f"Installazione fallita: {e}"}

    def _delayed_destroy() -> None:
        time.sleep(0.8)
        try:
            import webview  # type: ignore

            if webview.windows:
                webview.windows[0].destroy()
        except Exception:
            pass

    threading.Thread(target=_delayed_destroy, daemon=True).start()
    return {"ok": True}
