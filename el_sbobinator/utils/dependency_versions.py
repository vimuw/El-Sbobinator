"""Verify the active platform's complete dependency graph against uv.lock."""

from __future__ import annotations

import hashlib
import importlib.metadata
import json
import sys
import tomllib
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class DependencyStatus:
    installed: dict[str, str] = field(default_factory=dict)
    issues: list[str] = field(default_factory=list)


def locked_versions(root: Path, *, all_groups: bool = False) -> dict[str, str]:
    try:
        from packaging.markers import Marker
        from packaging.utils import canonicalize_name
    except ImportError as exc:
        raise RuntimeError("Il modulo packaging manca: prepara le dipendenze.") from exc
    lock = tomllib.loads((root / "uv.lock").read_text(encoding="utf-8-sig"))
    if lock.get("version") != 1:
        raise RuntimeError("Formato uv.lock non supportato.")
    packages = defaultdict(list)
    project = None
    for package in lock["package"]:
        packages[canonicalize_name(package["name"])].append(package)
        if package.get("source", {}).get("virtual") == ".":
            project = package
    if project is None:
        raise RuntimeError("Il progetto manca da uv.lock.")
    pending = list(project.get("dependencies", []))
    if all_groups:
        for dependencies in project.get("dev-dependencies", {}).values():
            pending.extend(dependencies)
    result = {}
    visited = set()
    while pending:
        dependency = pending.pop()
        if dependency.get("marker") and not Marker(dependency["marker"]).evaluate():
            continue
        name = canonicalize_name(dependency["name"])
        candidates = [
            package
            for package in packages[name]
            if (
                not dependency.get("version")
                or package["version"] == dependency["version"]
            )
            and (
                not package.get("resolution-markers")
                or any(
                    Marker(marker).evaluate()
                    for marker in package["resolution-markers"]
                )
            )
        ]
        if len(candidates) != 1:
            raise RuntimeError(f"Risoluzione ambigua o mancante in uv.lock: {name}")
        package = candidates[0]
        extras = tuple(sorted(dependency.get("extra", [])))
        key = (name, package["version"], extras)
        if key in visited:
            continue
        visited.add(key)
        if name in result and result[name] != package["version"]:
            raise RuntimeError(f"Versioni incompatibili in uv.lock: {name}")
        result[name] = package["version"]
        pending.extend(package.get("dependencies", []))
        for extra in extras:
            pending.extend(package.get("optional-dependencies", {}).get(extra, []))
    return dict(sorted(result.items()))


def verify_runtime_manifest(root: Path) -> None:
    from packaging.requirements import Requirement

    config = tomllib.loads((root / "pyproject.toml").read_text(encoding="utf-8-sig"))
    lock = tomllib.loads((root / "uv.lock").read_text(encoding="utf-8-sig"))
    project = next(
        p for p in lock["package"] if p.get("source", {}).get("virtual") == "."
    )
    locked = set()
    for item in project.get("metadata", {}).get("requires-dist", []):
        text = item["name"]
        if item.get("extras"):
            text += "[" + ",".join(item["extras"]) + "]"
        text += item.get("specifier", "")
        if item.get("marker"):
            text += "; " + item["marker"]
        locked.add(Requirement(text))
    declared = {Requirement(line) for line in config["project"].get("dependencies", [])}
    if declared != locked:
        raise RuntimeError("pyproject.toml e uv.lock non allineati: aggiorna il lock.")


def inspect_dependencies(
    root: Path, *, all_groups: bool = False, strict: bool = False
) -> DependencyStatus:
    expected = locked_versions(root, all_groups=all_groups)
    verify_runtime_manifest(root)
    from packaging.specifiers import SpecifierSet
    from packaging.utils import canonicalize_name
    from packaging.version import Version

    project = tomllib.loads((root / "pyproject.toml").read_text(encoding="utf-8-sig"))
    result = DependencyStatus()
    required_python = project["project"]["requires-python"]
    if not SpecifierSet(required_python).contains(
        ".".join(map(str, sys.version_info[:3]))
    ):
        result.issues.append(
            f"Python {sys.version.split()[0]}: richiesto {required_python}"
        )
    for name, version in expected.items():
        try:
            installed = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            result.issues.append(f"{name}: manca (richiesto {version})")
            continue
        result.installed[name] = installed
        if Version(installed) != Version(version):
            result.issues.append(f"{name}: installato {installed}, richiesto {version}")
    if strict:
        extra = {
            canonicalize_name(d.metadata["Name"])
            for d in importlib.metadata.distributions()
        } - expected.keys()
        result.issues.extend(
            f"{name}: pacchetto estraneo a uv.lock" for name in sorted(extra)
        )
    return result


def verify_dependencies(
    root: Path, *, all_groups: bool = False, strict: bool = False
) -> dict[str, str]:
    status = inspect_dependencies(root, all_groups=all_groups, strict=strict)
    if status.issues:
        raise RuntimeError(
            "Dipendenze Python non allineate:\n" + "\n".join(status.issues)
        )
    return status.installed


def lock_hashes(root: Path) -> dict[str, str]:
    return {
        "python_lock_sha256": hashlib.sha256(
            (root / "uv.lock").read_bytes()
        ).hexdigest(),
        "npm_lock_sha256": hashlib.sha256(
            (root / "webui" / "package-lock.json").read_bytes()
        ).hexdigest(),
    }


def verify_frontend_build(root: Path) -> None:
    try:
        recorded = json.loads(
            (root / "webui" / "dist" / "desktop-build.json").read_text(encoding="utf-8")
        )["dependencies"]
    except (OSError, ValueError, KeyError) as exc:
        raise RuntimeError(
            "Interfaccia non preparata: esegui l'aggiornamento locale."
        ) from exc
    if recorded != lock_hashes(root):
        raise RuntimeError(
            "Interfaccia compilata con lock differenti: aggiorna l'app locale."
        )


if __name__ == "__main__":
    print(
        json.dumps(verify_dependencies(Path(sys.argv[1]), all_groups=True, strict=True))
    )
