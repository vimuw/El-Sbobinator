"""Reject direct Python imports that rely on undeclared transitive packages."""

from __future__ import annotations

import ast
import importlib.metadata
import subprocess
import sys
import tomllib
from pathlib import Path

from packaging.requirements import Requirement
from packaging.utils import canonicalize_name

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    config = tomllib.loads((ROOT / "pyproject.toml").read_text())
    declarations = list(config["project"]["dependencies"])
    for group in config["dependency-groups"].values():
        declarations.extend(group)
    declared = {canonicalize_name(Requirement(line).name) for line in declarations}
    modules = importlib.metadata.packages_distributions()
    files = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.splitlines()
    issues = []
    for filename in files:
        path = ROOT / filename
        if path.suffix not in {".py", ".pyw"} or not path.exists():
            continue
        if not filename.startswith(
            ("el_sbobinator/", "scripts/", "tests/", "launchers/", "tools/")
        ):
            continue
        tree = ast.parse(path.read_text(encoding="utf-8-sig"))
        for node in ast.walk(tree):
            names = []
            if isinstance(node, ast.Import):
                names = [item.name for item in node.names]
            elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                names = [node.module]
            else:
                continue
            for name in names:
                top = name.split(".")[0]
                if top in sys.stdlib_module_names or top in {
                    "el_sbobinator",
                    "scripts",
                    "tests",
                    "System",
                    "AppKit",
                }:
                    continue
                if not any(
                    canonicalize_name(dist) in declared for dist in modules.get(top, [])
                ):
                    issues.append(
                        f"{filename}:{node.lineno}: import {top} non dichiarato"
                    )
    if issues:
        raise RuntimeError("\n".join(sorted(set(issues))))
    print("[OK] Import Python diretti dichiarati nel manifest")


if __name__ == "__main__":
    main()
