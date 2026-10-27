"""Pytest configuration ensuring EL_SBOBINATOR_TESTING environment variable is set."""

from __future__ import annotations

import os

import pytest

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
