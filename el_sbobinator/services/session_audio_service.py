"""Durable, session-owned audio for playback, independent of the source file."""

from __future__ import annotations

import os
import threading
import uuid

from el_sbobinator.bridge.bridge_utils import _path_under_root
from el_sbobinator.core.session_storage import invalidate_session_storage_cache
from el_sbobinator.services.audio_service import preconvert_media_to_mp3

# Bound the lock registry while serializing migration, relinking and removal.
_AUDIO_LOCKS = tuple(threading.RLock() for _ in range(32))
_METADATA_LOCKS = tuple(threading.RLock() for _ in range(32))


def session_audio_lock(session_dir: str):
    return _AUDIO_LOCKS[hash(os.path.normcase(os.path.realpath(session_dir))) % 32]


def session_metadata_lock(session_dir: str):
    """Keep short metadata writes independent of a potentially long conversion."""
    return _METADATA_LOCKS[hash(os.path.normcase(os.path.realpath(session_dir))) % 32]


def managed_audio_path(session_dir: str, relative_path: object) -> str | None:
    """Accept only an audio asset inside this session's real audio directory."""
    relative = str(relative_path or "").strip()
    if not relative or os.path.isabs(relative):
        return None
    root = os.path.realpath(session_dir)
    audio_root = os.path.realpath(os.path.join(root, "audio"))
    candidate = os.path.realpath(os.path.join(root, relative))
    if not _path_under_root(audio_root, root) or not _path_under_root(
        candidate, audio_root
    ):
        return None
    if os.path.splitext(candidate)[1].lower() not in {
        ".mp3",
        ".m4a",
        ".wav",
        ".ogg",
        ".flac",
        ".aac",
        ".opus",
        ".mp4",
        ".mkv",
        ".webm",
        ".mov",
        ".3gp",
    }:
        return None
    return candidate


def playback_audio_path(data: dict, session_dir: str) -> str | None:
    if data.get("audio_removed"):
        return None
    candidate = managed_audio_path(session_dir, data.get("playback_audio"))
    return candidate if candidate and os.path.isfile(candidate) else None


def create_playback_audio(
    session_dir: str,
    source_path: str,
    *,
    preconverted_path: str | None = None,
    stop_event=None,
) -> str:
    """Publish a complete MP3 atomically; never overwrite an audio being played."""
    relative = os.path.join("audio", f"playback-{uuid.uuid4().hex}.mp3")
    target = managed_audio_path(session_dir, relative)
    if target is None:
        raise ValueError("Cartella audio della sbobina non valida.")
    os.makedirs(os.path.dirname(target), exist_ok=True)
    partial = target.removesuffix(".mp3") + ".partial.mp3"
    try:
        if preconverted_path and os.path.isfile(preconverted_path):
            if os.path.getsize(preconverted_path) > 1024:
                os.replace(preconverted_path, target)
                return target
        if not source_path or not os.path.isfile(source_path):
            raise FileNotFoundError("File audio non trovato. Ricollega l'audio.")
        ok, error = preconvert_media_to_mp3(
            input_path=source_path,
            output_path=partial,
            bitrate="48k",
            stop_event=stop_event,
        )
        if not ok or not os.path.isfile(partial) or os.path.getsize(partial) <= 1024:
            raise RuntimeError(error or "Impossibile creare la copia audio interna.")
        os.replace(partial, target)
        return target
    finally:
        if os.path.isfile(partial):
            os.remove(partial)
        invalidate_session_storage_cache()


def discard_playback_audio(path: str | None) -> None:
    """Delete an already validated managed asset, never an external source."""
    if path and os.path.isfile(path):
        os.remove(path)
    invalidate_session_storage_cache()


def attach_playback_audio(data: dict, session_dir: str, path: str) -> None:
    data["playback_audio"] = os.path.relpath(path, session_dir)
