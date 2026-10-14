import httpx
import pytest

from el_sbobinator.services.api_validation_error import api_validation_error


class ApiError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


@pytest.mark.parametrize(
    ("exc", "message", "code", "help_action"),
    [
        (
            ApiError(401, "Unauthorized"),
            "Google non accetta questa chiave.",
            "401",
            True,
        ),
        (
            ApiError(400, "API_KEY_INVALID"),
            "Google non accetta questa chiave.",
            "400",
            True,
        ),
        (
            ApiError(403, "Permission denied"),
            "Google ha negato l'accesso.",
            "403",
            True,
        ),
        (
            ApiError(404, "NOT_FOUND"),
            "Il modello selezionato non è disponibile.",
            "404",
            False,
        ),
        (
            ApiError(429, "RESOURCE_EXHAUSTED"),
            "Google ha segnalato un limite di richieste.",
            "429",
            True,
        ),
        (
            ApiError(503, "Unavailable"),
            "Google è temporaneamente non disponibile.",
            "503",
            False,
        ),
        (
            httpx.ConnectError("CERTIFICATE_VERIFY_FAILED"),
            "Connessione a Google non riuscita.",
            None,
            False,
        ),
        (httpx.ReadTimeout(""), "Connessione a Google non riuscita.", None, False),
        (
            RuntimeError("Unexpected response"),
            "Verifica della chiave non riuscita.",
            None,
            False,
        ),
        (
            ApiError(400, "Unsupported argument"),
            "Verifica della chiave non riuscita.",
            "400",
            False,
        ),
    ],
)
def test_classifies_only_evidenced_causes(exc, message, code, help_action):
    check = api_validation_error(exc, "gemini-3.6-flash", "fake")
    assert check["message"] == message
    assert check.get("model") == "gemini-3.6-flash"
    assert check.get("error_code") == code
    assert (check.get("help_action") == "ai_studio") == help_action
    assert check.get("hint")
    assert check["status"] == "error"


def test_redacts_inserted_and_other_keys_before_returning_details():
    pasted = "partial-key"
    other = "AQ.abcdefghijklmnopqrstuvwxyz012345"
    check = api_validation_error(
        ApiError(403, f"key={pasted}; other={other}"), "gemini-3.6-flash", pasted
    )
    assert pasted not in check.get("details", "")
    assert other not in check.get("details", "")
    assert "[API_KEY_REDACTED]" in check.get("details", "")


def test_bounds_diagnostic_details():
    check = api_validation_error(RuntimeError("x" * 5000), "gemini-3.6-flash", "")
    assert len(check.get("details", "")) == 2000
