"""Pytest configuration ensuring EL_SBOBINATOR_TESTING environment variable is set."""

from __future__ import annotations

import os

import keyring
import pytest
from keyring.backend import KeyringBackend
from keyring.errors import PasswordDeleteError

os.environ["EL_SBOBINATOR_TESTING"] = "1"

# Variables that pin git to a specific repository (`git rev-parse --local-env-vars`).
# Git hooks export some of them (a pre-push from a linked worktree sets GIT_DIR), so
# a fixture running `git init` in tmp_path would otherwise re-initialize the real
# repository and write `core.bare = true` into its config.
GIT_REPOSITORY_ENV_VARS = (
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_CONFIG",
    "GIT_CONFIG_PARAMETERS",
    "GIT_CONFIG_COUNT",
    "GIT_OBJECT_DIRECTORY",
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_IMPLICIT_WORK_TREE",
    "GIT_GRAFT_FILE",
    "GIT_INDEX_FILE",
    "GIT_NO_REPLACE_OBJECTS",
    "GIT_REPLACE_REF_BASE",
    "GIT_PREFIX",
    "GIT_SHALLOW_FILE",
    "GIT_COMMON_DIR",
)


@pytest.fixture(autouse=True)
def isolate_git_repository_env(monkeypatch):
    for name in GIT_REPOSITORY_ENV_VARS:
        monkeypatch.delenv(name, raising=False)


@pytest.fixture(autouse=True)
def isolate_credential_runtime():
    from el_sbobinator.services import config_service

    config_service._credential_overrides.clear()
    yield
    config_service._credential_overrides.clear()


class InMemoryKeyring(KeyringBackend):
    """A keyring that lives for one test only."""

    priority = 1  # type: ignore[assignment]

    def __init__(self) -> None:
        super().__init__()
        self.passwords: dict[tuple[str, str], str] = {}

    def get_password(self, service: str, username: str) -> str | None:
        return self.passwords.get((service, username))

    def set_password(self, service: str, username: str, password: str) -> None:
        self.passwords[(service, username)] = password

    def delete_password(self, service: str, username: str) -> None:
        if self.passwords.pop((service, username), None) is None:
            raise PasswordDeleteError(username)


@pytest.fixture(autouse=True)
def isolate_os_keyring():
    # On macOS and Linux save_config stores the API key in the OS keyring. Without
    # this, a test that saves "fake-key" writes it into the runner's (or the
    # developer's) real Keychain, and later tests in that process read it back.
    previous = keyring.get_keyring()
    backend = InMemoryKeyring()
    keyring.set_keyring(backend)
    yield backend
    keyring.set_keyring(previous)
