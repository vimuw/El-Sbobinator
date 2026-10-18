import os
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
# Test modules whose fixtures run `git init` / `git add` / `git commit` in tmp_path.
GIT_FIXTURE_MODULES = ("tests/test_ci_release.py", "tests/test_ci_editor_deps.py")


def _git(*args: str, cwd: Path) -> str:
    return subprocess.check_output(["git", *args], cwd=cwd, text=True).strip()


def test_git_fixtures_leave_hook_repository_untouched(tmp_path):
    # Mirror a pre-push hook fired from a linked worktree: git exports GIT_DIR
    # pointing at the worktree's gitdir inside the main repository.
    sentinel = tmp_path / "sentinel"
    _git("init", "-q", "-b", "main", str(sentinel), cwd=tmp_path)
    _git(
        "-c",
        "user.name=Sentinel",
        "-c",
        "user.email=sentinel@example.invalid",
        "commit",
        "-q",
        "--allow-empty",
        "-m",
        "sentinel",
        cwd=sentinel,
    )
    _git(
        "worktree", "add", "-q", "-b", "linked", str(tmp_path / "linked"), cwd=sentinel
    )
    head = _git("rev-parse", "HEAD", cwd=sentinel)
    commit_count = _git("rev-list", "--all", "--count", cwd=sentinel)

    env = dict(os.environ)
    env["GIT_DIR"] = str(sentinel / ".git" / "worktrees" / "linked")
    env["GIT_PREFIX"] = ""
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "pytest",
            "-q",
            "-p",
            "no:cacheprovider",
            "-p",
            "no:xdist",
            "-o",
            "addopts=",
            *GIT_FIXTURE_MODULES,
        ],
        cwd=REPO_ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=300,
    )

    assert result.returncode == 0, result.stdout + result.stderr
    assert _git("config", "--bool", "core.bare", cwd=sentinel) == "false"
    assert _git("rev-parse", "HEAD", cwd=sentinel) == head
    assert _git("rev-list", "--all", "--count", cwd=sentinel) == commit_count
    assert _git("status", "--porcelain", cwd=sentinel) == ""
