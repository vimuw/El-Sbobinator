"""Actionable, redacted errors for the Gemini setup metadata check."""

from __future__ import annotations

from el_sbobinator.bridge.bridge_types import ValidationCheck
from el_sbobinator.services.gemini_errors import _error_code, _error_text
from el_sbobinator.utils.logging_utils import redact_secrets


def api_validation_error(exc: Exception, model: str, api_key: str) -> ValidationCheck:
    code = _error_code(exc)
    text = _error_text(exc)
    message = "Verifica della chiave non riuscita."
    hint = "Apri i dettagli per vedere l'errore restituito."
    help_action = False

    if code == 401 or any(
        marker in text
        for marker in (
            "api_key_invalid",
            "api key not valid",
            "invalid api key",
            "api key was reported as leaked",
            "api key expired",
        )
    ):
        message = "Google non accetta questa chiave."
        hint = "Verifica di averla copiata interamente e che sia attiva in Google AI Studio."
        help_action = True
    elif code == 403:
        message = "Google ha negato l'accesso."
        hint = "Controlla i permessi e le restrizioni della chiave o del progetto in Google AI Studio."
        help_action = True
    elif code == 404:
        message = "Il modello selezionato non è disponibile."
        hint = f"Modello: {model}. Verifica di usare una versione aggiornata dell'app."
    elif "non supporta generatecontent" in text:
        message = "Il modello non supporta la trascrizione."
        hint = f"Modello: {model}. Verifica di usare una versione aggiornata dell'app."
    elif code == 429:
        message = "Google ha segnalato un limite di richieste."
        hint = "Controlla i limiti del progetto in Google AI Studio e riprova quando disponibili."
        help_action = True
    elif code is not None and 500 <= code <= 599:
        message = "Google è temporaneamente non disponibile."
        hint = "Riprova tra poco."
    elif isinstance(exc, TimeoutError | ConnectionError) or any(
        marker in f"{type(exc).__name__.lower()} {text}"
        for marker in (
            "timeout",
            "timed out",
            "connecterror",
            "connection refused",
            "connection reset",
            "certificate_verify_failed",
            "sslerror",
            "getaddrinfo failed",
            "name or service not known",
            "nodename nor servname",
        )
    ):
        message = "Connessione a Google non riuscita."
        hint = "Controlla la rete, eventuali VPN o proxy e riprova."

    # Exact replacement also protects nonstandard or partially pasted keys.
    details = str(exc) or type(exc).__name__
    if api_key:
        details = details.replace(api_key, "[API_KEY_REDACTED]")
    check: ValidationCheck = {
        "id": "api_key",
        "label": "API Key Gemini",
        "status": "error",
        "message": message,
        "hint": hint,
        "model": model,
        "details": redact_secrets(details, max_len=2000),
    }
    if code is not None:
        check["error_code"] = str(code)
    if help_action:
        check["help_action"] = "ai_studio"
    return check
