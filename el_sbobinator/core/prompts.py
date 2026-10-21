"""
AI prompt constants for El Sbobinator.

The texts live in generation_profile.json so the web build sends exactly the
same prompts; this module keeps the names the pipeline imports.
"""

from __future__ import annotations

from el_sbobinator.core.generation_profile import GENERATION_PROFILE

_PROMPTS = GENERATION_PROFILE["prompts"]

PROMPT_SISTEMA: str = _PROMPTS["system"]

PROMPT_REVISIONE: str = _PROMPTS["revision"]

# Phase 1 user prompt; the continuation is appended when the previous chunk left a tail.
CHUNK_PROMPT: str = _PROMPTS["chunk"]
CHUNK_PROMPT_CONTINUATION: str = _PROMPTS["chunk_continuation"]
