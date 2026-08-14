"""Tests for scripts/generate_changelog.py"""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from unittest.mock import patch

from scripts.generate_changelog import (
    categorize_commits,
    get_commits,
    get_previous_tag,
    main,
    run_git,
    uncapitalize_first,
)


class TestGenerateChangelog(unittest.TestCase):
    def test_uncapitalize_first(self) -> None:
        self.assertEqual(uncapitalize_first(""), "")
        self.assertEqual(uncapitalize_first("Foo"), "foo")
        self.assertEqual(uncapitalize_first("bar"), "bar")
        self.assertEqual(uncapitalize_first("DPAPI test"), "DPAPI test")

    def test_categorize_commits(self) -> None:
        commits = [
            ("abc1234", "feat(UI): Add new dialog (#42)"),
            ("def5678", "fix: Fix bug in player"),
            ("ghi9012", "docs: update readme"),
            ("jkl3456", "deps: bump react"),
            ("mno7890", "chore: clean up code"),
            ("pqr1111", "random commit message (#100)"),
        ]
        categories = categorize_commits(commits, repo="owner/repo")
        self.assertEqual(len(categories["Features"]), 1)
        self.assertIn(
            "add new dialog ([#42](https://github.com/owner/repo/pull/42))",
            categories["Features"][0],
        )
        self.assertIn("owner/repo/commit/abc1234", categories["Features"][0])

        self.assertEqual(len(categories["Bug Fixes"]), 1)
        self.assertEqual(len(categories["Documentation"]), 1)
        self.assertEqual(len(categories["Dependencies"]), 1)
        self.assertEqual(len(categories["Maintenance & Refactoring"]), 1)
        self.assertEqual(len(categories["Other Changes"]), 1)
        self.assertIn(
            "[#100](https://github.com/owner/repo/pull/100)",
            categories["Other Changes"][0],
        )

    @patch("subprocess.run")
    def test_run_git_errors_replace(self, mock_run) -> None:
        mock_run.return_value.stdout = "  test output  \n"
        output = run_git(["status"])
        self.assertEqual(output, "test output")
        mock_run.assert_called_once()
        kwargs = mock_run.call_args.kwargs
        self.assertEqual(kwargs.get("errors"), "replace")

    @patch("scripts.generate_changelog.run_git")
    def test_get_previous_tag(self, mock_run_git) -> None:
        mock_run_git.return_value = "v0.9.0"
        prev = get_previous_tag("v1.0.0", current_tag="v1.0.0")
        self.assertEqual(prev, "v0.9.0")
        mock_run_git.assert_called_once_with(
            ["describe", "--tags", "--abbrev=0", "--exclude", "v1.0.0", "v1.0.0^"]
        )

    def test_main_custom_release_body_empty_env_fallback(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            output_file = os.path.join(tmpdir, "changelog.md")
            test_args = [
                "generate_changelog.py",
                "--tag",
                "v1.0.0",
                "--custom-body",
                "CLI Custom Body",
                "--output",
                output_file,
            ]

            def mock_git(args):
                if args[0] == "cat-file":
                    return "commit"
                if args[0] == "rev-parse":
                    return "v1.0.0"
                if args[0] == "describe":
                    return "v0.9.0"
                if args[0] == "log":
                    return "abc1234|feat: add foo"
                return ""

            with (
                patch.object(sys, "argv", test_args),
                patch("scripts.generate_changelog.run_git", side_effect=mock_git),
                patch.dict(
                    os.environ,
                    {"CUSTOM_RELEASE_BODY": "", "GITHUB_REPOSITORY": "owner/repo"},
                    clear=False,
                ),
            ):
                main()

            with open(output_file, encoding="utf-8") as f:
                content = f.read()

            self.assertIn("CLI Custom Body", content)
            self.assertIn(
                "**Full Changelog**: https://github.com/owner/repo/compare/v0.9.0...v1.0.0",
                content,
            )

    @patch("scripts.generate_changelog.run_git")
    def test_get_commits_git_log_command_args(self, mock_run_git) -> None:
        mock_run_git.side_effect = ["v1.0.0", "v0.9.0", "abc1234|feat: new feature"]
        commits = get_commits("v1.0.0", max_commits=10)
        self.assertEqual(len(commits), 1)
        self.assertEqual(commits[0], ("abc1234", "feat: new feature"))
        log_call_args = mock_run_git.call_args_list[-1][0][0]
        self.assertEqual(
            log_call_args, ["log", "--format=%h|%s", "-n", "10", "v0.9.0..v1.0.0"]
        )
        self.assertNotIn("--", log_call_args)

    def test_main_tag_msg_generic_and_duplicate_filtering(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            output_file = os.path.join(tmpdir, "changelog.md")
            test_args = [
                "generate_changelog.py",
                "--tag",
                "v1.0.0",
                "--output",
                output_file,
            ]

            # Case 1: tag_msg is generic "Release v1.0.0" -> should not be prepended
            def mock_git_generic(args):
                if args[0] == "cat-file":
                    return "tag"
                if args[0] == "tag" and args[1] == "-l":
                    return "Release v1.0.0"
                if args[0] == "rev-parse":
                    return "v1.0.0"
                if args[0] == "describe":
                    return "v0.9.0"
                if args[0] == "log":
                    return "abc1234|feat: add foo"
                return ""

            with (
                patch.object(sys, "argv", test_args),
                patch(
                    "scripts.generate_changelog.run_git", side_effect=mock_git_generic
                ),
                patch.dict(
                    os.environ, {"GITHUB_REPOSITORY": "owner/repo"}, clear=False
                ),
            ):
                main()

            with open(output_file, encoding="utf-8") as f:
                content = f.read()
            self.assertFalse(content.startswith("Release v1.0.0\n\n"))
            self.assertTrue(content.startswith("## Changes\n\n"))

            # Case 2: tag_msg is custom announcement -> should be prepended
            def mock_git_custom(args):
                if args[0] == "cat-file":
                    return "tag"
                if args[0] == "tag" and args[1] == "-l":
                    return "Exciting new update with UI refresh!"
                if args[0] == "rev-parse":
                    return "v1.0.0"
                if args[0] == "describe":
                    return "v0.9.0"
                if args[0] == "log":
                    return "abc1234|feat: add foo"
                return ""

            with (
                patch.object(sys, "argv", test_args),
                patch(
                    "scripts.generate_changelog.run_git", side_effect=mock_git_custom
                ),
                patch.dict(
                    os.environ, {"GITHUB_REPOSITORY": "owner/repo"}, clear=False
                ),
            ):
                main()

            with open(output_file, encoding="utf-8") as f:
                content = f.read()
            self.assertTrue(
                content.startswith("Exciting new update with UI refresh!\n\n## Changes")
            )

            # Case 3: tag_msg already contains full changelog -> should not be prepended twice
            def mock_git_full_changelog(args):
                if args[0] == "cat-file":
                    return "tag"
                if args[0] == "tag" and args[1] == "-l":
                    return "## Changes\n\n### Features\n- foo\n\n**Full Changelog**: https://..."
                if args[0] == "rev-parse":
                    return "v1.0.0"
                if args[0] == "describe":
                    return "v0.9.0"
                if args[0] == "log":
                    return "abc1234|feat: add foo"
                return ""

            with (
                patch.object(sys, "argv", test_args),
                patch(
                    "scripts.generate_changelog.run_git",
                    side_effect=mock_git_full_changelog,
                ),
                patch.dict(
                    os.environ, {"GITHUB_REPOSITORY": "owner/repo"}, clear=False
                ),
            ):
                main()

            with open(output_file, encoding="utf-8") as f:
                content = f.read()
            # Should have exactly one "## Changes"
            self.assertEqual(content.count("## Changes"), 1)


if __name__ == "__main__":
    unittest.main()
