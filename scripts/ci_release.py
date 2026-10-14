"""Validate the source revision and complete assets used by release CI."""

from __future__ import annotations

import argparse
import hashlib
import os
import re
import shutil
import subprocess
from pathlib import Path


def verify_tag(tag: str, commit: str) -> None:
    """Allow a new tag, but never attach another revision to an existing tag."""
    subprocess.run(["git", "check-ref-format", f"refs/tags/{tag}"], check=True)
    found = subprocess.run(
        ["git", "rev-parse", "--verify", f"refs/tags/{tag}^{{commit}}"],
        capture_output=True,
        text=True,
    )
    if found.returncode == 0 and found.stdout.strip() != commit:
        raise ValueError(
            f"Tag {tag} points to another commit; use that revision or a new tag."
        )


def release_context(
    event: str, ref: str, requested_tag: str, commit: str
) -> dict[str, str]:
    tag = ref.removeprefix("refs/tags/") if event == "push" else requested_tag
    if event not in {"push", "workflow_dispatch"}:
        raise ValueError("Release context requires a tag push or manual build.")
    if event == "push" and not ref.startswith("refs/tags/"):
        raise ValueError("A branch push cannot publish a release.")
    version = tag.removeprefix("v") if tag else "0.0.0"
    if not re.fullmatch(
        r"\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?"
        r"(?:\+[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?",
        version,
    ):
        raise ValueError("Use a version tag such as v2.8.0 or v2.8.0-rc.1.")
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
    if head != commit:
        raise ValueError("Checkout does not match the workflow revision.")
    if tag:
        verify_tag(tag, commit)
    return {
        "tag": tag,
        "version": version,
        "commit": commit,
        "prerelease": str("-" in version.split("+", 1)[0]).lower(),
    }


def collect_assets(source: Path, destination: Path, version: str) -> None:
    """Require both platform packages and verify their checksums before copying."""
    packages = [f"El-Sbobinator-Setup-v{version}.exe", f"El-Sbobinator-v{version}.dmg"]
    assets: list[Path] = []
    for name in packages:
        matches = list(source.rglob(name))
        checksums = list(source.rglob(f"{name}.sha256"))
        if len(matches) != 1 or len(checksums) != 1:
            raise ValueError(f"Expected exactly one package and checksum for {name}.")
        package, checksum = matches[0], checksums[0]
        if not package.is_file() or package.stat().st_size == 0:
            raise ValueError(f"Missing or empty package: {name}")
        expected = checksum.read_text(encoding="utf-8").strip().split("  ", 1)
        with package.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        if expected != [digest, name]:
            raise ValueError(f"Checksum does not match {name}.")
        assets.extend([package, checksum])
    destination.mkdir(parents=True, exist_ok=True)
    for asset in assets:
        shutil.copy2(asset, destination / asset.name)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("context")
    verify = commands.add_parser("verify-tag")
    verify.add_argument("--tag", required=True)
    verify.add_argument("--commit", required=True)
    collect = commands.add_parser("collect-assets")
    collect.add_argument("--source", type=Path, default=Path("output_files"))
    collect.add_argument("--destination", type=Path, default=Path("release_assets"))
    collect.add_argument("--version", required=True)
    args = parser.parse_args()
    if args.command == "context":
        context = release_context(
            os.environ["GITHUB_EVENT_NAME"],
            os.environ["GITHUB_REF"],
            os.environ.get("REQUESTED_TAG", ""),
            os.environ["GITHUB_SHA"],
        )
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
            for key, value in context.items():
                output.write(f"{key}={value}\n")
    elif args.command == "verify-tag":
        verify_tag(args.tag, args.commit)
    else:
        collect_assets(args.source, args.destination, args.version)


if __name__ == "__main__":
    main()
