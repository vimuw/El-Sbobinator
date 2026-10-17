"""Decide when CI must run the complete Chromium suite for editor engine updates."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess

LOCKFILE = "webui/package-lock.json"
# TipTap bundles ProseMirror through @tiptap/pm, so its engine changes appear only
# as transitive lock entries; nested copies count as well.
EDITOR_PACKAGE = re.compile(r"(?:^|/)node_modules/(?:@tiptap/[^/]+|prosemirror-[^/]+)$")


def editor_versions(lock_text: str) -> dict[str, str]:
    if not lock_text.strip():
        return {}
    packages = json.loads(lock_text).get("packages", {})
    return {
        path: str(info.get("version", ""))
        for path, info in packages.items()
        if EDITOR_PACKAGE.search(path)
    }


def lockfile_at(revision: str) -> str:
    shown = subprocess.run(
        ["git", "show", f"{revision}:{LOCKFILE}"],
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    return shown.stdout if shown.returncode == 0 else ""


def editor_engine_changed(base: str, head: str) -> bool:
    """Compare the head lock with its merge base; an unknown range runs the suite."""
    if not base or not head or set(base) == {"0"}:
        print("Change range unavailable; running the complete browser suite.")
        return True
    found = subprocess.run(
        ["git", "merge-base", base, head], capture_output=True, text=True
    )
    if found.returncode != 0:
        print("Change range unavailable; running the complete browser suite.")
        return True
    before = editor_versions(lockfile_at(found.stdout.strip()))
    after = editor_versions(lockfile_at(head))
    changed = sorted(
        path.rsplit("node_modules/", 1)[1]
        for path in before.keys() | after.keys()
        if before.get(path) != after.get(path)
    )
    for name in dict.fromkeys(changed):
        print(f"Editor engine package changed: {name}")
    return bool(changed)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="")
    parser.add_argument("--head", required=True)
    args = parser.parse_args()
    value = str(editor_engine_changed(args.base, args.head)).lower()
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
        output.write(f"editor_engine={value}\n")
    print(f"Editor engine changed: {value}")


if __name__ == "__main__":
    main()
