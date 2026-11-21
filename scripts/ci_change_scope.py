"""Classify the CI change range: documentation only, and whether desktop checks run."""

from __future__ import annotations

import os
import subprocess
from collections.abc import Iterable, Mapping
from pathlib import PurePosixPath

DOCS_FILES = {"README.md", "DISCLAIMER.md"}
DOCS_SUFFIXES = {".md", ".rst", ".txt"}
# The Windows and macOS jobs check only the desktop Python app (--skip-webui), so a
# change confined to these paths cannot break them. Anything else, including a new
# or unknown path, still runs them.
WEB_DIRECTORIES = {"webui", "functions"}
WEB_FILES = {
    ".github/workflows/web-release.yml",
    ".github/workflows/web-staging.yml",
    ".github/dependabot.yml",
}
# The desktop app is a frozen backup: the nightly run on the other days skips its
# Windows and macOS checks, the weekly one keeps them. Both must match build.yml;
# any other schedule string runs them (fails closed).
WEEKLY_DESKTOP_SCHEDULE = "20 6 * * 1"
DAILY_WEB_SCHEDULE = "20 6 * * 0,2-6"


def is_documentation(path: PurePosixPath) -> bool:
    # Keep code, dependency files and workflow changes outside the exemption.
    return str(path) in DOCS_FILES or (
        path.parts[0] == "docs" and path.suffix in DOCS_SUFFIXES
    )


def is_web_only(path: PurePosixPath) -> bool:
    return (
        is_documentation(path)
        or (len(path.parts) > 1 and path.parts[0] in WEB_DIRECTORIES)
        or str(path) in WEB_FILES
    )


def classify(paths: Iterable[str] | None) -> dict[str, bool]:
    """An unknown or empty change range runs every check."""
    changed = [PurePosixPath(path) for path in paths or ()]
    if not changed:
        return {"docs_only": False, "desktop_checks": True}
    return {
        "docs_only": all(is_documentation(path) for path in changed),
        "desktop_checks": not all(is_web_only(path) for path in changed),
    }


def scope_for(env: Mapping[str, str], paths: Iterable[str] | None) -> dict[str, bool]:
    scope = classify(paths)
    if (
        env.get("EVENT_NAME") == "schedule"
        and env.get("SCHEDULE", "") == DAILY_WEB_SCHEDULE
    ):
        scope["desktop_checks"] = False
    return scope


def revision_range(env: Mapping[str, str]) -> str | None:
    """Only pull requests and branch pushes have a range; schedule, tags and
    manual runs check everything."""
    event = env.get("EVENT_NAME", "")
    if event == "pull_request":
        base = env.get("PR_BASE_SHA", "")
        head = env.get("PR_HEAD_SHA", "")
        if base and head:
            return f"{base}...{head}"
    elif event == "push" and env.get("EVENT_REF", "").startswith("refs/heads/"):
        before = env.get("BEFORE_SHA", "")
        head = env.get("CURRENT_SHA", "")
        if before and before != "0" * 40 and head:
            return f"{before}..{head}"
    return None


def changed_paths(revisions: str | None) -> list[str] | None:
    if not revisions:
        return None
    try:
        changed = subprocess.check_output(
            ["git", "diff", "--no-renames", "--name-only", "-z", revisions, "--"]
        ).split(b"\0")
    except subprocess.CalledProcessError:
        print("Change range unavailable; running all checks.")
        return None
    return [os.fsdecode(path) for path in changed if path]


def main() -> None:
    scope = scope_for(os.environ, changed_paths(revision_range(os.environ)))
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
        for name, value in scope.items():
            output.write(f"{name}={str(value).lower()}\n")
    print(f"Documentation-only exemption: {str(scope['docs_only']).lower()}")
    print(f"Windows and macOS desktop checks: {str(scope['desktop_checks']).lower()}")


if __name__ == "__main__":
    main()
