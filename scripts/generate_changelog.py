#!/usr/bin/env python3
"""
Generate release notes/changelog from git commits and tag annotations.
Supports Conventional Commits formatting and groups changes accordingly.
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys


def run_git(args: list[str]) -> str:
    result = subprocess.run(["git", *args], capture_output=True, text=True, check=True)
    return result.stdout.strip()


def get_commits(tag: str) -> list[tuple[str, str]]:
    # Resolve tag to a valid commit or ref. If it doesn't exist (e.g. manual dispatch run before tagging), fall back to "HEAD"
    resolved_tag = tag
    try:
        run_git(["rev-parse", "--verify", tag])
    except Exception:
        resolved_tag = "HEAD"

    # Get previous tag
    prev_ref = ""
    try:
        prev_ref = run_git(["describe", "--tags", "--abbrev=0", f"{resolved_tag}^"])
    except Exception:
        pass

    if not prev_ref:
        commit_range = resolved_tag
    else:
        commit_range = f"{prev_ref}..{resolved_tag}"

    commits: list[tuple[str, str]] = []
    try:
        log_out = run_git(["log", commit_range, "--format=%h|%s"])
        if log_out:
            for line in log_out.splitlines():
                if "|" in line:
                    h, s = line.split("|", 1)
                    commits.append((h, s))
    except Exception as e:
        print(f"Error getting commits: {e}", file=sys.stderr)
    return commits


def categorize_commits(
    commits: list[tuple[str, str]], repo: str | None
) -> dict[str, list[str]]:
    categories: dict[str, list[str]] = {
        "🚀 Features": [],
        "🐛 Bug Fixes": [],
        "📝 Documentation": [],
        "⬆️ Dependencies": [],
        "🧰 Maintenance & Refactoring": [],
        "Other Changes": [],
    }

    type_mapping = {
        "feat": "🚀 Features",
        "fix": "🐛 Bug Fixes",
        "docs": "📝 Documentation",
        "dependencies": "⬆️ Dependencies",
        "deps": "⬆️ Dependencies",
        "chore": "🧰 Maintenance & Refactoring",
        "refactor": "🧰 Maintenance & Refactoring",
        "perf": "🧰 Maintenance & Refactoring",
        "test": "🧰 Maintenance & Refactoring",
        "style": "🧰 Maintenance & Refactoring",
        "ci": "🧰 Maintenance & Refactoring",
        "build": "🧰 Maintenance & Refactoring",
    }

    pattern = re.compile(r"^([a-zA-Z0-9_\-]+)(?:\(([^)]+)\))?!?:\s*(.+)$")

    for h, s in commits:
        match = pattern.match(s)
        if match:
            ctype, scope, desc = match.groups()
            ctype_lower = ctype.lower()
            scope_lower = scope.lower() if scope else ""

            if (
                ctype_lower in ["deps", "dependencies"]
                or "deps" in scope_lower
                or "dependencies" in scope_lower
            ):
                category = "⬆️ Dependencies"
            else:
                category = type_mapping.get(ctype_lower, "Other Changes")

            link = (
                f"([`{h}`](https://github.com/{repo}/commit/{h}))" if repo else f"({h})"
            )
            if scope:
                item = f"- **{scope}**: {desc} {link}"
            else:
                item = f"- {desc} {link}"

            categories[category].append(item)
        else:
            link = (
                f"([`{h}`](https://github.com/{repo}/commit/{h}))" if repo else f"({h})"
            )
            item = f"- {s} {link}"
            categories["Other Changes"].append(item)
    return categories


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate release notes from git commits."
    )
    parser.add_argument(
        "--tag", required=True, help="The current tag/ref for the release."
    )
    parser.add_argument(
        "--custom-body",
        default="",
        help="Optional custom message to prepend to the release notes.",
    )
    parser.add_argument(
        "--output", required=True, help="Path to write the markdown output."
    )
    args = parser.parse_args()

    tag = args.tag

    # Ensure tags are fetched
    try:
        subprocess.run(["git", "fetch", "--tags", "--force"], check=False)
    except Exception:
        pass

    # Get tag annotation message if tag is an annotated tag
    tag_msg = ""
    try:
        tag_type = run_git(["cat-file", "-t", tag])
        if tag_type == "tag":
            # Strip refs/tags/ prefix if present so git tag -l matches correctly
            clean_tag = (
                tag[len("refs/tags/") :] if tag.startswith("refs/tags/") else tag
            )
            tag_msg = run_git(["tag", "-l", "--format=%(contents)", clean_tag])
    except Exception:
        pass

    commits = get_commits(tag)
    repo = os.environ.get("GITHUB_REPOSITORY")
    categories = categorize_commits(commits, repo)

    # Write markdown file
    with open(args.output, "w", encoding="utf-8") as f:
        # Prepend custom body if provided
        env_body = os.environ.get("CUSTOM_RELEASE_BODY")
        custom_body = (env_body if env_body is not None else args.custom_body).strip()
        if custom_body:
            f.write(f"{custom_body}\n\n")
        elif tag_msg.strip():
            f.write(f"{tag_msg.strip()}\n\n")

        f.write("## Changes\n\n")

        has_content = False
        for cat, items in categories.items():
            if items:
                f.write(f"### {cat}\n")
                for item in items:
                    f.write(f"{item}\n")
                f.write("\n")
                has_content = True

        if not has_content:
            f.write("* No changes\n")

    print(f"Changelog written to {args.output}")


if __name__ == "__main__":
    main()
