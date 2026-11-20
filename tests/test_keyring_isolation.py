"""Tests never reach the OS keyring: on macOS a saved key used to leak between tests."""

from __future__ import annotations

import platform

import keyring
import pytest

from el_sbobinator.core.credentials import KEYRING_SERVICE, KEYRING_USER_API
from el_sbobinator.services import config_service
from tests.conftest import InMemoryKeyring


@pytest.fixture
def macos(monkeypatch, tmp_path):
    monkeypatch.setattr(platform, "system", lambda: "Darwin")
    monkeypatch.setattr(config_service, "CONFIG_FILE", str(tmp_path / "config.json"))
    monkeypatch.setattr(
        config_service, "LEGACY_CONFIG_FILE", str(tmp_path / "legacy.json")
    )
    config_service._config_cache = None
    yield
    config_service._config_cache = None


@pytest.mark.parametrize("run", ["first", "second"])
def test_key_saved_by_one_test_is_not_seen_by_the_next(macos, isolate_os_keyring, run):
    assert keyring.get_keyring() is isolate_os_keyring
    assert isinstance(isolate_os_keyring, InMemoryKeyring)
    # Whichever run goes second in this process starts from an empty keyring.
    assert isolate_os_keyring.passwords == {}
    assert config_service.load_config()["api_key"] == ""

    config_service.save_config("leaked-key")

    assert (
        isolate_os_keyring.get_password(KEYRING_SERVICE, KEYRING_USER_API)
        == "leaked-key"
    )
    assert config_service.load_config()["api_key"] == "leaked-key"
