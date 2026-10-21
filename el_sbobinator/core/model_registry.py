"""
Supported Gemini model registry and helpers.

This keeps model allowlists, defaults and small sanitization helpers in one
place so config/session/UI logic stay aligned.
"""

from __future__ import annotations

from typing import Any, NotRequired, TypedDict


class ModelOption(TypedDict):
    id: str
    label: str
    summary: str
    default_chunk_minutes: int
    default_macro_char_limit: int
    phase1_temperature: float
    phase1_thinking_budget: NotRequired[int]
    is_default: NotRequired[bool]


SUPPORTED_MODELS: tuple[str, ...] = (
    "gemini-2.5-flash",
    "gemini-3.6-flash",
    "gemini-3.8-flash",
)

DEFAULT_MODEL = "gemini-3.6-flash"

_LEGACY_MODEL_ALIASES = {
    "gemini-3.5-flash": "gemini-3.6-flash",
    "gemini-3.7-flash": "gemini-3.8-flash",
}

MODEL_OPTIONS: tuple[ModelOption, ...] = (
    {
        "id": "gemini-2.5-flash",
        "label": "Gemini 2.5 Flash",
        "summary": "",
        "default_chunk_minutes": 15,
        "default_macro_char_limit": 22000,
        "phase1_temperature": 0.35,
        # Normal chunks think 1-5k tokens; a stuck chunk reached 63k and took
        # almost 7 minutes. Gemini 3 models take thinking_level instead.
        "phase1_thinking_budget": 16384,
    },
    {
        "id": "gemini-3.6-flash",
        "label": "Gemini 3.6 Flash",
        "summary": "",
        "default_chunk_minutes": 15,
        "default_macro_char_limit": 22000,
        "phase1_temperature": 0.35,
        "is_default": True,
    },
    {
        "id": "gemini-3.8-flash",
        "label": "Gemini 3.8 Flash",
        "summary": "",
        "default_chunk_minutes": 15,
        "default_macro_char_limit": 22000,
        "phase1_temperature": 0.35,
    },
)


def is_supported_model(model_name: Any) -> bool:
    return str(model_name or "").strip() in SUPPORTED_MODELS


def sanitize_model_name(model_name: Any, default: str = DEFAULT_MODEL) -> str:
    candidate = str(model_name or "").strip()
    candidate = _LEGACY_MODEL_ALIASES.get(candidate, candidate)
    if candidate in SUPPORTED_MODELS:
        return candidate
    fallback = str(default or DEFAULT_MODEL)
    return _LEGACY_MODEL_ALIASES.get(fallback, fallback)


def model_label(model_name: str) -> str:
    """Display name of a model id; an unknown id is shown as it is."""
    for opt in MODEL_OPTIONS:
        if opt["id"] == model_name:
            return str(opt["label"])
    return str(model_name)


def default_chunk_minutes_for_model(model_name: str) -> int:
    model = sanitize_model_name(model_name, DEFAULT_MODEL)
    for opt in MODEL_OPTIONS:
        if opt["id"] == model:
            return int(opt.get("default_chunk_minutes", 15))
    return 15


def default_macro_char_limit_for_model(model_name: str) -> int:
    model = sanitize_model_name(model_name, DEFAULT_MODEL)
    for opt in MODEL_OPTIONS:
        if opt["id"] == model:
            return int(opt.get("default_macro_char_limit", 22000))
    return 22000
