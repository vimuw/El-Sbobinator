"""
Gemini-centric helpers for the transcription pipeline.

This keeps transport/retry/prompt helpers out of pipeline.py so the remaining
module can focus more on orchestration.
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
from collections import Counter
from collections.abc import Callable
from typing import Any

from google import genai
from google.genai import types

from el_sbobinator.core.model_registry import (
    MODEL_OPTIONS,
    ModelState,
    next_model_in_chain,
)
from el_sbobinator.services.config_service import load_config
from el_sbobinator.services.gemini_errors import (
    AllModelsUnavailableError,
    DegenerateOutputError,
    PermanentError,
    QuotaDailyLimitError,
    _error_code,
    _error_text,
    _is_daily_or_key_exhausted,
    _is_invalid_key_probe_failure,
    _is_minute_scoped_rate_limit,
    _is_model_not_found,
    _is_model_unavailable,
    _is_quota_related,
    _is_transient_key_probe_failure,
    _normalize_guardrail_text,
    detect_degenerate_output,
)
from el_sbobinator.utils.logging_utils import get_logger, redact_secrets

# ---------------------------------------------------------------------------
# Module-level constants
# ---------------------------------------------------------------------------

_FILE_UPLOAD_TIMEOUT_SECONDS: int = (
    900  # 15-minute ceiling for Google to finish processing an uploaded audio file
)
_FILE_UPLOAD_POLL_SECONDS: int = (
    3  # How often (seconds) to re-query file state while waiting
)

_MAX_RETRY_ATTEMPTS: int = (
    4  # Maximum Gemini API call attempts before propagating the error
)
_RETRY_SLEEP_SECONDS: float = 30.0  # Back-off pause between generic transient errors
_MODEL_UNAVAILABLE_RETRY_DELAYS: tuple[float, ...] = (
    5.0,
    15.0,
    30.0,
    60.0,
    120.0,
)  # Progressive back-off before switching model on 503/UNAVAILABLE (6 total attempts)
# Gemini enforces a per-minute request quota that resets after ~60 s; sleeping
# 65 s adds a small buffer to ensure the window has fully elapsed before retry.
_RATE_LIMIT_SLEEP_SECONDS: float = 65.0
_NEW_API_KEY_TIMEOUT_SECONDS: float = 600.0


def current_model_name(model_state: ModelState | None, default_model: str) -> str:
    if model_state is None:
        return str(default_model or "").strip()
    current = str(getattr(model_state, "current", "") or "").strip()
    return current or str(default_model or "").strip()


def extract_client_api_key(client_obj) -> str | None:
    try:
        direct = getattr(client_obj, "api_key", None) or getattr(
            client_obj, "_api_key", None
        )
        if direct:
            return str(direct).strip() or None
    except Exception:
        pass
    try:
        api_client = getattr(client_obj, "_api_client", None)
        nested = getattr(api_client, "api_key", None) or getattr(
            api_client, "_api_key", None
        )
        if nested:
            return str(nested).strip() or None
    except Exception:
        pass
    return None


def sleep_with_cancel(
    cancelled: Callable[[], bool], seconds: float, step: float = 0.2
) -> bool:
    deadline = time.monotonic() + float(seconds)
    while time.monotonic() < deadline:
        if cancelled():
            return False
        time.sleep(min(step, deadline - time.monotonic()))
    return True


def load_fallback_keys() -> list[str]:
    try:
        config = load_config()
        raw = config.get("fallback_keys", [])
        if isinstance(raw, list):
            return [str(item).strip() for item in raw if str(item).strip()]
    except Exception:
        pass
    return []


def try_rotate_key(
    current_client,
    fallback_keys: list[str],
    model_name: str,
    logger=None,
    cancelled: Callable[[], bool] | None = None,
):
    log = logger or get_logger("el_sbobinator.generation")
    pass_limit = len([str(item).strip() for item in fallback_keys if str(item).strip()])
    checked = 0
    while fallback_keys and checked < pass_limit:
        if cancelled is not None and cancelled():
            return current_client, False, None
        key = fallback_keys[0].strip()
        if not key:
            fallback_keys.pop(0)
            continue
        checked += 1
        try:
            new_client = genai.Client(api_key=key)
            new_client.models.get(model=model_name)
            if cancelled is not None and cancelled():
                return current_client, False, None
            fallback_keys.pop(0)
            log.info(
                "Chiave di fallback valida, rotazione completata.",
                extra={"stage": "key_rotation"},
            )
            print(f"   [OK] Chiave di riserva valida! ({len(fallback_keys)} rimanenti)")
            return new_client, True, key
        except Exception as err:
            error = _error_text(err)
            error_code = _error_code(err)
            safe_err = redact_secrets(err)
            if _is_transient_key_probe_failure(error, error_code, err):
                fallback_keys.append(fallback_keys.pop(0))
                log.warning(
                    "Validazione chiave di fallback temporaneamente non riuscita.",
                    extra={"stage": "key_rotation"},
                )
                print(
                    "   [!] Validazione temporanea fallita per chiave di riserva: "
                    f"{safe_err}"
                )
                continue
            fallback_keys.pop(0)
            if _is_invalid_key_probe_failure(
                error, error_code
            ) or _is_daily_or_key_exhausted(error, error_code):
                log.warning(
                    "Chiave di fallback non utilizzabile.",
                    extra={"stage": "key_rotation"},
                )
                print(f"   [!] Chiave di riserva non utilizzabile: {safe_err}")
            else:
                log.warning(
                    "Chiave di fallback non valida.", extra={"stage": "key_rotation"}
                )
                print(f"   [!] Chiave di riserva non valida: {safe_err}")
    return current_client, False, None


def wait_for_file_ready(
    client_for_file,
    file_obj,
    cancelled: Callable[[], bool],
    max_wait_seconds: int = _FILE_UPLOAD_TIMEOUT_SECONDS,
    poll_seconds: int = _FILE_UPLOAD_POLL_SECONDS,
):
    start_time = time.monotonic()
    while True:
        state = str(getattr(file_obj, "state", "")).upper()
        if "ACTIVE" not in state and "FAILED" not in state:
            if time.monotonic() - start_time > max_wait_seconds:
                raise TimeoutError(
                    "Timeout durante l'elaborazione del file audio sui server Google."
                )
            if not sleep_with_cancel(cancelled, poll_seconds):
                return None
            file_obj = client_for_file.files.get(name=file_obj.name)
            continue
        if "FAILED" in state:
            raise RuntimeError(f"Caricamento fallito (state={state}).")
        return file_obj


def upload_audio_path(client_for_upload, path_str: str):
    try:
        return client_for_upload.files.upload(path=path_str)
    except TypeError:
        return client_for_upload.files.upload(file=path_str)


def make_inline_audio_part(path_str: str, max_bytes: int | None = None):
    try:
        if max_bytes is not None:
            try:
                size = int(os.path.getsize(path_str))
                if size > int(max_bytes):
                    return None
            except Exception:
                pass
        with open(path_str, "rb") as handle:
            data = handle.read()
        return types.Part.from_bytes(data=data, mime_type="audio/mpeg")
    except Exception:
        return None


def request_new_api_key(
    runtime,
    cancelled: Callable[[], bool],
    *,
    timeout_seconds: float | None = _NEW_API_KEY_TIMEOUT_SECONDS,
    on_timeout: Callable[[], None] | None = None,
):
    print("   [In attesa di una nuova chiave API dall'utente nel popup...]")
    event = threading.Event()
    result = {"new_key": None}
    deadline = (
        time.monotonic() + float(timeout_seconds)
        if timeout_seconds is not None and float(timeout_seconds) >= 0
        else None
    )

    def handler(response):
        result["new_key"] = response.get("key", None)
        event.set()

    if not runtime.ask_new_api_key(handler):
        print("ERRORE: Funzione webview non trovata per il popup.")
        return None

    while not event.is_set():
        if cancelled():
            return None
        wait_seconds = 0.2
        if deadline is not None:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                try:
                    runtime.dismiss_new_api_key_prompt()
                except Exception:
                    pass
                if on_timeout is not None:
                    on_timeout()
                print("   [!] Attesa nuova API Key scaduta.")
                return None
            wait_seconds = min(wait_seconds, remaining)
        event.wait(wait_seconds)
    return result["new_key"]


def _switch_to_next_model(
    model_state: ModelState,
    *,
    on_model_switched,
    error_message: str,
    cause: Exception,
    exc_type: type[Exception] = RuntimeError,
) -> None:
    next_model = next_model_in_chain(model_state)
    if next_model:
        old_model = model_state.current
        model_state.current = next_model
        print(f"      [Fallback modello] {old_model} -> {next_model}")
        if on_model_switched is not None:
            on_model_switched(old_model, next_model)
        return
    tried = ", ".join(model_state.chain)
    raise exc_type(
        f"{error_message} Ho provato tutti i fallback configurati: {tried}."
    ) from cause


def _phase1_temperature(model_name: str) -> float:
    for opt in MODEL_OPTIONS:
        if opt["id"] == model_name:
            return float(opt.get("phase1_temperature", 0.35))
    return 0.35


def _retry_on_model_unavailable(
    callable_fn,
    client,
    model_state: ModelState,
    current_model: str,
    cancelled,
    runtime,
    restore_phase,
    model_unavailable_retry_delays: tuple[float, ...],
    on_model_switched,
) -> tuple[bool, Any, Any, Exception | None]:
    """Execute retry loop for 503 unavailable model.

    Returns (switched, client, result, last_exc).
    """
    total = len(model_unavailable_retry_delays)
    for retry_idx, wait in enumerate(model_unavailable_retry_delays, start=1):
        print(
            f"      [Modello {current_model} temporaneamente indisponibile."
            f" Riprovo tra {int(wait)}s... (retry {retry_idx}/{total})]"
        )
        runtime.phase(f"Server Gemini occupato — ritento tra {int(wait)}s")
        if not sleep_with_cancel(cancelled, wait):
            print("   [*] Operazione annullata dall'utente.")
            return False, client, None, None
        restore_phase()
        try:
            result = callable_fn(client)
            return False, client, result, None
        except Exception as retry_exc:
            if cancelled():
                print("   [*] Operazione annullata dall'utente.")
                return False, client, None, None
            retry_error = _error_text(retry_exc)
            retry_code = _error_code(retry_exc)
            if _is_model_unavailable(retry_error, retry_code):
                if retry_idx == total:
                    _switch_to_next_model(
                        model_state,
                        on_model_switched=on_model_switched,
                        error_message="Modello Gemini indisponibile.",
                        cause=retry_exc,
                        exc_type=AllModelsUnavailableError,
                    )
                    return True, client, None, None
            else:
                return False, client, None, retry_exc
    return False, client, None, None


def _retry_on_quota(
    exc: Exception,
    *,
    client,
    fallback_keys: list,
    current_model: str,
    model_state: ModelState | None,
    cancelled,
    runtime,
    request_fallback_key,
    on_key_rotated,
    on_model_switched,
    attempts: int,
    max_attempts: int,
    rate_limit_sleep_seconds: float,
    error: str,
    error_code: int | None,
    log,
    restore_phase,
) -> tuple[bool, Any]:
    """Handle minute rate limits, key rotation, dynamic key prompting, and model degradation.

    Returns (should_retry, new_client).
    """
    is_minute_rate_limit = _is_minute_scoped_rate_limit(error, error_code)
    is_exhausted_key = _is_daily_or_key_exhausted(error, error_code)
    if is_minute_rate_limit and not is_exhausted_key and attempts < max_attempts - 1:
        print(
            "      [Rilevato limite temporaneo. Attesa di 65s per il reset quota al minuto...]"
        )
        runtime.phase("⏳ Rate limit: attesa 65s...")
        if not sleep_with_cancel(cancelled, rate_limit_sleep_seconds):
            print("   [*] Operazione annullata dall'utente.")
            return False, client
        restore_phase()
        return True, client
    if is_minute_rate_limit and not is_exhausted_key:
        raise exc

    print("\n[!!] CHIAVE API ESAURITA O QUOTA GIORNALIERA RAGGIUNTA!")
    if cancelled():
        print("   [*] Operazione annullata dall'utente.")
        return False, client
    new_c, rotated, rotated_key = try_rotate_key(
        client,
        fallback_keys,
        current_model,
        logger=log,
        cancelled=cancelled,
    )
    if rotated:
        client = new_c
        runtime.set_effective_api_key(rotated_key)
        if on_key_rotated is not None:
            on_key_rotated(client)
        return True, client

    if cancelled():
        print("   [*] Operazione annullata dall'utente.")
        return False, client
    new_api_key = request_fallback_key()
    if new_api_key and new_api_key.strip():
        try:
            test_c = genai.Client(api_key=new_api_key.strip())
            test_c.models.get(model=current_model)
            client = test_c
            runtime.set_effective_api_key(new_api_key.strip())
            if on_key_rotated is not None:
                on_key_rotated(client)
            print("   [OK] Nuova API Key valida! Ripresa automatica...")
            return True, client
        except Exception as err:
            print(f"   [!] Chiave non valida fornita: {redact_secrets(err)}")

    if model_state is not None:
        _switch_to_next_model(
            model_state,
            on_model_switched=on_model_switched,
            error_message="Quota giornaliera esaurita su tutte le chiavi disponibili.",
            cause=exc,
            exc_type=QuotaDailyLimitError,
        )
        return True, client

    raise QuotaDailyLimitError(str(exc)) from exc


def retry_with_quota(
    callable_fn,
    *,
    client,
    fallback_keys: list,
    model_name: str,
    model_state: ModelState | None = None,
    cancelled,
    runtime,
    request_fallback_key,
    max_attempts: int = _MAX_RETRY_ATTEMPTS,
    retry_sleep_seconds: float = _RETRY_SLEEP_SECONDS,
    model_unavailable_retry_delays: tuple[float, ...] = _MODEL_UNAVAILABLE_RETRY_DELAYS,
    rate_limit_sleep_seconds: float = _RATE_LIMIT_SLEEP_SECONDS,
    on_key_rotated=None,
    on_model_switched=None,
    logger=None,
    resume_phase_text: str | None = None,
):
    """Execute callable_fn(client) with automatic quota/rate-limit retry and key rotation.

    Returns (new_client, result) where result is the return value of callable_fn(client).
    Raises QuotaDailyLimitError if daily quota is exhausted with no fallback.
    Raises the original exception after max_attempts for non-quota errors.
    callable_fn receives the current client as its sole argument.
    on_key_rotated(new_client) is called after each successful key rotation.
    """
    log = logger or get_logger("el_sbobinator.generation")

    def _restore_phase() -> None:
        if runtime is not None and resume_phase_text:
            runtime.phase(resume_phase_text)

    attempts = 0
    while attempts < max_attempts:
        if cancelled():
            return client, None
        try:
            result = callable_fn(client)
            return client, result
        except Exception as exc:
            if cancelled():
                print("   [*] Operazione annullata dall'utente.")
                return client, None
            error = _error_text(exc)
            error_code = _error_code(exc)
            is_quota_related = _is_quota_related(error, error_code)
            current_model = current_model_name(model_state, model_name)

            if model_state is not None and isinstance(exc, DegenerateOutputError):
                _rejected_len = len(getattr(exc, "rejected_text", ""))
                print(
                    f'      [Output degenerato] model={current_model} reason="{exc}" ({_rejected_len} chars) - provo fallback...'
                )
                _switch_to_next_model(
                    model_state,
                    on_model_switched=on_model_switched,
                    error_message="Tutti i modelli della chain hanno prodotto output degenerato o non valido.",
                    cause=exc,
                    exc_type=DegenerateOutputError,
                )
                attempts = 0
                continue

            if model_state is not None and _is_model_not_found(error, error_code):
                print(
                    f"      [Modello {current_model} non supportato o non trovato. Provo il fallback successivo...]"
                )
                _switch_to_next_model(
                    model_state,
                    on_model_switched=on_model_switched,
                    error_message="Modello Gemini non supportato o non trovato.",
                    cause=exc,
                )
                attempts = 0
                continue

            if (
                not is_quota_related
                and _is_model_unavailable(error, error_code)
                and model_state is not None
            ):
                switched, client, result, other_exc = _retry_on_model_unavailable(
                    callable_fn,
                    client,
                    model_state,
                    current_model,
                    cancelled,
                    runtime,
                    _restore_phase,
                    model_unavailable_retry_delays,
                    on_model_switched,
                )
                if result is not None or (cancelled() and other_exc is None):
                    return client, result
                if switched:
                    attempts = 0
                    continue
                if other_exc is not None:
                    exc = other_exc
                    error = _error_text(exc)
                    error_code = _error_code(exc)
                    is_quota_related = _is_quota_related(error, error_code)
                    current_model = current_model_name(model_state, model_name)

            if is_quota_related:
                should_retry, client = _retry_on_quota(
                    exc,
                    client=client,
                    fallback_keys=fallback_keys,
                    current_model=current_model,
                    model_state=model_state,
                    cancelled=cancelled,
                    runtime=runtime,
                    request_fallback_key=request_fallback_key,
                    on_key_rotated=on_key_rotated,
                    on_model_switched=on_model_switched,
                    attempts=attempts,
                    max_attempts=max_attempts,
                    rate_limit_sleep_seconds=rate_limit_sleep_seconds,
                    error=error,
                    error_code=error_code,
                    log=log,
                    restore_phase=_restore_phase,
                )
                if should_retry:
                    if _is_daily_or_key_exhausted(error, error_code):
                        attempts = 0
                    else:
                        attempts += 1
                    continue
                return client, None

            if isinstance(exc, PermanentError):
                raise

            attempts += 1
            if attempts >= max_attempts:
                raise
            print(
                f"      [Errore: {redact_secrets(exc)}. Riprovo in {int(retry_sleep_seconds)}s...]"
            )
            if not sleep_with_cancel(cancelled, retry_sleep_seconds):
                print("   [*] Operazione annullata dall'utente.")
                return client, None
    return client, None


def extract_response_text(response) -> str:
    raw = getattr(response, "text", None)
    if raw is None:
        text = ""
    elif isinstance(raw, str):
        text = raw.strip()
    else:
        text = str(raw).strip()

    if text:
        return text

    try:
        candidates = getattr(response, "candidates", None) or []
        for candidate in candidates:
            content = getattr(candidate, "content", None)
            parts = getattr(content, "parts", None) or []
            merged = "\n".join(
                [str(getattr(part, "text", "") or "") for part in parts]
            ).strip()
            if merged:
                return merged
    except Exception:
        pass
    return ""


def build_chunk_prompt(previous_tail: str) -> str:
    prompt = (
        "Trascrivi TUTTO il contenuto di questo blocco audio seguendo rigorosamente le istruzioni di sistema. "
        "Non omettere nessun concetto, esempio, cifra o termine tecnico. "
        "Non riassumere: la lunghezza dell'output deve essere proporzionale a quella dell'audio. "
        "Ogni paragrafo generato deve essere unico: non ripetere mai lo stesso paragrafo o frase."
    )
    if previous_tail:
        prompt += (
            "\n\nATTENZIONE: Stai continuando una stesura. Questo è l'ultimo paragrafo che hai generato nel blocco precedente:\n"
            f'"...{previous_tail}"\n\n'
            "Riprendi il discorso da qui IN MODO FLUIDO. Usa la stessa grandezza per i titoli. "
            "Se all'inizio di questo blocco c'è sovrapposizione, NON ripetere testualmente le frasi già dette, "
            "ma se compare anche solo un dettaglio nuovo includilo."
        )
    return prompt
