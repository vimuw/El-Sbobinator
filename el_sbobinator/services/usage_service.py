"""
Service for tracking and persisting Google Gemini API daily usage and quotas.

Key features:
- Independent quota tracking per model (e.g. 20 RPD for Flash, 500 RPD for Flash Lite).
- Multi-key support (primary + fallback keys) identified securely via SHA-256 hashes.
- Sentinel file lock (api_usage.json.lock) + threading.RLock for multi-process and multi-thread ACID safety.
- Google AI Studio quota day synchronization (America/Los_Angeles, reset at 09:00 Italian time).
- Bottleneck calculation for available full transcriptions (chunking + revision).
"""

from __future__ import annotations

import hashlib
import json
import os
import platform
import tempfile
import threading
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta, timezone
from typing import Any, TypedDict
from zoneinfo import ZoneInfo

from el_sbobinator.services.config_service import get_config_dir

# ---------------------------------------------------------------------------
# Constants & Model Limits (Google AI Studio Free Tier Official Limits)
# ---------------------------------------------------------------------------

try:
    PACIFIC_TZ = ZoneInfo("America/Los_Angeles")
except Exception:
    # Fallback to Pacific offset if system tzdata is unavailable on Windows
    PACIFIC_TZ = timezone(timedelta(hours=-7))

DEFAULT_FLASH_RPD: int = 20
DEFAULT_FLASH_LITE_RPD: int = 500

MODEL_RPD_LIMITS: dict[str, int] = {
    "gemini-2.5-flash": 20,
    "gemini-3.7-flash": 20,
    "gemini-3.6-flash": 20,
    "gemini-3.5-flash": 20,
    "gemini-3-flash-preview": 20,
    "gemini-3.1-flash-lite-preview": 500,
    "gemini-3.5-flash-lite": 500,
}

AVG_CHUNKS_PER_SBOBINA: int = 12
AVG_REVISIONS_PER_SBOBINA: int = 7
COST_PER_SBOBINA: int = AVG_CHUNKS_PER_SBOBINA + AVG_REVISIONS_PER_SBOBINA  # ~19 per 3h


_USAGE_THREAD_LOCK = threading.RLock()
_USAGE_FILE_NAME = "api_usage.json"
_LOCK_FILE_NAME = "api_usage.json.lock"

# Cached authoritative server time offset in seconds (Google Server Date - Local Date)
_SERVER_TIME_OFFSET_SECONDS: float = 0.0
_HAS_SERVER_TIME: bool = False


# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------


class ModelQuotaData(TypedDict):
    limit: int
    used_today: int
    is_exhausted: bool
    last_reset_iso: str


class KeyProfileData(TypedDict):
    id: str
    masked_key: str
    is_primary: bool
    models: dict[str, ModelQuotaData]


class ApiUsageSummary(TypedDict):
    quota_date: str
    next_reset_time_italy: str
    keys: list[dict[str, Any]]
    estimated_sbobine_remaining: int
    is_degraded_mode: bool
    degraded_reason: str | None


# ---------------------------------------------------------------------------
# Cross-Platform Sentinel File Locking
# ---------------------------------------------------------------------------


def _get_usage_file_path() -> str:
    return os.path.join(get_config_dir(), _USAGE_FILE_NAME)


def _get_lock_file_path() -> str:
    return os.path.join(get_config_dir(), _LOCK_FILE_NAME)


@contextmanager
def _interprocess_lock():
    """Acquires a process-exclusive lock on the sentinel file (api_usage.json.lock).

    Crucial: Locking the sentinel file leaves api_usage.json unlocked so that
    atomic replacement via os.replace() works reliably without PermissionError
    on Windows.
    """
    lock_path = _get_lock_file_path()
    os.makedirs(os.path.dirname(lock_path), exist_ok=True)

    with _USAGE_THREAD_LOCK:
        lock_file = open(lock_path, "a+b")
        try:
            if platform.system() == "Windows":
                import msvcrt

                file_fd = lock_file.fileno()
                locked = False
                for _ in range(50):
                    try:
                        lock_file.seek(0)
                        msvcrt.locking(file_fd, msvcrt.LK_NBLCK, 1)
                        locked = True
                        break
                    except OSError:
                        import time

                        time.sleep(0.02)
                if not locked:
                    try:
                        msvcrt.locking(file_fd, msvcrt.LK_LOCK, 1)
                        locked = True
                    except Exception:
                        pass
            else:
                import fcntl

                fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)

            yield
        finally:
            try:
                if platform.system() == "Windows":
                    import msvcrt

                    try:
                        lock_file.seek(0)
                        msvcrt.locking(lock_file.fileno(), msvcrt.LK_UNLCK, 1)
                    except Exception:
                        pass
                else:
                    import fcntl

                    try:
                        fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
                    except Exception:
                        pass
            except Exception:
                pass
            finally:
                try:
                    lock_file.close()
                except Exception:
                    pass


# ---------------------------------------------------------------------------
# Time & Reset Helpers
# ---------------------------------------------------------------------------


def update_authoritative_server_time(http_date_str: str | None) -> None:
    """Updates the reference time offset from Google HTTP response 'Date' header."""
    global _SERVER_TIME_OFFSET_SECONDS, _HAS_SERVER_TIME
    if not http_date_str:
        return
    try:
        from email.utils import parsedate_to_datetime

        server_dt = parsedate_to_datetime(http_date_str)
        if server_dt:
            local_now = datetime.now(UTC)
            _SERVER_TIME_OFFSET_SECONDS = (server_dt - local_now).total_seconds()
            _HAS_SERVER_TIME = True
    except Exception:
        pass


def get_current_authoritative_utc() -> datetime:
    """Returns the current UTC time adjusted by authoritative Google server offset."""
    local_utc = datetime.now(UTC)
    if _HAS_SERVER_TIME:
        from datetime import timedelta

        return local_utc + timedelta(seconds=_SERVER_TIME_OFFSET_SECONDS)
    return local_utc


def get_pacific_date_string(dt_utc: datetime | None = None) -> str:
    """Returns YYYY-MM-DD in Google's America/Los_Angeles timezone (midnight reset = 09:00 CEST)."""
    utc = dt_utc or get_current_authoritative_utc()
    return utc.astimezone(PACIFIC_TZ).strftime("%Y-%m-%d")


def get_limit_for_model(model_name: str) -> int:
    cleaned = str(model_name or "").strip()
    if cleaned in MODEL_RPD_LIMITS:
        return MODEL_RPD_LIMITS[cleaned]
    if "lite" in cleaned.lower():
        return DEFAULT_FLASH_LITE_RPD
    return DEFAULT_FLASH_RPD


def hash_key(api_key: str) -> str:
    cleaned = str(api_key or "").strip()
    if not cleaned:
        return "anonymous"
    return hashlib.sha256(cleaned.encode("utf-8")).hexdigest()[:16]


def mask_key(api_key: str) -> str:
    cleaned = str(api_key or "").strip()
    if not cleaned:
        return "Chiave assente"
    if len(cleaned) <= 8:
        return f"{cleaned[:2]}...{cleaned[-2:]}"
    return f"{cleaned[:6]}...{cleaned[-4:]}"


# ---------------------------------------------------------------------------
# Storage & JSON Operations
# ---------------------------------------------------------------------------


def _load_raw_usage_unlocked() -> dict[str, Any]:
    path = _get_usage_file_path()
    if not os.path.exists(path):
        return {"quota_date": get_pacific_date_string(), "keys": {}}
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, dict):
                if "keys" not in data or not isinstance(data["keys"], dict):
                    data["keys"] = {}
                return data
    except Exception:
        pass
    return {"quota_date": get_pacific_date_string(), "keys": {}}


def _save_raw_usage_unlocked(data: dict[str, Any]) -> None:
    path = _get_usage_file_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)

    temp_fd, temp_path = tempfile.mkstemp(
        dir=os.path.dirname(path), prefix="api_usage_", suffix=".tmp"
    )
    try:
        with os.fdopen(temp_fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        os.replace(temp_path, path)
    except Exception:
        try:
            if os.path.exists(temp_path):
                os.remove(temp_path)
        except Exception:
            pass
        raise


def _check_and_reset_unlocked(data: dict[str, Any]) -> bool:
    current_pacific_date = get_pacific_date_string()
    saved_date = data.get("quota_date", "")
    changed = False

    if saved_date != current_pacific_date:
        data["quota_date"] = current_pacific_date
        now_iso = get_current_authoritative_utc().isoformat()
        for _key_id, profile in data.get("keys", {}).items():
            for _model_id, quota in profile.get("models", {}).items():
                quota["used_today"] = 0
                quota["is_exhausted"] = False
                quota["last_reset_iso"] = now_iso
        changed = True
    else:
        # Check individual model timestamps
        now_iso = get_current_authoritative_utc().isoformat()
        for _key_id, profile in data.get("keys", {}).items():
            for _model_id, quota in profile.get("models", {}).items():
                last_reset_iso = quota.get("last_reset_iso", "")
                if last_reset_iso:
                    try:
                        dt = datetime.fromisoformat(
                            last_reset_iso.replace("Z", "+00:00")
                        )
                        last_reset_pacific = dt.astimezone(PACIFIC_TZ).strftime(
                            "%Y-%m-%d"
                        )
                    except Exception:
                        last_reset_pacific = ""
                else:
                    last_reset_pacific = ""

                if last_reset_pacific and last_reset_pacific != current_pacific_date:
                    quota["used_today"] = 0
                    quota["is_exhausted"] = False
                    quota["last_reset_iso"] = now_iso
                    changed = True

    return changed


def _get_or_create_key_profile(
    data: dict[str, Any], api_key: str, is_primary: bool = True
) -> dict[str, Any]:
    key_id = hash_key(api_key)
    keys = data.setdefault("keys", {})
    if key_id not in keys:
        keys[key_id] = {
            "id": key_id,
            "masked_key": mask_key(api_key),
            "is_primary": is_primary,
            "models": {},
        }
    profile = keys[key_id]
    profile["is_primary"] = is_primary
    profile["masked_key"] = mask_key(api_key)
    return profile


def _get_or_create_model_quota(
    profile: dict[str, Any], model_name: str
) -> dict[str, Any]:
    cleaned_model = str(model_name or "gemini-2.5-flash").strip()
    models = profile.setdefault("models", {})
    if cleaned_model not in models:
        models[cleaned_model] = {
            "limit": get_limit_for_model(cleaned_model),
            "used_today": 0,
            "is_exhausted": False,
            "last_reset_iso": get_current_authoritative_utc().isoformat(),
        }
    quota = models[cleaned_model]
    quota["limit"] = get_limit_for_model(cleaned_model)
    return quota


# ---------------------------------------------------------------------------
# Public Service API
# ---------------------------------------------------------------------------


def record_request(api_key: str, model_name: str, count: int = 1) -> None:
    """Records one or more successful (HTTP 200) requests for a given key and model."""
    cleaned_key = str(api_key or "").strip()
    if not cleaned_key:
        return
    cleaned_model = str(model_name or "gemini-2.5-flash").strip()

    with _interprocess_lock():
        data = _load_raw_usage_unlocked()
        _check_and_reset_unlocked(data)

        profile = _get_or_create_key_profile(data, cleaned_key)
        quota = _get_or_create_model_quota(profile, cleaned_model)

        quota["used_today"] = max(0, int(quota.get("used_today", 0)) + int(count))
        # If requests exceeded limit, mark exhausted
        if quota["used_today"] >= quota["limit"]:
            quota["is_exhausted"] = True

        _save_raw_usage_unlocked(data)


def mark_model_exhausted(api_key: str, model_name: str) -> None:
    """Marks a specific key and model as exhausted for the current Google quota day."""
    cleaned_key = str(api_key or "").strip()
    if not cleaned_key:
        return
    cleaned_model = str(model_name or "gemini-2.5-flash").strip()

    with _interprocess_lock():
        data = _load_raw_usage_unlocked()
        _check_and_reset_unlocked(data)

        profile = _get_or_create_key_profile(data, cleaned_key)
        quota = _get_or_create_model_quota(profile, cleaned_model)
        quota["is_exhausted"] = True

        _save_raw_usage_unlocked(data)


def get_daily_usage(
    primary_key: str | None = None,
    fallback_keys: list[str] | None = None,
    primary_model: str = "gemini-2.5-flash",
    fallback_models: list[str] | None = None,
) -> dict[str, Any]:
    """Retrieves full aggregated usage state, remaining requests and estimated complete sbobine."""
    all_keys: list[tuple[str, bool, str]] = []  # (key_str, is_primary, label)
    seen_keys: set[str] = set()

    clean_primary = str(primary_key or "").strip()
    if clean_primary:
        all_keys.append((clean_primary, True, "Chiave Principale"))
        seen_keys.add(clean_primary)

    for idx, fk in enumerate(fallback_keys or []):
        clean_fk = str(fk or "").strip()
        if clean_fk and clean_fk not in seen_keys:
            seen_keys.add(clean_fk)
            all_keys.append((clean_fk, False, f"Chiave Riserva {idx + 1}"))

    clean_primary_model = str(primary_model or "gemini-2.5-flash").strip()
    relevant_models: list[str] = [clean_primary_model]
    for fm in fallback_models or []:
        cfm = str(fm or "").strip()
        if cfm and cfm not in relevant_models:
            relevant_models.append(cfm)

    with _interprocess_lock():
        data = _load_raw_usage_unlocked()
        changed = _check_and_reset_unlocked(data)
        if changed:
            _save_raw_usage_unlocked(data)

        keys_list: list[dict[str, Any]] = []

        total_remaining = 0
        total_lite_remaining = 0

        for key_str, is_primary, label in all_keys:
            profile = _get_or_create_key_profile(data, key_str, is_primary=is_primary)
            models_dict: dict[str, Any] = {}

            for m_name in relevant_models:
                quota = _get_or_create_model_quota(profile, m_name)
                limit = int(quota.get("limit", get_limit_for_model(m_name)))
                used = int(quota.get("used_today", 0))
                is_ex = bool(quota.get("is_exhausted", False)) or (used >= limit)
                rem = 0 if is_ex else max(0, limit - used)

                models_dict[m_name] = {
                    "model_id": m_name,
                    "limit": limit,
                    "used_today": used,
                    "remaining": rem,
                    "is_exhausted": is_ex,
                }

                # Tally up for sbobine estimation
                if m_name == clean_primary_model:
                    total_remaining += rem
                elif "lite" in m_name.lower():
                    total_lite_remaining += rem

            keys_list.append(
                {
                    "id": profile["id"],
                    "label": label,
                    "masked_key": mask_key(key_str),
                    "is_primary": is_primary,
                    "models": models_dict,
                }
            )

        # Calculate estimated complete sbobine with bottleneck & degraded mode
        is_degraded = False
        degraded_reason = None
        cost_per_sbobina = COST_PER_SBOBINA

        if total_remaining >= 1:
            sbobine_count = total_remaining // cost_per_sbobina
            # If at least 1 partial sbobina can be made
            if sbobine_count == 0 and total_remaining >= 6:
                sbobine_count = 1
        elif total_lite_remaining > 0:
            # Degraded mode: Phase 1 & Phase 2 both on Flash Lite (500 RPD)
            is_degraded = True
            degraded_reason = "Modello primario Flash esaurito: calcolo su modello di riserva Flash Lite."
            sbobine_count = total_lite_remaining // cost_per_sbobina
        else:
            sbobine_count = 0

        return {
            "quota_date": data.get("quota_date", get_pacific_date_string()),
            "next_reset_info": "Reset quote: ore 09:00 (fuso Google PT)",
            "keys": keys_list,
            "total_requests_remaining": (
                total_remaining if not is_degraded else total_lite_remaining
            ),
            "estimated_sbobine_remaining": max(0, sbobine_count),
            "is_degraded_mode": is_degraded,
            "degraded_reason": degraded_reason,
        }


def reset_daily_usage_for_tests() -> None:
    """Helper used in test suites to clear stored usage data."""
    with _interprocess_lock():
        path = _get_usage_file_path()
        if os.path.exists(path):
            try:
                os.remove(path)
            except Exception:
                pass
