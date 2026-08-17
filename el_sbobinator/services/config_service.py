"""
Configuration and credential management for El Sbobinator.

Contains:
- User-home and config-file path resolution
- Re-exported DPAPI / Keyring credential helpers from core.credentials
- load_config / save_config
- Filesystem helpers: get_desktop_dir, safe_output_basename
- debug_log utility
"""

from __future__ import annotations

import json
import os
import platform
import re
import shutil
import threading
import time

from el_sbobinator.core.credentials import (
    _KEYRING_SERVICE,
    _KEYRING_USER_API,
    _KEYRING_USER_FALLBACK_KEYS,
    KEYRING_SERVICE,
    KEYRING_USER_API,
    KEYRING_USER_FALLBACK_KEYS,
    _dpapi_make_blob_class,
    _dpapi_protect_text_windows,
    _dpapi_unprotect_text_windows,
    _dpapi_unprotect_text_windows_once,
    _keyring_delete_api_key,
    _keyring_delete_fallback_keys,
    _keyring_get_api_key,
    _keyring_get_fallback_keys,
    _keyring_set_api_key,
    _keyring_set_fallback_keys,
    dpapi_protect_text_windows,
    dpapi_unprotect_text_windows,
    dpapi_unprotect_text_windows_once,
    keyring_delete_api_key,
    keyring_delete_fallback_keys,
    keyring_get_api_key,
    keyring_get_fallback_keys,
    keyring_set_api_key,
    keyring_set_fallback_keys,
)
from el_sbobinator.core.model_registry import (
    DEFAULT_FALLBACK_MODELS,
    DEFAULT_MODEL,
    sanitize_fallback_models,
    sanitize_model_name,
)

_config_lock = threading.Lock()
_write_lock = threading.Lock()
_config_cache: dict | None = None
_config_cache_ts: float = 0.0
_config_cache_gen: int = 0
_CONFIG_CACHE_TTL = 30.0


def debug_log(msg: str) -> None:
    # Check if debug mode is active
    try:
        is_debug = str(os.environ.get("EL_SBOBINATOR_DEBUG", "")).strip() in (
            "1",
            "true",
            "TRUE",
            "yes",
            "YES",
        )
    except Exception:
        is_debug = False

    if not is_debug:
        return

    # Redact secrets to prevent leaking credentials in stdout or app.log
    try:
        from el_sbobinator.utils.logging_utils import redact_secrets

        msg = redact_secrets(msg)
    except Exception:
        pass

    # Always print to stdout if debug is enabled
    try:
        print(f"[debug] {msg}", flush=True)
    except Exception:
        pass
    # Log to a persistent file in user config directory
    try:
        log_dir = os.path.dirname(CONFIG_FILE)
        if log_dir:
            os.makedirs(log_dir, exist_ok=True)
            log_file = os.path.join(log_dir, "app.log")
            with open(log_file, "a", encoding="utf-8") as fh:
                fh.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} - {msg}\n")
    except Exception:
        pass


def _resolve_user_home() -> str:
    """
    Resolve the user's home directory robustly across platforms and packaging contexts.
    On some macOS GUI launches the environment can be sparse; fall back to system account info.
    """
    candidates = []
    try:
        candidates.append(os.path.expanduser("~"))
    except Exception:
        pass
    try:
        candidates.append(os.environ.get("HOME"))
    except Exception:
        pass
    if platform.system() != "Windows":
        try:
            import pwd  # type: ignore

            candidates.append(pwd.getpwuid(os.getuid()).pw_dir)  # type: ignore[attr-defined]
        except Exception:
            pass

    for c in candidates:
        if not c:
            continue
        c = str(c).strip()
        if not c or c == "~":
            continue
        if os.path.isabs(c) and os.path.isdir(c):
            return c

    # Last-resort: use current working directory (may not be writable, but prevents "~" bugs).
    try:
        return os.path.abspath(os.getcwd())
    except Exception:
        return "."


def _get_config_file_path(user_home: str) -> str:
    """
    Pick an OS-appropriate, persistent config path.
    - macOS: ~/Library/Application Support/El Sbobinator/config.json
    - Windows: %APPDATA%\\El Sbobinator\\config.json
    - Linux: $XDG_CONFIG_HOME/el_sbobinator/config.json or ~/.config/el_sbobinator/config.json
    """
    system = platform.system()
    if system == "Darwin":
        base = os.path.join(
            user_home, "Library", "Application Support", "El Sbobinator"
        )
    elif system == "Windows":
        appdata = os.environ.get("APPDATA") or os.path.join(
            user_home, "AppData", "Roaming"
        )
        base = os.path.join(appdata, "El Sbobinator")
    else:
        xdg = os.environ.get("XDG_CONFIG_HOME") or os.path.join(user_home, ".config")
        base = os.path.join(xdg, "el_sbobinator")
    return os.path.join(base, "config.json")


# Usa il profilo utente per salvare la configurazione in modo persistente anche quando è un .exe creato con PyInstaller.
USER_HOME = _resolve_user_home()
CONFIG_FILE = _get_config_file_path(USER_HOME)
THEME_PREF_FILE = os.path.join(os.path.dirname(CONFIG_FILE), "theme_pref.txt")
LEGACY_CONFIG_FILE = os.path.join(USER_HOME, ".el_sbobinator_config.json")

# In testing environment, isolate from actual user configuration to prevent data loss or key overwrites.
import sys

if "pytest" in sys.modules or os.environ.get("EL_SBOBINATOR_TESTING") == "1":
    import getpass
    import tempfile

    # Incorporate username to prevent PermissionError on multi-user systems
    try:
        _username = getpass.getuser()
    except Exception:
        _username = "unknown"
    _test_temp_dir = os.path.join(
        tempfile.gettempdir(), f"el_sbobinator_test_{_username}"
    )

    try:
        os.makedirs(_test_temp_dir, exist_ok=True)
    except Exception:
        pass

    CONFIG_FILE = os.path.join(_test_temp_dir, "el_sbobinator_test_config.json")
    THEME_PREF_FILE = os.path.join(_test_temp_dir, "el_sbobinator_test_theme_pref.txt")
    LEGACY_CONFIG_FILE = os.path.join(
        _test_temp_dir, "el_sbobinator_test_legacy_config.json"
    )


def get_desktop_dir() -> str:
    # Cross-platform Desktop path (Windows/macOS/Linux). Fallback: home directory.
    try:
        if platform.system() == "Windows":
            # Prefer OneDrive Desktop if present (common on Windows 10/11).
            for env_key in ("OneDriveConsumer", "OneDriveCommercial", "OneDrive"):
                od = os.environ.get(env_key)
                if od:
                    p = os.path.join(od, "Desktop")
                    if os.path.isdir(p):
                        return p
            up = os.environ.get("USERPROFILE") or USER_HOME
            p = os.path.join(up, "Desktop")
            if os.path.isdir(p):
                return p
        # macOS/Linux default
        p = os.path.join(USER_HOME, "Desktop")
        if os.path.isdir(p):
            return p
    except Exception:
        pass
    return USER_HOME


def safe_output_basename(name: str) -> str:
    # Safe across Windows/macOS. Keep it readable.
    s = (name or "").strip() or "Sbobina"
    s = re.sub(r"[<>:\"/\\\\|?*]+", "_", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s[:140] if len(s) > 140 else s


def _remove_legacy_config_after_migration() -> None:
    migrated_path = LEGACY_CONFIG_FILE + ".migrated"
    try:
        os.replace(LEGACY_CONFIG_FILE, migrated_path)
    except FileNotFoundError:
        return
    except Exception as exc:
        debug_log(f"legacy config migration cleanup: replace failed: {exc}")
        return
    try:
        os.remove(migrated_path)
    except FileNotFoundError:
        pass
    except Exception as exc:
        debug_log(f"legacy config migration cleanup: remove failed: {exc}")


def _clone_config_dict(data: dict) -> dict:
    result = dict(data)
    result["fallback_models"] = list(data.get("fallback_models") or [])
    result["fallback_keys"] = list(data.get("fallback_keys") or [])
    return result


def _get_cached_config() -> dict | None:
    with _config_lock:
        if (
            _config_cache is not None
            and time.monotonic() - _config_cache_ts < _CONFIG_CACHE_TTL
        ):
            return _clone_config_dict(_config_cache)
    return None


def _update_config_cache(data: dict, gen_at_start: int) -> None:
    global _config_cache, _config_cache_ts
    with _config_lock:
        if _config_cache_gen == gen_at_start:
            _config_cache = _clone_config_dict(data)
            _config_cache_ts = time.monotonic()


def _backup_corrupt_config_file(path: str) -> None:
    try:
        _ts = int(time.time())
        _dest = f"{path}.corrupt-{_ts}"
        try:
            os.close(os.open(_dest, os.O_CREAT | os.O_EXCL | os.O_WRONLY))
        except FileExistsError:
            pass  # concurrent caller already backed up the same (identical) file
        else:
            shutil.copy2(path, _dest)
    except Exception as ex:
        debug_log(f"load_config: backup copy failed: {ex}")


def _read_config_from_disk_paths() -> tuple[dict | None, str | None, str | None]:
    _corrupt_path: str | None = None
    for path in (CONFIG_FILE, LEGACY_CONFIG_FILE):
        if not os.path.exists(path):
            continue
        try:
            debug_log(f"load_config: checking file at {path}")
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict):
                debug_log(f"load_config: successfully read json dictionary from {path}")
                return data, None, path
        except json.JSONDecodeError as e:
            debug_log(f"load_config: json decode error for {path}: {e}")
            _backup_corrupt_config_file(path)
            if _corrupt_path is None:
                _corrupt_path = path
        except Exception as exc:
            debug_log(f"load_config: failed to read config from {path}: {exc}")
            if _corrupt_path is None:
                _corrupt_path = path
    return None, _corrupt_path, None


def _resolve_loaded_secrets_posix(data: dict) -> None:
    # Prefer keyring secret on macOS/Linux (keeps disk config without secrets).
    try:
        k = _keyring_get_api_key()
        if k:
            data["api_key"] = k
            data["has_protected_key"] = True
        else:
            # One-time migration: if plaintext exists on disk, move to keyring.
            plain = str(data.get("api_key") or "").strip()
            if plain:
                if _keyring_set_api_key(plain):
                    try:
                        save_config(plain)
                    except Exception:
                        pass
            if not data.get("api_key"):
                data["has_protected_key"] = False
    except Exception as e:
        debug_log(f"load_config: non-windows keyring load error: {e}")

    # Get fallback keys from keyring on macOS/Linux.
    try:
        import keyring  # type: ignore

        fk_json = keyring.get_password(_KEYRING_SERVICE, "gemini_fallback_keys")
        if fk_json:
            data["fallback_keys"] = json.loads(fk_json)
    except Exception as e:
        debug_log(f"load_config: non-windows keyring fallback keys load error: {e}")


def _resolve_loaded_secrets_windows(data: dict) -> None:
    # Decrypt best-effort on Windows (do not expose protected value to callers).
    try:
        plain_api_key = str(data.get("api_key") or "").strip()
        protected = str(data.get("api_key_protected") or "").strip()
        if plain_api_key:
            data["api_key_insecure"] = True
            data.setdefault(
                "api_key_insecure_reason",
                "Chiave API presente in chiaro nel file di configurazione.",
            )
        if not (str(data.get("api_key") or "").strip()):
            if protected:
                debug_log(
                    "load_config: found api_key_protected, attempting to decrypt..."
                )
                dec = _dpapi_unprotect_text_windows(protected)
                if dec:
                    data["api_key"] = dec
                    data["has_protected_key"] = True
                    debug_log("load_config: successfully decrypted api_key")
                else:
                    data["has_protected_key"] = False
                    debug_log("load_config: failed to decrypt api_key")
    except Exception as e:
        debug_log(f"load_config: windows dpapi load error: {e}")

    # Decrypt fallback keys on Windows.
    try:
        protected_fk = str(data.get("fallback_keys_protected") or "").strip()
        if protected_fk:
            debug_log(
                "load_config: found fallback_keys_protected, attempting to decrypt..."
            )
            dec_fk = _dpapi_unprotect_text_windows(protected_fk)
            if dec_fk:
                data["fallback_keys"] = json.loads(dec_fk)
                debug_log(
                    f"load_config: successfully decrypted fallback_keys ({len(data['fallback_keys'])} keys)"
                )
            else:
                debug_log("load_config: failed to decrypt fallback_keys")
    except Exception as e:
        debug_log(f"load_config: windows dpapi fallback keys load error: {e}")


def _handle_legacy_migration_forward(source_path: str | None, data: dict) -> None:
    if source_path == LEGACY_CONFIG_FILE and data.get("api_key"):
        try:
            save_config(
                str(data.get("api_key") or ""),
                preferred_model=data.get("preferred_model"),
                fallback_models=data.get("fallback_models"),
            )
            _remove_legacy_config_after_migration()
        except Exception as e:
            debug_log(f"load_config: migration error: {e}")


def _sanitize_config_models(data: dict) -> None:
    preferred_model = sanitize_model_name(data.get("preferred_model"), DEFAULT_MODEL)
    fallback_models = sanitize_fallback_models(
        data.get("fallback_models"),
        preferred_model,
        DEFAULT_FALLBACK_MODELS,
    )
    data["preferred_model"] = preferred_model
    data["fallback_models"] = fallback_models


def _build_default_config(corrupt_path: str | None = None) -> dict:
    debug_log("load_config: no config read, returning default values")
    default_cfg: dict = {
        "api_key": "",
        "preferred_model": DEFAULT_MODEL,
        "fallback_models": list(DEFAULT_FALLBACK_MODELS),
    }
    if corrupt_path is not None:
        default_cfg["config_recovered_from"] = corrupt_path
    return default_cfg


def load_config() -> dict:
    cached = _get_cached_config()
    if cached is not None:
        return cached

    gen_at_start = _config_cache_gen
    data, corrupt_path, source_path = _read_config_from_disk_paths()

    if data is not None:
        if platform.system() == "Windows":
            _resolve_loaded_secrets_windows(data)
        else:
            _resolve_loaded_secrets_posix(data)

        _handle_legacy_migration_forward(source_path, data)
        _sanitize_config_models(data)
        _update_config_cache(data, gen_at_start)
        result = _clone_config_dict(data)
        debug_log(
            f"load_config: returning config. api_key length={len(result.get('api_key') or '')}, has_protected_key={result.get('has_protected_key')}"
        )
        return result

    default_cfg = _build_default_config(corrupt_path)
    _update_config_cache(default_cfg, gen_at_start)
    return _clone_config_dict(default_cfg)


def _read_raw_existing_config() -> dict:
    for path in (CONFIG_FILE, LEGACY_CONFIG_FILE):
        if not os.path.exists(path):
            continue
        try:
            with open(path, encoding="utf-8") as fh:
                raw_cfg = json.load(fh)
            if isinstance(raw_cfg, dict):
                return raw_cfg
        except Exception:
            pass
    return {}


def _prepare_fallback_keys(
    fallback_keys: list | None, current_cfg: dict, data: dict
) -> None:
    if fallback_keys is not None:
        data["fallback_keys"] = [
            str(k or "").strip() for k in fallback_keys if str(k or "").strip()
        ]
    else:
        # Preserve existing fallback keys without the full DPAPI/keyring overhead
        # of load_config(). On Windows, read raw JSON and carry whatever stored
        # form is already on disk verbatim (no decrypt+re-encrypt cycle needed).
        # On macOS/Linux, do a targeted keyring lookup for fallback keys only.
        try:
            if platform.system() == "Windows":
                _raw: dict | None = None
                for _p in (CONFIG_FILE, LEGACY_CONFIG_FILE):
                    if os.path.exists(_p):
                        try:
                            with open(_p, encoding="utf-8") as _f:
                                _raw = json.load(_f)
                            break
                        except Exception:
                            pass
                if isinstance(_raw, dict):
                    if _raw.get("fallback_keys_protected"):
                        data["fallback_keys_protected"] = _raw[
                            "fallback_keys_protected"
                        ]
                    elif (
                        isinstance(_raw.get("fallback_keys"), list)
                        and _raw["fallback_keys"]
                    ):
                        data["fallback_keys"] = _raw["fallback_keys"]
            else:
                try:
                    import keyring as _kr  # type: ignore

                    _fk_json = _kr.get_password(
                        _KEYRING_SERVICE, "gemini_fallback_keys"
                    )
                    if _fk_json:
                        data["fallback_keys"] = json.loads(_fk_json)
                except Exception:
                    pass
        except Exception:
            pass


def _secure_primary_key_windows(
    api_key: str | None, api_key_norm: str, current_cfg: dict, data: dict
) -> None:
    try:
        if api_key_norm:
            protected = _dpapi_protect_text_windows(api_key_norm)
            if protected:
                data["api_key"] = ""
                data["api_key_protected"] = protected
            else:
                data["api_key_insecure"] = True
                data["api_key_insecure_reason"] = (
                    "CryptProtectData non ha restituito dati protetti."
                )
                debug_log(
                    "dpapi: CryptProtectData failed; API key stored as plaintext in config"
                )
    except Exception as _dpapi_exc:
        data["api_key_insecure"] = True
        data["api_key_insecure_reason"] = str(_dpapi_exc) or "Errore DPAPI sconosciuto."
        debug_log(
            f"dpapi: exception during protect — API key stored as plaintext in config: {_dpapi_exc}"
        )

    if api_key is None and "api_key_protected" not in data:
        _existing_protected = current_cfg.get("api_key_protected")
        if _existing_protected:
            data["api_key_protected"] = _existing_protected
        elif current_cfg.get("api_key"):
            data["api_key"] = current_cfg["api_key"]


def _secure_primary_key_posix(
    api_key: str | None, api_key_norm: str, current_cfg: dict, data: dict
) -> None:
    try:
        if api_key is None:
            # No-change: preserve existing keyring flags verbatim.
            if "use_keyring" in current_cfg:
                data["use_keyring"] = current_cfg["use_keyring"]
        elif api_key_norm:
            ok = _keyring_set_api_key(api_key_norm)
            if ok:
                data["api_key"] = ""
                data["use_keyring"] = True
            else:
                print(
                    "[!] Avviso: Keyring non disponibile. La chiave API è salvata in chiaro in config.json."
                )
                data.setdefault("use_keyring", False)
        else:
            # If user clears the key, also clear from keyring (best-effort).
            _keyring_delete_api_key()
            data["api_key"] = ""
            data["use_keyring"] = True
    except Exception:
        pass


def _secure_fallback_keys(fallback_keys: list | None, data: dict) -> None:
    fk = data.get("fallback_keys")
    if fk:
        try:
            if platform.system() == "Windows":
                protected_fk = _dpapi_protect_text_windows(json.dumps(fk))
                if protected_fk:
                    data["fallback_keys"] = []
                    data["fallback_keys_protected"] = protected_fk
                else:
                    debug_log(
                        "dpapi: CryptProtectData failed for fallback keys; stored as plaintext in config"
                    )
        except Exception as _dpapi_fk_exc:
            debug_log(
                f"dpapi: exception during protect for fallback keys — stored as plaintext in config: {_dpapi_fk_exc}"
            )
        try:
            if platform.system() != "Windows":
                import keyring  # type: ignore

                keyring.set_password(
                    _KEYRING_SERVICE, "gemini_fallback_keys", json.dumps(fk)
                )
                data["fallback_keys"] = []
        except Exception:
            pass
    elif platform.system() != "Windows" and fallback_keys is not None:
        try:
            import keyring  # type: ignore

            try:
                keyring.delete_password(_KEYRING_SERVICE, "gemini_fallback_keys")
            except Exception:
                pass
        except Exception:
            pass


def _preserve_extra_config_keys(current_cfg: dict, data: dict) -> None:
    for preserve_key in ("session_root",):
        if preserve_key in current_cfg and preserve_key not in data:
            data[preserve_key] = current_cfg[preserve_key]


def _atomic_write_json(file_path: str, data: dict) -> None:
    try:
        os.makedirs(os.path.dirname(file_path), exist_ok=True)
    except Exception:
        pass

    tmp_path = file_path + ".tmp"
    try:
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        os.replace(tmp_path, file_path)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise

    if platform.system() != "Windows":
        try:
            os.chmod(file_path, 0o600)
        except Exception:
            pass


def _write_legacy_config_if_requested(data: dict) -> None:
    try:
        if str(os.environ.get("EL_SBOBINATOR_WRITE_LEGACY_CONFIG", "")).strip() in (
            "1",
            "true",
            "TRUE",
            "yes",
            "YES",
        ):
            _atomic_write_json(LEGACY_CONFIG_FILE, data)
    except Exception:
        pass


def save_config(
    api_key: str | None,
    fallback_keys: list | None = None,
    preferred_model: str | None = None,
    fallback_models: list | None = None,
) -> None:
    global _config_cache, _config_cache_gen
    with _write_lock:
        with _config_lock:
            _config_cache = None
            _config_cache_gen += 1

        api_key_norm = str(api_key or "").strip()
        data: dict = {"api_key": api_key_norm}
        current_cfg = _read_raw_existing_config()

        preferred_model_norm = sanitize_model_name(
            preferred_model
            if preferred_model is not None
            else current_cfg.get("preferred_model"),
            DEFAULT_MODEL,
        )
        fallback_models_norm = sanitize_fallback_models(
            fallback_models
            if fallback_models is not None
            else current_cfg.get("fallback_models"),
            preferred_model_norm,
            DEFAULT_FALLBACK_MODELS,
        )
        data["preferred_model"] = preferred_model_norm
        data["fallback_models"] = fallback_models_norm

        _prepare_fallback_keys(fallback_keys, current_cfg, data)

        if platform.system() == "Windows":
            _secure_primary_key_windows(api_key, api_key_norm, current_cfg, data)
        else:
            _secure_primary_key_posix(api_key, api_key_norm, current_cfg, data)

        _secure_fallback_keys(fallback_keys, data)
        _preserve_extra_config_keys(current_cfg, data)

        _atomic_write_json(CONFIG_FILE, data)
        _write_legacy_config_if_requested(data)


def save_session_root_to_config(path: str) -> None:
    """Persist a custom session_root to config.json without touching credentials."""
    global _config_cache, _config_cache_gen
    with _write_lock:
        with _config_lock:
            _config_cache = None
            _config_cache_gen += 1
        current_cfg = _read_raw_existing_config()
        current_cfg["session_root"] = str(path)
        _atomic_write_json(CONFIG_FILE, current_cfg)
