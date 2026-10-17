import json
import subprocess
import sys

import pytest

from scripts import ci_editor_deps
from scripts.ci_editor_deps import editor_engine_changed, editor_versions


def _lock(**versions: str) -> str:
    packages = {"": {"name": "webui"}}
    packages.update(
        {f"node_modules/{name}": {"version": v} for name, v in versions.items()}
    )
    return json.dumps({"lockfileVersion": 3, "packages": packages})


def _git(*args: str) -> str:
    return subprocess.check_output(["git", *args], text=True).strip()


@pytest.fixture
def repository(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    _git("init", "-q", "-b", "main")
    (tmp_path / "README.md").write_text("fixture", encoding="utf-8")
    return tmp_path


def _commit(root, lock: str | None, message: str) -> str:
    path = root / "webui" / "package-lock.json"
    if lock is None:
        (root / "README.md").write_text(message, encoding="utf-8")
    else:
        path.parent.mkdir(exist_ok=True)
        path.write_text(lock, encoding="utf-8")
    _git("add", "-A")
    _git(
        "-c",
        "user.name=CI fixture",
        "-c",
        "user.email=ci@example.invalid",
        "commit",
        "-qm",
        message,
    )
    return _git("rev-parse", "HEAD")


def test_editor_versions_keep_tiptap_and_nested_prosemirror_only():
    lock = json.loads(
        _lock(
            **{
                "@tiptap/pm": "3.32.0",
                "prosemirror-view": "1.42.6",
                "motion": "14.2.0",
                "@tiptap-pro/other": "1.0.0",
            }
        )
    )
    lock["packages"]["node_modules/@tiptap/pm/node_modules/prosemirror-model"] = {
        "version": "1.25.12"
    }

    assert editor_versions(json.dumps(lock)) == {
        "node_modules/@tiptap/pm": "3.32.0",
        "node_modules/prosemirror-view": "1.42.6",
        "node_modules/@tiptap/pm/node_modules/prosemirror-model": "1.25.12",
    }
    assert editor_versions("") == {}


def test_transitive_prosemirror_update_requires_full_suite(repository):
    base = _commit(repository, _lock(**{"prosemirror-view": "1.42.3"}), "base")
    head = _commit(repository, _lock(**{"prosemirror-view": "1.42.6"}), "bump")

    assert editor_engine_changed(base, head) is True


def test_unrelated_dependency_update_keeps_smoke_only(repository):
    base = _commit(
        repository, _lock(**{"@tiptap/core": "3.31.4", "motion": "14.1.0"}), "base"
    )
    head = _commit(
        repository, _lock(**{"@tiptap/core": "3.31.4", "motion": "14.2.0"}), "bump"
    )

    assert editor_engine_changed(base, head) is False


def test_editor_updates_already_on_base_are_not_attributed_to_branch(repository):
    start = _commit(repository, _lock(**{"@tiptap/core": "3.31.4"}), "start")
    _git("checkout", "-qb", "feature")
    head = _commit(repository, None, "docs on branch")
    _git("checkout", "-q", "main")
    base = _commit(repository, _lock(**{"@tiptap/core": "3.32.0"}), "main bump")

    assert start != base
    assert editor_engine_changed(base, head) is False


def test_added_or_removed_editor_package_counts_as_change(repository):
    empty = _commit(repository, None, "no lockfile yet")
    added = _commit(repository, _lock(**{"@tiptap/react": "3.32.0"}), "add editor")
    removed = _commit(repository, _lock(), "remove editor")

    assert editor_engine_changed(empty, added) is True
    assert editor_engine_changed(added, removed) is True


@pytest.mark.parametrize("base", ["", "0" * 40, "f" * 40])
def test_unknown_range_runs_full_suite(repository, base):
    head = _commit(repository, _lock(**{"motion": "14.2.0"}), "only")

    assert editor_engine_changed(base, head) is True


def test_main_writes_github_output(repository, monkeypatch, tmp_path):
    base = _commit(repository, _lock(**{"prosemirror-model": "1.25.11"}), "base")
    head = _commit(repository, _lock(**{"prosemirror-model": "1.25.12"}), "bump")
    output = tmp_path / "github-output"
    monkeypatch.setenv("GITHUB_OUTPUT", str(output))
    monkeypatch.setattr(
        sys, "argv", ["ci_editor_deps.py", "--base", base, "--head", head]
    )

    ci_editor_deps.main()

    assert output.read_text(encoding="utf-8") == "editor_engine=true\n"
