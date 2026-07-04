"""Pytest configuration ensuring EL_SBOBINATOR_TESTING environment variable is set."""

from __future__ import annotations

import os

os.environ["EL_SBOBINATOR_TESTING"] = "1"
