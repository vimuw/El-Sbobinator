import hashlib
import subprocess
from pathlib import Path

import pytest

from scripts.ci_release import collect_assets, release_context, verify_tag


@pytest.fixture
def repository(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    subprocess.run(["git", "init", "-q"], check=True)
    (tmp_path / "README.md").write_text("fixture", encoding="utf-8")
    subprocess.run(["git", "add", "README.md"], check=True)
    subprocess.run(
        [
            "git",
            "-c",
            "user.name=CI fixture",
            "-c",
            "user.email=ci@example.invalid",
            "commit",
            "-qm",
            "fixture",
        ],
        check=True,
    )
    return subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()


def test_manual_stable_release_on_hyphenated_branch_is_stable(repository):
    context = release_context(
        "workflow_dispatch", "refs/heads/codex/release-test", "v2.8.0", repository
    )
    assert context == {
        "tag": "v2.8.0",
        "version": "2.8.0",
        "commit": repository,
        "prerelease": "false",
    }


def test_manual_build_without_tag_does_not_request_publication(repository):
    context = release_context("workflow_dispatch", "refs/heads/main", "", repository)
    assert context["tag"] == ""
    assert context["version"] == "0.0.0"


def test_manual_build_on_a_tag_without_release_input_does_not_publish(repository):
    context = release_context("workflow_dispatch", "refs/tags/v2.8.0", "", repository)
    assert context["tag"] == ""
    assert context["version"] == "0.0.0"


@pytest.mark.parametrize(
    ("tag", "prerelease"),
    [("v2.8.0-rc.1", "true"), ("v2.8.0", "false"), ("v2.8.0+build-test", "false")],
)
def test_tag_push_uses_tag_instead_of_manual_input(repository, tag, prerelease):
    context = release_context("push", f"refs/tags/{tag}", "v9.9.9", repository)
    assert context["tag"] == tag
    assert context["prerelease"] == prerelease


def test_existing_annotated_tag_on_built_commit_is_allowed(repository):
    subprocess.run(
        [
            "git",
            "-c",
            "user.name=CI fixture",
            "-c",
            "user.email=ci@example.invalid",
            "tag",
            "-am",
            "release",
            "v2.8.0",
        ],
        check=True,
    )
    verify_tag("v2.8.0", repository)


def test_existing_tag_on_another_commit_blocks_manual_release(repository):
    subprocess.run(["git", "tag", "v2.8.0"], check=True)
    subprocess.run(
        [
            "git",
            "-c",
            "user.name=CI fixture",
            "-c",
            "user.email=ci@example.invalid",
            "commit",
            "--allow-empty",
            "-qm",
            "another revision",
        ],
        check=True,
    )
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
    with pytest.raises(ValueError, match="another commit"):
        release_context("workflow_dispatch", "refs/heads/main", "v2.8.0", head)


def test_tag_recheck_detects_change_after_build(repository):
    verify_tag("v2.8.0", repository)
    subprocess.run(["git", "tag", "v2.8.0"], check=True)
    with pytest.raises(ValueError, match="another commit"):
        verify_tag("v2.8.0", "0" * 40)


def test_checkout_must_match_workflow_revision(repository):
    with pytest.raises(ValueError, match="workflow revision"):
        release_context("workflow_dispatch", "refs/heads/main", "v2.8.0", "0" * 40)


@pytest.mark.parametrize(
    "tag", ["v2.8.0\ninvalid=output", "vbanana", "v2.8", " v2.8.0"]
)
def test_invalid_release_version_is_rejected_before_build(repository, tag):
    with pytest.raises(ValueError, match="version tag"):
        release_context("workflow_dispatch", "refs/heads/main", tag, repository)


def write_assets(source):
    packages = ["El-Sbobinator-Setup-v2.8.0.exe", "El-Sbobinator-v2.8.0.dmg"]
    for index, name in enumerate(packages):
        directory = source / str(index)
        directory.mkdir(parents=True)
        data = name.encode()
        (directory / name).write_bytes(data)
        (directory / f"{name}.sha256").write_text(
            f"{hashlib.sha256(data).hexdigest()}  {name}\n", encoding="utf-8"
        )
    return list(source.rglob("*.*"))


def test_complete_verified_assets_are_collected(tmp_path):
    source, destination = tmp_path / "download", tmp_path / "release"
    assets = write_assets(source)
    collect_assets(source, destination, "2.8.0")
    assert sorted(path.name for path in destination.iterdir()) == sorted(
        path.name for path in assets
    )
    for asset in assets:
        assert (destination / asset.name).read_bytes() == asset.read_bytes()


@pytest.mark.parametrize("suffix", [".exe", ".dmg", ".exe.sha256", ".dmg.sha256"])
def test_missing_package_or_checksum_blocks_publication(tmp_path, suffix):
    source, destination = tmp_path / "download", tmp_path / "release"
    assets = write_assets(source)
    next(path for path in assets if path.name.endswith(suffix)).unlink()
    with pytest.raises(ValueError, match="exactly one"):
        collect_assets(source, destination, "2.8.0")
    assert not destination.exists()


def test_mismatched_checksum_blocks_publication(tmp_path):
    source, destination = tmp_path / "download", tmp_path / "release"
    assets = write_assets(source)
    next(path for path in assets if path.suffix == ".dmg").write_bytes(b"corrupted")
    with pytest.raises(ValueError, match="Checksum"):
        collect_assets(source, destination, "2.8.0")
    assert not destination.exists()


def test_duplicate_packages_are_rejected(tmp_path):
    source, destination = tmp_path / "download", tmp_path / "release"
    assets = write_assets(source)
    package = next(path for path in assets if path.suffix == ".exe")
    duplicate = source / "duplicate" / package.name
    duplicate.parent.mkdir()
    duplicate.write_bytes(package.read_bytes())
    with pytest.raises(ValueError, match="exactly one"):
        collect_assets(source, destination, "2.8.0")


def test_empty_package_blocks_publication(tmp_path):
    source, destination = tmp_path / "download", tmp_path / "release"
    assets = write_assets(source)
    next(path for path in assets if path.suffix == ".exe").write_bytes(b"")
    with pytest.raises(ValueError, match="empty package"):
        collect_assets(source, destination, "2.8.0")
