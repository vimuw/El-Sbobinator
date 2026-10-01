"""Pytest configuration ensuring EL_SBOBINATOR_TESTING environment variable is set."""

from __future__ import annotations

import os

import pytest

os.environ["EL_SBOBINATOR_TESTING"] = "1"


@pytest.fixture(autouse=True)
def isolate_credential_runtime():
    from el_sbobinator.services import config_service

    config_service._credential_overrides.clear()
    yield
    config_service._credential_overrides.clear()
