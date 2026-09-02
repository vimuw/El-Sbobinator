"""
Environment validation helpers and diagnostic reporting.

Used by the WebUI "validate environment" action, build/release smoke checks,
and 1-click diagnostic support reports.
"""

from __future__ import annotations

import os
import platform
import shutil
import subprocess
import sys
import tempfile
from typing import Any

from google import genai

from el_sbobinator.bridge.bridge_types import ValidationCheck, ValidationResult
from el_sbobinator.core.model_registry import (
    DEFAULT_FALLBACK_MODELS,
    sanitize_fallback_models,
    sanitize_model_name,
)
from el_sbobinator.core.shared import DEFAULT_MODEL, get_session_root
from el_sbobinator.services.audio_service import resolve_ffmpeg
from el_sbobinator.services.config_service import CONFIG_FILE, get_config_dir
from el_sbobinator.services.usage_service import (
    get_daily_usage,
)
from el_sbobinator.utils.logging_utils import redact_secrets

MIN_FREE_DISK_BYTES: int = 2 * 1024 * 1024 * 1024  # 2 GB minimum


def _format_bytes(bytes_count: int) -> str:
    gb = bytes_count / (1024 * 1024 * 1024)
    if gb >= 1.0:
        return f"{gb:.1f} GB"
    mb = bytes_count / (1024 * 1024)
    return f"{mb:.0f} MB"


def _check_writable_dir(path: str) -> tuple[bool, str]:
    probe_name = os.path.join(path, ".el_sbobinator_write_test")
    try:
        os.makedirs(path, exist_ok=True)
        with open(probe_name, "w", encoding="utf-8") as handle:
            handle.write("ok")
    except Exception as exc:
        return False, redact_secrets(exc)
    try:
        os.remove(probe_name)
    except Exception:
        pass
    return True, "Scrittura consentita."


def _get_model_capabilities(model_info: Any) -> list[str] | None:
    for field_name in ("supported_actions", "supported_generation_methods"):
        try:
            if isinstance(model_info, dict):
                value = model_info.get(field_name)
            else:
                value = getattr(model_info, field_name, None)
        except Exception:
            value = None
        if isinstance(value, list | tuple):
            return [str(item).strip() for item in value if str(item).strip()]
    return None


def _check_ffmpeg_execution(ffmpeg_path: str) -> tuple[bool, str]:
    try:
        creation_flags = (
            subprocess.CREATE_NO_WINDOW if platform.system() == "Windows" else 0
        )
        res = subprocess.run(
            [ffmpeg_path, "-version"],
            capture_output=True,
            text=True,
            timeout=4.0,
            check=False,
            creationflags=creation_flags,
        )
        if res.returncode == 0 and res.stdout:
            first_line = res.stdout.splitlines()[0].strip()
            return True, first_line
        err = (res.stderr or res.stdout or "").strip()[:200]
        return False, f"FFmpeg ha restituito codice {res.returncode}: {err}"
    except Exception as exc:
        return False, redact_secrets(exc)


def _check_disk_space(path: str) -> tuple[str, str, str]:
    """Returns (status, message, details) for disk space at path."""
    try:
        os.makedirs(path, exist_ok=True)
        usage = shutil.disk_usage(path)
        free_formatted = _format_bytes(usage.free)
        total_formatted = _format_bytes(usage.total)

        if usage.free < MIN_FREE_DISK_BYTES:
            return (
                "warning",
                f"Spazio su disco quasi esaurito: rimasti solo {free_formatted} liberi.",
                f"Spazio libero: {free_formatted} / {total_formatted} su {path}\n"
                "Rimedio: libera almeno 2 GB di spazio prima di elaborare audio o video lunghi.",
            )
        return (
            "ok",
            f"Spazio su disco sufficiente: {free_formatted} liberi.",
            f"Spazio libero: {free_formatted} su {total_formatted} totali ({path})",
        )
    except Exception as exc:
        return (
            "warning",
            "Impossibile verificare lo spazio libero su disco.",
            redact_secrets(exc),
        )


def validate_environment(
    api_key: str | None = None,
    validate_api_key: bool = False,
    preferred_model: str | None = None,
    fallback_models: list[str] | None = None,
) -> ValidationResult:
    checks: list[ValidationCheck] = []

    # 1. API Key & Models Check (Cost-zero metadata validation via models.get)
    if validate_api_key:
        cleaned = str(api_key or "").strip()
        primary_model = sanitize_model_name(preferred_model, DEFAULT_MODEL)
        sanitized_fallbacks = sanitize_fallback_models(
            fallback_models,
            primary_model,
            DEFAULT_FALLBACK_MODELS,
        )
        if not cleaned:
            checks.append(
                {
                    "id": "api_key",
                    "label": "API Key Gemini",
                    "status": "warning",
                    "message": "API key assente: controllo remoto saltato.",
                    "details": "Inserisci una chiave se vuoi verificare l'accesso al modello.",
                }
            )
        else:
            try:
                client = genai.Client(api_key=cleaned)
            except Exception as exc:
                checks.append(
                    {
                        "id": "api_key",
                        "label": "API Key Gemini",
                        "status": "error",
                        "message": "API key non valida o formato non corretto.",
                        "details": redact_secrets(exc),
                    }
                )
            else:
                model_chain = [primary_model, *sanitized_fallbacks]
                for idx, model_name in enumerate(model_chain):
                    check_id = "api_key" if idx == 0 else f"api_model_{idx}"
                    check_label = (
                        "API Key Gemini" if idx == 0 else f"Fallback modello {idx}"
                    )
                    try:
                        model_info = client.models.get(model=model_name)
                        capabilities = _get_model_capabilities(model_info)

                        if capabilities is not None and "generatecontent" not in {
                            str(item or "").strip().lower() for item in capabilities
                        }:
                            raise RuntimeError(
                                f"{model_name} non supporta generateContent"
                            )
                        checks.append(
                            {
                                "id": check_id,
                                "label": check_label,
                                "status": "ok",
                                "message": f"Accesso disponibile per {model_name}.",
                                "details": model_name,
                            }
                        )
                    except Exception as exc:
                        checks.append(
                            {
                                "id": check_id,
                                "label": check_label,
                                "status": "error",
                                "message": (
                                    "Modello primario non accessibile."
                                    if idx == 0
                                    else f"Modello fallback {idx} non accessibile con questa chiave."
                                ),
                                "details": redact_secrets(f"{model_name}: {exc}"),
                            }
                        )

    # 2. FFmpeg Functional Check
    try:
        ffmpeg_path = resolve_ffmpeg()
        ok_exec, ffmpeg_detail = _check_ffmpeg_execution(ffmpeg_path)
        checks.append(
            {
                "id": "ffmpeg",
                "label": "FFmpeg",
                "status": "ok" if ok_exec else "error",
                "message": "FFmpeg disponibile ed eseguibile."
                if ok_exec
                else "FFmpeg non trovato o non utilizzabile.",
                "details": f"{ffmpeg_path}\n{ffmpeg_detail}"
                if ok_exec
                else ffmpeg_detail,
            }
        )
    except Exception as exc:
        checks.append(
            {
                "id": "ffmpeg",
                "label": "FFmpeg",
                "status": "error",
                "message": "FFmpeg non trovato o non utilizzabile.",
                "details": redact_secrets(exc),
            }
        )

    # 3. Config Directory Permissions
    config_dir = get_config_dir()
    ok_config, msg_config = _check_writable_dir(config_dir)
    checks.append(
        {
            "id": "config",
            "label": "Config locale",
            "status": "ok" if ok_config else "error",
            "message": "Cartella config scrivibile."
            if ok_config
            else "Impossibile scrivere la config.",
            "details": config_dir if ok_config else msg_config,
        }
    )

    # 4. Disk Space & Permissions (Session Folder)
    session_output_dir = get_session_root()
    ok_output, msg_output = _check_writable_dir(session_output_dir)
    disk_status, disk_msg, disk_details = _check_disk_space(session_output_dir)

    if not ok_output:
        checks.append(
            {
                "id": "output",
                "label": "Cartella sessioni/output",
                "status": "error",
                "message": "Cartella sessioni/output non scrivibile.",
                "details": (
                    f"Percorso: {session_output_dir}\n"
                    f"Errore: {msg_output}\n"
                    "Rimedio: scegli una cartella sessioni scrivibile dalle impostazioni "
                    "o correggi i permessi della cartella."
                ),
            }
        )
    elif disk_status == "warning":
        checks.append(
            {
                "id": "output",
                "label": "Cartella sessioni/output",
                "status": "warning",
                "message": disk_msg,
                "details": disk_details,
            }
        )
    else:
        checks.append(
            {
                "id": "output",
                "label": "Cartella sessioni/output",
                "status": "ok",
                "message": "Cartella sessioni/output scrivibile.",
                "details": session_output_dir,
            }
        )

    # 5. Keyring (non-Windows only)
    if platform.system() != "Windows":
        keyring_ok = False
        keyring_detail = ""
        try:
            import keyring  # type: ignore

            keyring.get_password("__el_sbobinator_probe__", "__probe__")
            keyring_ok = True
        except Exception as exc:
            keyring_detail = redact_secrets(exc)
        checks.append(
            {
                "id": "keyring",
                "label": "Keyring",
                "status": "ok" if keyring_ok else "warning",
                "message": "Keyring disponibile: chiave API protetta."
                if keyring_ok
                else "Keyring non disponibile: la chiave API sarà salvata in chiaro.",
                "details": "" if keyring_ok else keyring_detail,
            }
        )

    ok = all(check["status"] != "error" for check in checks)
    summary = (
        "Ambiente pronto."
        if ok
        else "Ambiente incompleto: correggi gli errori segnalati."
    )
    return {"ok": ok, "summary": summary, "checks": checks}


def get_recent_log_tail(max_lines: int = 40) -> list[str]:
    """Reads the last N lines from the local el_sbobinator.log file."""
    config_dir = get_config_dir()
    log_path = os.path.join(config_dir, "el_sbobinator.log")
    if not os.path.exists(log_path):
        return ["Nessun log recente registrato."]
    try:
        with open(log_path, encoding="utf-8", errors="ignore") as f:
            lines = f.readlines()

            return [redact_secrets(line.rstrip()) for line in lines[-max_lines:]]
    except Exception as exc:
        return [f"Errore lettura log: {redact_secrets(exc)}"]


def generate_diagnostic_report(
    api_key: str | None = None,
    fallback_keys: list[str] | None = None,
    preferred_model: str | None = None,
    fallback_models: list[str] | None = None,
) -> str:
    """Generates an exhaustive, sanitized Markdown report for technical support."""
    val_result = validate_environment(
        api_key=api_key,
        validate_api_key=bool(api_key),
        preferred_model=preferred_model,
        fallback_models=fallback_models,
    )

    usage_info = get_daily_usage(
        primary_key=api_key,
        fallback_keys=fallback_keys,
        primary_model=preferred_model or DEFAULT_MODEL,
        fallback_models=fallback_models,
    )

    logs = get_recent_log_tail(30)

    lines: list[str] = [
        "# 🩺 Report Diagnostico El Sbobinator",
        f"- **Data/Ora Locale**: {platform.node()} • {platform.system()} {platform.release()} ({platform.machine()})",
        f"- **Python Runtime**: {sys.version.split()[0]} ({sys.executable})",
        f"- **Cartella Config**: `{get_config_dir()}`",
        f"- **Cartella Sessioni**: `{get_session_root()}`",
        "",
        "## 📊 Quote & Utilizzo Google AI Studio (Oggi)",
        f"- **Data Quota (PT)**: {usage_info.get('quota_date', 'N/A')}",
        f"- **Reset Giornaliero**: {usage_info.get('next_reset_info', 'Ore 09:00')}",
        f"- **Sbobine Complete Stimate**: ~{usage_info.get('estimated_sbobine_remaining', 0)}",
    ]

    if usage_info.get("is_degraded_mode"):
        lines.append(f"- ⚠️ **Modalità Degradata**: {usage_info.get('degraded_reason')}")

    lines.append("")
    lines.append("### Dettaglio Chiavi & Modelli")
    for key_entry in usage_info.get("keys", []):
        lines.append(f"- **{key_entry['label']}** (`{key_entry['masked_key']}`):")
        for m_id, m_quota in key_entry.get("models", {}).items():
            status_txt = "⚠️ Esaurito" if m_quota["is_exhausted"] else "✅ Attivo"
            lines.append(
                f"  - `{m_id}`: {m_quota['used_today']} / {m_quota['limit']} usate ({m_quota['remaining']} rimaste) • {status_txt}"
            )

    lines.append("")
    lines.append("## 🔍 Esito Controlli di Sistema")
    lines.append(
        f"**Stato Generale**: {'✅ PRONTO' if val_result['ok'] else '⚠️ DA RISOLVERE'} ({val_result['summary']})"
    )
    lines.append("")
    for check in val_result["checks"]:
        icon = (
            "✅"
            if check["status"] == "ok"
            else "⚠️"
            if check["status"] == "warning"
            else "❌"
        )
        lines.append(f"- {icon} **{check['label']}**: {check['message']}")
        details = check.get("details")
        if details:
            detail_lines = str(details).splitlines()
            for dl in detail_lines:
                lines.append(f"  > `{dl}`")

    lines.append("")
    lines.append("## 📜 Ultimi Log di Sistema (Sanitizzati)")
    lines.append("```text")
    lines.extend(logs)
    lines.append("```")

    return "\n".join(lines)
