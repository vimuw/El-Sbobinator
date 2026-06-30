"""
Structured logging helpers for El Sbobinator.
"""

from __future__ import annotations

import logging
import os
import re
import sys
from typing import IO

LOGGER_NAME = "el_sbobinator"
_CONTEXT_KEYS = ("run_id", "session_dir", "stage", "input_file")
_SECRET_REPLACEMENT = "[API_KEY_REDACTED]"
_SECRET_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"\bAIza[0-9A-Za-z_-]{20,}\b"),
    re.compile(r"\bAQ\.[0-9A-Za-z_-]{20,}\b"),
    re.compile(
        r"(?i)\b((?:api[_-]?key|key|x-goog-api-key)\s*[:=]\s*)"
        r"([0-9A-Za-z._~+/=-]{8,})"
    ),
    re.compile(
        r"(?i)([?&](?:api[_-]?key|key|x-goog-api-key)=)"
        r"([^&#\s]{8,})"
    ),
)


def redact_secrets(value: object, max_len: int | None = None) -> str:
    text = str(value or "")
    for pattern in _SECRET_PATTERNS:
        if pattern.groups >= 2:
            text = pattern.sub(
                lambda match: f"{match.group(1)}{_SECRET_REPLACEMENT}", text
            )
        else:
            text = pattern.sub(_SECRET_REPLACEMENT, text)
    if max_len is not None:
        return text[:max_len]
    return text


class StructuredFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        base = redact_secrets(super().format(record))
        context_bits: list[str] = []
        for key in _CONTEXT_KEYS:
            value = getattr(record, key, None)
            if value:
                context_bits.append(f"{key}={redact_secrets(value)}")
        if context_bits:
            return f"{base} [{' '.join(context_bits)}]"
        return base


def configure_logging(stream: IO[str] | None = None) -> logging.Logger:
    logger = logging.getLogger(LOGGER_NAME)
    if getattr(logger, "_el_sbobinator_configured", False):
        return logger

    handler = logging.StreamHandler(stream or sys.stdout)
    handler.setFormatter(
        StructuredFormatter("%(asctime)s %(levelname)s %(message)s", "%H:%M:%S")
    )
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    logger.propagate = False
    logger._el_sbobinator_configured = True  # type: ignore[attr-defined]
    return logger


def get_logger(name: str = LOGGER_NAME, **context: str) -> logging.LoggerAdapter:
    base = configure_logging()
    logger = base if name == LOGGER_NAME else logging.getLogger(name)
    if logger is not base:
        logger.setLevel(base.level)
        logger.propagate = True  # propagate to parent; parent has propagate=False
    clean_context = {key: value for key, value in context.items() if value}
    return logging.LoggerAdapter(logger, clean_context)


def attach_file_handler(log_path: str) -> logging.Handler | None:
    try:
        os.makedirs(os.path.dirname(log_path), exist_ok=True)
        handler = logging.FileHandler(log_path, encoding="utf-8")
        handler.setFormatter(
            StructuredFormatter("%(asctime)s %(levelname)s %(message)s")
        )
        configure_logging().addHandler(handler)
        return handler
    except Exception:
        return None


def detach_file_handler(handler: logging.Handler | None) -> None:
    if handler is None:
        return
    logger = configure_logging()
    try:
        logger.removeHandler(handler)
    except Exception:
        pass
    try:
        handler.close()
    except Exception:
        pass
