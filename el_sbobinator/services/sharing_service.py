"""
Sharing and Export/Import service for El Sbobinator.

Handles packaging sessions into compressed `.sbobina` archives (or zip files),
safe extraction and import into local storage, and preparing mail sharing.
"""

from __future__ import annotations

import json
import os
import shutil
import tempfile
import urllib.parse
import uuid
import zipfile
from typing import Literal

from el_sbobinator.core.shared import (
    _atomic_write_json,
    _load_json,
    _now_iso,
    _safe_mkdir,
)

MAX_FILE_COUNT = 500
MAX_TOTAL_UNCOMPRESSED_SIZE = 1500 * 1024 * 1024  # 1.5 GB


def _safe_zip_extract(zip_file: zipfile.ZipFile, target_dir: str) -> None:
    """Extract zip archive safely preventing zip-slip, symlinks, and resource exhaustion."""
    resolved_target = os.path.realpath(target_dir)
    infolist = zip_file.infolist()

    if len(infolist) > MAX_FILE_COUNT:
        raise ValueError(
            f"Archivio non valido: numero file ({len(infolist)}) supera il limite consentito ({MAX_FILE_COUNT})."
        )

    total_uncompressed_size = 0

    for member in infolist:
        # 1. Rifiuto Symlink (is_symlink() su Python 3.13+ o bitmask POSIX)
        is_symlink = False
        is_symlink_fn = getattr(member, "is_symlink", None)
        if callable(is_symlink_fn) and is_symlink_fn():
            is_symlink = True
        elif (member.external_attr >> 16) & 0o170000 == 0o120000:
            is_symlink = True

        if is_symlink:
            raise ValueError(
                f"Link simbolici non consentiti nel pacchetto: {member.filename}"
            )

        # 2. Controllo dimensione decompressa totale
        total_uncompressed_size += member.file_size
        if total_uncompressed_size > MAX_TOTAL_UNCOMPRESSED_SIZE:
            raise ValueError(
                "Dimensione decompressa totale eccede la soglia massima consentita."
            )

        # 3. Path Traversal Check
        destination_path = os.path.realpath(os.path.join(target_dir, member.filename))
        if (
            not destination_path.startswith(resolved_target + os.sep)
            and destination_path != resolved_target
        ):
            raise ValueError(
                f"Attacco Zip Slip rilevato per il file: {member.filename}"
            )

    zip_file.extractall(target_dir)


def find_audio_for_session(session_dir: str, session_data: dict) -> str | None:
    """Locate the source audio file for a session if it exists on disk."""
    input_data = session_data.get("input", {})
    if isinstance(input_data, dict):
        current_path = str(input_data.get("path", "") or "").strip()
        if current_path and os.path.isfile(current_path):
            return current_path

        # Check inside session directory (e.g. imported or copied audio)
        rel_path = input_data.get("path_rel_to_session")
        if rel_path:
            candidate = os.path.realpath(os.path.join(session_dir, str(rel_path)))
            if candidate.startswith(os.path.realpath(session_dir)) and os.path.isfile(
                candidate
            ):
                return candidate

    # Search for any audio file directly inside audio/ subdirectory or session_dir
    for candidate_dir in [os.path.join(session_dir, "audio"), session_dir]:
        if os.path.isdir(candidate_dir):
            for entry in os.listdir(candidate_dir):
                ext = os.path.splitext(entry)[1].lower()
                if ext in {
                    ".mp3",
                    ".m4a",
                    ".wav",
                    ".ogg",
                    ".flac",
                    ".aac",
                    ".mkv",
                    ".webm",
                }:
                    full_p = os.path.join(candidate_dir, entry)
                    if os.path.isfile(full_p):
                        return full_p
    return None


def create_sbobina_package(
    session_dir: str,
    target_zip_path: str,
    include_mode: Literal["full", "text_only", "audio_only"] = "full",
    audio_path_override: str | None = None,
) -> dict:
    """Pack a session into a `.sbobina` zip archive according to include_mode."""
    if not os.path.isdir(session_dir):
        return {"ok": False, "error": f"Cartella sessione non trovata: {session_dir}"}

    session_path = os.path.join(session_dir, "session.json")
    session_data = _load_json(session_path) if os.path.isfile(session_path) else {}

    audio_file = audio_path_override or find_audio_for_session(
        session_dir, session_data
    )
    audio_included = False

    if include_mode == "audio_only" and (
        not audio_file or not os.path.isfile(audio_file)
    ):
        return {"ok": False, "error": "File audio sorgente non trovato sul PC."}

    # Ensure parent dir of target_zip_path exists
    _safe_mkdir(os.path.dirname(os.path.abspath(target_zip_path)))

    session_name = session_data.get("input", {}).get("name") or os.path.basename(
        session_dir
    )
    if audio_file:
        session_name = os.path.basename(audio_file)

    manifest = {
        "app": "El Sbobinator",
        "version": 1,
        "created_at": _now_iso(),
        "include_mode": include_mode,
        "session_name": session_name,
        "audio_filename": os.path.basename(audio_file) if audio_file else None,
    }

    with zipfile.ZipFile(target_zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("manifest.json", json.dumps(manifest, indent=2, ensure_ascii=False))

        if include_mode in ("full", "text_only"):
            # Add session.json
            if os.path.isfile(session_path):
                zf.write(session_path, "session.json")

            # Add output HTML if available
            outputs = session_data.get("outputs", {})
            html_path = outputs.get("html") if isinstance(outputs, dict) else None
            if html_path and os.path.isfile(html_path):
                zf.write(html_path, "Sbobina.html")
            elif os.path.isfile(os.path.join(session_dir, "Sbobina.html")):
                zf.write(os.path.join(session_dir, "Sbobina.html"), "Sbobina.html")
            else:
                # Search for any *.html in session_dir
                for item in os.listdir(session_dir):
                    if item.endswith(".html") and os.path.isfile(
                        os.path.join(session_dir, item)
                    ):
                        zf.write(os.path.join(session_dir, item), "Sbobina.html")
                        break

            # Add macro blocks JSON
            macro_p = os.path.join(session_dir, "phase2_macro_blocks.json")
            if os.path.isfile(macro_p):
                zf.write(macro_p, "phase2_macro_blocks.json")

            # Add subdirectories phase1_chunks and phase2_revised
            for sub_dir in ["phase1_chunks", "phase2_revised"]:
                full_sub = os.path.join(session_dir, sub_dir)
                if os.path.isdir(full_sub):
                    for root, _dirs, files in os.walk(full_sub):
                        for f in files:
                            abs_f = os.path.join(root, f)
                            rel_f = os.path.relpath(abs_f, session_dir)
                            zf.write(abs_f, rel_f)

        if (
            include_mode in ("full", "audio_only")
            and audio_file
            and os.path.isfile(audio_file)
        ):
            audio_arcname = os.path.join("audio", os.path.basename(audio_file))
            zf.write(audio_file, audio_arcname)
            audio_included = True

    size_bytes = os.path.getsize(target_zip_path)
    return {
        "ok": True,
        "target_path": target_zip_path,
        "include_mode": include_mode,
        "audio_included": audio_included,
        "size_bytes": size_bytes,
    }


def unpack_and_import_package(package_path: str, session_root: str) -> dict:
    """Extract a `.sbobina` package into a new session directory inside session_root."""
    if not os.path.isfile(package_path):
        return {"ok": False, "error": f"File pacchetto non trovato: {package_path}"}

    if not zipfile.is_zipfile(package_path):
        return {
            "ok": False,
            "error": "Il file selezionato non è un pacchetto .sbobina valido (formato ZIP corrotto o errato).",
        }

    # Create a new unique session directory to prevent collisions
    session_id = f"imported_{uuid.uuid4().hex[:12]}"
    new_session_dir = os.path.join(session_root, session_id)
    _safe_mkdir(new_session_dir)

    try:
        with zipfile.ZipFile(package_path, "r") as zf:
            _safe_zip_extract(zf, new_session_dir)

        # Inspect manifest
        manifest_path = os.path.join(new_session_dir, "manifest.json")
        manifest = _load_json(manifest_path) if os.path.isfile(manifest_path) else {}

        session_path = os.path.join(new_session_dir, "session.json")
        session_data = _load_json(session_path) if os.path.isfile(session_path) else {}

        # Locate extracted audio
        audio_dir = os.path.join(new_session_dir, "audio")
        extracted_audio_path: str | None = None
        if os.path.isdir(audio_dir):
            for entry in os.listdir(audio_dir):
                candidate = os.path.join(audio_dir, entry)
                if os.path.isfile(candidate):
                    extracted_audio_path = candidate
                    break

        # Locate HTML output
        html_path = os.path.join(new_session_dir, "Sbobina.html")
        if not os.path.isfile(html_path):
            # Check for any .html in new_session_dir
            for entry in os.listdir(new_session_dir):
                if entry.endswith(".html"):
                    html_path = os.path.join(new_session_dir, entry)
                    break

        # Normalize session.json
        if not session_data:
            session_data = {
                "schema_version": 1,
                "created_at": _now_iso(),
                "updated_at": _now_iso(),
                "stage": "done",
                "input": {},
                "outputs": {},
            }

        session_data["stage"] = "done"
        session_data["updated_at"] = _now_iso()
        session_data["imported_at"] = _now_iso()

        if os.path.isfile(html_path):
            if "outputs" not in session_data or not isinstance(
                session_data["outputs"], dict
            ):
                session_data["outputs"] = {}
            session_data["outputs"]["html"] = html_path

        if extracted_audio_path and os.path.isfile(extracted_audio_path):
            if "input" not in session_data or not isinstance(
                session_data["input"], dict
            ):
                session_data["input"] = {}
            session_data["input"]["path"] = extracted_audio_path
            session_data["input"]["name"] = os.path.basename(extracted_audio_path)
            session_data["input"]["path_rel_to_session"] = os.path.relpath(
                extracted_audio_path, new_session_dir
            )
            try:
                session_data["input"]["size"] = os.path.getsize(extracted_audio_path)
            except Exception:
                pass
        else:
            # Se il pacchetto non contiene audio (es. text_only), azzeriamo i vecchi path del creatore
            if "input" in session_data and isinstance(session_data["input"], dict):
                session_data["input"]["path"] = None
                session_data["input"]["path_rel_to_session"] = None

        _atomic_write_json(session_path, session_data)

        session_name = (
            manifest.get("session_name")
            or session_data.get("input", {}).get("name")
            or (
                os.path.basename(html_path)
                if os.path.isfile(html_path)
                else "Sbobina Importata"
            )
        )

        return {
            "ok": True,
            "session_dir": new_session_dir,
            "name": session_name,
            "html_path": html_path if os.path.isfile(html_path) else None,
            "has_audio": bool(
                extracted_audio_path and os.path.isfile(extracted_audio_path)
            ),
        }

    except Exception as e:
        # Cleanup incomplete directory on failure
        shutil.rmtree(new_session_dir, ignore_errors=True)
        return {
            "ok": False,
            "error": f"Errore durante l'importazione del pacchetto: {e!s}",
        }


def prepare_email_share(
    session_dir: str,
    include_mode: Literal["full", "text_only", "audio_only"] = "full",
    recipient: str = "",
    mail_provider: Literal["system", "gmail"] = "system",
    target_dir: str | None = None,
) -> dict:
    """Generate package, prefill mailto or Gmail Web URL, and reveal output file for easy attachment."""
    if not os.path.isdir(session_dir):
        return {"ok": False, "error": "Cartella sessione non valida."}

    session_path = os.path.join(session_dir, "session.json")
    session_data = _load_json(session_path) if os.path.isfile(session_path) else {}

    titolo = session_data.get("input", {}).get("name") or os.path.basename(session_dir)
    nome_puro = os.path.splitext(titolo)[0]

    out_folder = target_dir or os.path.join(
        tempfile.gettempdir(), "el_sbobinator_exports"
    )
    _safe_mkdir(out_folder)
    if os.name == "posix":
        try:
            os.chmod(out_folder, 0o700)
        except OSError:
            pass

    target_zip = os.path.join(out_folder, f"{nome_puro}_Sbobina.sbobina")

    pkg_res = create_sbobina_package(session_dir, target_zip, include_mode=include_mode)
    if not pkg_res.get("ok"):
        return pkg_res

    subject = f"Sbobina: {nome_puro}"
    body = (
        f"Ciao!\n\n"
        f"Ti invio la sbobina '{nome_puro}' prodotta con El Sbobinator.\n\n"
        f"In allegato trovi il pacchetto .sbobina da importare nell'app."
    )

    quoted_rec = urllib.parse.quote(recipient)
    quoted_sub = urllib.parse.quote(subject)
    quoted_body = urllib.parse.quote(body)

    if mail_provider == "gmail":
        mail_url = f"https://mail.google.com/mail/?view=cm&fs=1&to={quoted_rec}&su={quoted_sub}&body={quoted_body}"
    else:
        mail_url = f"mailto:{quoted_rec}?subject={quoted_sub}&body={quoted_body}"

    # Launch Explorer highlighting target file and launch mail app asynchronously
    def _async_launch_email() -> None:
        import platform
        import subprocess

        # 1. Reveal file in Explorer / Finder
        try:
            if platform.system() == "Windows":
                subprocess.Popen(
                    ["explorer.exe", "/select,", os.path.normpath(target_zip)]
                )
            elif platform.system() == "Darwin":
                subprocess.Popen(["open", "-R", target_zip])
            else:
                from el_sbobinator.utils.file_ops import open_path_with_default_app

                open_path_with_default_app(out_folder)
        except Exception:
            pass

        # 2. Open mail app or Gmail Web Compose
        try:
            from el_sbobinator.utils.file_ops import open_path_with_default_app

            open_path_with_default_app(mail_url)
        except Exception:
            try:
                import webbrowser

                webbrowser.open(mail_url)
            except Exception:
                pass

    import threading

    threading.Thread(target=_async_launch_email, daemon=True).start()

    return {
        "ok": True,
        "package_path": target_zip,
        "mailto_url": mail_url,
        "folder_opened": out_folder,
        "audio_included": pkg_res.get("audio_included", False),
        "mail_provider": mail_provider,
        "subject": subject,
        "body": body,
    }
