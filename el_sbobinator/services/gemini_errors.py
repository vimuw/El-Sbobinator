"""
Gemini API error inspection, classification, and output guardrails for El Sbobinator.

Isolates error string extraction, HTTP status parsing, rate limit / quota detection,
and runaway degenerate output verification.
"""

from __future__ import annotations

import json
import re
from collections import Counter


class QuotaDailyLimitError(Exception):
    """Raised when daily quota is exhausted and no replacement key was provided."""


class PermanentError(Exception):
    """Raised for non-retryable failures (e.g. HTTP 400 / INVALID_ARGUMENT)."""


class DegenerateOutputError(RuntimeError):
    """Raised when a model returns repetitive/runaway text that must be discarded."""

    def __init__(self, reason: str, rejected_text: str = "") -> None:
        super().__init__(reason)
        self.rejected_text: str = (rejected_text or "")[:500]


class AllModelsUnavailableError(RuntimeError):
    """Raised when all models in the fallback chain are 503-unavailable."""


def _error_text(exc: Exception) -> str:
    """Flatten structured SDK errors into a searchable lowercase string."""
    parts: list[str] = []
    for attr in ("message", "status"):
        value = getattr(exc, attr, None)
        if value:
            parts.append(str(value))
    details = getattr(exc, "details", None)
    if details:
        try:
            parts.append(json.dumps(details, ensure_ascii=False, sort_keys=True))
        except TypeError:
            parts.append(str(details))
    response = getattr(exc, "response", None)
    if response is not None:
        for attr in ("text", "reason_phrase", "reason"):
            value = getattr(response, attr, None)
            if value:
                parts.append(str(value))
    parts.append(str(exc))
    return " ".join(part for part in parts if part).lower()


def _error_code(exc: Exception) -> int | None:
    raw_candidates = [
        getattr(exc, "code", None),
        getattr(getattr(exc, "response", None), "status_code", None),
        getattr(getattr(exc, "response", None), "status", None),
    ]
    for raw in raw_candidates:
        try:
            if raw is None or raw == "":
                continue
            return int(raw)
        except (TypeError, ValueError):
            continue
    return None


def _is_minute_scoped_rate_limit(
    error_text: str, error_code: int | None = None
) -> bool:
    markers = (
        "per minute",
        "per-minute",
        "per_minute",
        "rate limit",
        "too many requests",
        "requests_per_minute",
        "requests per minute",
        "retry-after",
        "retry after",
        "rpm",
    )
    return error_code == 429 or any(marker in error_text for marker in markers)


def _is_daily_or_key_exhausted(error_text: str, error_code: int | None) -> bool:
    hard_limit_markers = (
        "per day",
        "per-day",
        "per_day",
        "perday",
        "daily",
        "quota_exceeded",
        "requests_per_day",
        "requests per day",
        "insufficient_quota",
        "insufficient quota",
        "insufficient_balance",
        "insufficient balance",
        "billing",
        "credit",
        "balance",
    )
    if any(marker in error_text for marker in hard_limit_markers):
        return True

    if _is_minute_scoped_rate_limit(error_text, error_code):
        return False

    token_markers = ("token", "tokens")
    token_exhaustion_markers = (
        "exhaust",
        "exceeded",
        "finished",
        "ended",
        "insufficient",
        "unavailable",
        "depleted",
    )
    if any(marker in error_text for marker in token_markers) and any(
        marker in error_text for marker in token_exhaustion_markers
    ):
        return True

    # Some Gemini quota failures are surfaced as plain HTTP 503 / UNAVAILABLE,
    # but the structured payload still says RESOURCE_EXHAUSTED.
    if error_code == 503 and "resource_exhausted" in error_text:
        return True

    return False


def _is_model_unavailable(error_text: str, error_code: int | None) -> bool:
    if error_code != 503:
        return False
    markers = (
        "service unavailable",
        "backend error",
        "model is overloaded",
        "overloaded",
        "temporarily unavailable",
    )
    return any(marker in error_text for marker in markers)


def _is_quota_related(error_text: str, error_code: int | None) -> bool:
    return (
        error_code == 429
        or "resource_exhausted" in error_text
        or "quota" in error_text
        or "rate limit" in error_text
        or "too many requests" in error_text
    )


def _is_model_not_found(error_text: str, error_code: int | None) -> bool:
    if error_code != 404:
        return False
    markers = (
        "not_found",
        "not found",
        "not supported for generatecontent",
        "unsupported for generatecontent",
        "models/",
    )
    return any(marker in error_text for marker in markers)


def _is_invalid_key_probe_failure(error_text: str, error_code: int | None) -> bool:
    if error_code in (401, 403):
        return True
    markers = (
        "api key not valid",
        "api_key_invalid",
        "invalid api key",
        "invalid_api_key",
        "malformed api key",
        "unauthenticated",
        "permission_denied",
        "permission denied",
        "forbidden",
        "access denied",
        "does not have permission",
        "not authorized",
        "unauthorized",
    )
    return any(marker in error_text for marker in markers)


def _is_transient_key_probe_failure(
    error_text: str, error_code: int | None, exc: Exception
) -> bool:
    if isinstance(exc, TimeoutError | ConnectionError):
        return True
    if error_code in (408, 429, 500, 502, 503, 504):
        if _is_daily_or_key_exhausted(error_text, error_code):
            return False
        return True
    markers = (
        "timeout",
        "timed out",
        "connection",
        "network",
        "temporary",
        "temporarily",
        "service unavailable",
        "backend error",
        "overloaded",
        "try again",
        "retry-after",
        "retry after",
        "rate limit",
        "too many requests",
        "per minute",
        "per-minute",
        "rpm",
    )
    if any(marker in error_text for marker in markers):
        return not _is_daily_or_key_exhausted(error_text, error_code)
    return False


def _normalize_guardrail_text(text: str) -> str:
    normalized = str(text or "").replace("\u00a0", " ").strip().lower()
    normalized = re.sub(r"\s+", " ", normalized)
    normalized = re.sub(r"\s*([,.;:!?])\s*", r"\1", normalized)
    return normalized


def detect_degenerate_output(text: str) -> str | None:
    raw = str(text or "").strip()
    if not raw:
        return None

    paragraphs = [
        segment.strip()
        for segment in re.split(r"\n\s*\n+", raw)
        if segment and segment.strip()
    ]
    if not paragraphs:
        return None

    if any(len(paragraph) > 12000 for paragraph in paragraphs):
        longest = max(len(paragraph) for paragraph in paragraphs)
        return f"paragrafo troppo lungo ({longest} caratteri)"

    normalized_paragraphs = [
        _normalize_guardrail_text(paragraph) for paragraph in paragraphs
    ]
    paragraph_candidates = [
        paragraph for paragraph in normalized_paragraphs if len(paragraph) >= 80
    ]
    if paragraph_candidates:
        paragraph_counts = Counter(paragraph_candidates)
        repeated_paragraph = max(paragraph_counts.values(), default=0)
        if repeated_paragraph >= 4:
            return f"paragrafo ripetuto {repeated_paragraph} volte"
        duplicate_paragraphs = sum(
            count - 1 for count in paragraph_counts.values() if count > 1
        )
        if (
            duplicate_paragraphs >= 8
            and duplicate_paragraphs / max(1, len(paragraph_candidates)) >= 0.20
        ):
            return f"troppi paragrafi duplicati ({duplicate_paragraphs} duplicati)"

    sentence_candidates: list[str] = []
    for paragraph in paragraphs:
        parts = re.split(r"(?<=[.!?])\s+|\n+", paragraph)
        for sentence in parts:
            normalized = _normalize_guardrail_text(sentence)
            if len(normalized) >= 40:
                sentence_candidates.append(normalized)
    if sentence_candidates:
        sentence_counts = Counter(sentence_candidates)
        repeated_sentence = max(sentence_counts.values(), default=0)
        if repeated_sentence >= 8:
            return f"frase ripetuta {repeated_sentence} volte"

    if len(raw) > 120000 and len(paragraphs) <= 5:
        return f"output eccessivo e poco segmentato ({len(raw)} caratteri)"

    return None
