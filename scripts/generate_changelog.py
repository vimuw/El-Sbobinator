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
    result = subprocess.run(
        ["git", *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=True,
    )
    return result.stdout.strip()


def get_previous_tag(resolved_tag: str, current_tag: str = "") -> str:
    clean_tag = (
        current_tag[len("refs/tags/") :]
        if current_tag.startswith("refs/tags/")
        else current_tag
    )
    cmd = ["describe", "--tags", "--abbrev=0"]
    if clean_tag:
        cmd.extend(["--exclude", clean_tag])
    cmd.append(f"{resolved_tag}^")
    try:
        tag_out = run_git(cmd)
        if tag_out == clean_tag or tag_out == resolved_tag:
            return ""
        return tag_out
    except Exception:
        return ""


def get_commits(tag: str, max_commits: int = 0) -> list[tuple[str, str]]:
    clean_tag = tag[len("refs/tags/") :] if tag.startswith("refs/tags/") else tag
    resolved_tag = clean_tag
    try:
        run_git(["rev-parse", "--verify", clean_tag])
    except Exception:
        resolved_tag = "HEAD"

    prev_ref = get_previous_tag(resolved_tag, current_tag=clean_tag)

    effective_max = max_commits
    if not prev_ref or prev_ref == clean_tag:
        commit_range = resolved_tag
        if max_commits == 0:
            effective_max = 50
    else:
        commit_range = f"{prev_ref}..{resolved_tag}"

    commits: list[tuple[str, str]] = []
    try:
        cmd = ["log", "--format=%h|%s"]
        if effective_max > 0:
            cmd.extend(["-n", str(effective_max)])
        cmd.append(commit_range)
        log_out = run_git(cmd)
        if log_out:
            for line in log_out.splitlines():
                if "|" in line:
                    h, s = line.split("|", 1)
                    commits.append((h, s))
    except Exception as e:
        print(f"Error getting commits: {e}", file=sys.stderr)
    return commits


def uncapitalize_first(text: str) -> str:
    if not text:
        return text
    words = text.split(maxsplit=1)
    if words and len(words[0]) > 1 and words[0].isupper():
        return text
    return text[0].lower() + text[1:]


def categorize_commits(
    commits: list[tuple[str, str]], repo: str | None
) -> dict[str, list[str]]:
    categories: dict[str, list[str]] = {
        "Features": [],
        "Bug Fixes": [],
        "Documentation": [],
        "Dependencies": [],
        "Maintenance & Refactoring": [],
        "Other Changes": [],
    }

    type_mapping = {
        "feat": "Features",
        "fix": "Bug Fixes",
        "docs": "Documentation",
        "dependencies": "Dependencies",
        "deps": "Dependencies",
        "chore": "Maintenance & Refactoring",
        "refactor": "Maintenance & Refactoring",
        "perf": "Maintenance & Refactoring",
        "test": "Maintenance & Refactoring",
        "style": "Maintenance & Refactoring",
        "ci": "Maintenance & Refactoring",
        "build": "Maintenance & Refactoring",
    }

    pattern = re.compile(r"^([a-zA-Z0-9_\-]+)(?:\(([^)]+)\))?!?:\s*(.+)$")

    for h, s in commits:
        match = pattern.match(s)
        if match:
            ctype, scope, desc = match.groups()
            ctype_lower = ctype.lower()
            scope_lower = scope.lower() if scope else ""
            desc = uncapitalize_first(desc)

            if repo:
                desc = re.sub(
                    r"#(\d+)", rf"[#\1](https://github.com/{repo}/pull/\1)", desc
                )

            if (
                ctype_lower in ["deps", "dependencies"]
                or "deps" in scope_lower
                or "dependencies" in scope_lower
            ):
                category = "Dependencies"
            else:
                category = type_mapping.get(ctype_lower, "Other Changes")

            link = (
                f"([`{h}`](https://github.com/{repo}/commit/{h}))" if repo else f"({h})"
            )
            if scope:
                item = f"- **{scope_lower}**: {desc} {link}"
            else:
                item = f"- {desc} {link}"

            categories[category].append(item)
        else:
            s_uncap = uncapitalize_first(s)
            if repo:
                s_uncap = re.sub(
                    r"#(\d+)", rf"[#\1](https://github.com/{repo}/pull/\1)", s_uncap
                )
            link = (
                f"([`{h}`](https://github.com/{repo}/commit/{h}))" if repo else f"({h})"
            )
            item = f"- {s_uncap} {link}"
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
        "--max-commits",
        type=int,
        default=0,
        help="Maximum number of commits to include in changelog (0 for unlimited).",
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
            clean_tag = (
                tag[len("refs/tags/") :] if tag.startswith("refs/tags/") else tag
            )
            tag_msg = run_git(["tag", "-l", "--format=%(contents)", clean_tag])
    except Exception:
        pass

    commits = get_commits(tag, max_commits=args.max_commits)
    repo = os.environ.get("GITHUB_REPOSITORY")
    categories = categorize_commits(commits, repo)

    clean_tag = tag[len("refs/tags/") :] if tag.startswith("refs/tags/") else tag
    try:
        run_git(["rev-parse", "--verify", clean_tag])
        resolved_tag = clean_tag
    except Exception:
        resolved_tag = "HEAD"
    prev_ref = get_previous_tag(resolved_tag, current_tag=clean_tag)

    # Write markdown file
    with open(args.output, "w", encoding="utf-8") as f:
        # Prepend custom body if provided
        env_body = os.environ.get("CUSTOM_RELEASE_BODY")
        custom_body = (
            env_body.strip() if env_body and env_body.strip() else args.custom_body
        ).strip()
        if custom_body:
            f.write(f"{custom_body}\n\n")
        elif tag_msg.strip():
            cleaned_msg = tag_msg.strip()
            clean_tag_lower = clean_tag.lower()
            generic_headers = {
                clean_tag_lower,
                f"release {clean_tag_lower}",
                f"release v{clean_tag_lower.lstrip('v')}",
                f"v{clean_tag_lower.lstrip('v')}",
            }
            if (
                cleaned_msg.lower() not in generic_headers
                and "## Changes" not in cleaned_msg
                and "**Full Changelog**:" not in cleaned_msg
            ):
                f.write(f"{cleaned_msg}\n\n")

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
            f.write("* No changes\n\n")

        if repo and prev_ref:
            f.write(
                f"**Full Changelog**: https://github.com/{repo}/compare/{prev_ref}...{clean_tag}\n"
            )

    print(f"Changelog written to {args.output}")


if __name__ == "__main__":
    main()
