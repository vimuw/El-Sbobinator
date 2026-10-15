"""
Unified build/check helper for El Sbobinator.

This is the single entrypoint used by local scripts and CI for:
- dependency installation
- lint/test checks
- WebUI build
- PyInstaller packaging
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

if os.name == "nt":
    import winreg


ROOT = Path(__file__).resolve().parent.parent
WEBUI_DIR = ROOT / "webui"
PACKAGING_DIR = ROOT / "packaging"
LAUNCHERS_DIR = ROOT / "launchers"
TOOLS_DIR = ROOT / "tools"
REQUIREMENTS_DIR = ROOT / "requirements"
WEBVIEW_ENTRYPOINT = LAUNCHERS_DIR / "El_Sbobinator_WebUI.pyw"
PROFILE_IMPORTS_SCRIPT = TOOLS_DIR / "profile_imports.py"
APP_NAME = "El Sbobinator"
REQUIRED_NODE_MAJOR = 24
BOOTSTRAP_REQUIREMENTS = REQUIREMENTS_DIR / "bootstrap.txt"
PYTHON_LOCK = ROOT / "uv.lock"
PYTHON_CHECK_TARGETS = [
    "el_sbobinator",
    "tests",
    "scripts",
    str(WEBVIEW_ENTRYPOINT.relative_to(ROOT)),
    str(PROFILE_IMPORTS_SCRIPT.relative_to(ROOT)),
]

if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def run(
    cmd: list[str], cwd: Path | None = None, *, env: dict[str, str] | None = None
) -> None:
    if os.name == "nt" and cmd and cmd[0] == "npm":
        cmd = ["npm.cmd", *cmd[1:]]
    subprocess.run(cmd, cwd=str(cwd or ROOT), check=True, env=env)


def ensure_supported_node_version() -> None:
    result = subprocess.run(
        ["node", "--version"],
        cwd=str(ROOT),
        check=True,
        capture_output=True,
        text=True,
    )
    version = result.stdout.strip() or result.stderr.strip()
    normalized = version[1:] if version.startswith("v") else version
    major_text = normalized.split(".", 1)[0]
    try:
        major = int(major_text)
    except ValueError as exc:
        raise RuntimeError(
            f"Versione Node.js non riconosciuta: {version!r}. Richiesta: {REQUIRED_NODE_MAJOR}.x"
        ) from exc

    if major != REQUIRED_NODE_MAJOR:
        raise RuntimeError(
            f"Node.js {REQUIRED_NODE_MAJOR}.x richiesto per la WebUI; rilevato {version}."
        )


def get_windows_webview2_runtime_version() -> str | None:
    if os.name != "nt":
        return None

    # This packaging notice is informational. App startup additionally requires
    # confirmation from the native WebView2 loader, not registry/file existence.
    guid = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
    for root in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
        for branch in (
            rf"SOFTWARE\Microsoft\EdgeUpdate\Clients\{guid}",
            rf"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{guid}",
        ):
            for view in (0, winreg.KEY_WOW64_32KEY, winreg.KEY_WOW64_64KEY):
                try:
                    with winreg.OpenKey(root, branch, 0, winreg.KEY_READ | view) as key:
                        value, _ = winreg.QueryValueEx(key, "pv")
                    if not isinstance(value, str):
                        continue
                    version = value.strip()
                    parts = version.split(".")
                    if len(parts) == 4 and all(part.isdecimal() for part in parts):
                        if any(int(part) > 0 for part in parts):
                            return version
                except OSError:
                    continue
    return None


def print_windows_webview2_notice(target: str, ui: str) -> None:
    if target != "windows" or ui != "webui":
        return

    version = get_windows_webview2_runtime_version()
    download_url = "https://go.microsoft.com/fwlink/p/?LinkId=2124703"

    print()
    print("=== Controllo prerequisito WebView2 ===")
    if version:
        print(f"[OK] WebView2 Runtime registrato: {version}")
    else:
        print("[ATTENZIONE] WebView2 Runtime non rilevato su questa macchina.")
        print(
            "             L'exe verra compilato comunque, ma per eseguire la WebUI serve WebView2."
        )
        print(f"             Download ufficiale: {download_url}")
    print(
        "             Suggerimento: comunica questo prerequisito anche agli utenti finali Windows."
    )
    print()


def install_python_dependencies(include_dev: bool = False) -> None:
    # One exact profile for local development, checks and release packaging.
    # --locked rejects stale manifests; sync removes obsolete transitive packages.
    uv = ensure_uv()
    run(
        [str(uv), "sync", "--locked", "--all-groups", "--python", sys.executable],
        env={**os.environ, "UV_PROJECT_ENVIRONMENT": str(ROOT / ".venv")},
    )


def project_python() -> Path:
    return ROOT / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def ensure_uv() -> Path:
    from el_sbobinator.utils.source_bootstrap import ensure_supported_python

    ensure_supported_python()
    tools = ROOT / ".dependency-tools"
    python = tools / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    uv = tools / ("Scripts/uv.exe" if os.name == "nt" else "bin/uv")
    pins = dict(
        line.strip().split("==")
        for line in BOOTSTRAP_REQUIREMENTS.read_text().splitlines()
        if line.strip() and not line.startswith("#")
    )
    ready = False
    if python.is_file() and uv.is_file():
        probe = subprocess.run(
            [
                str(python),
                "-c",
                "import importlib.metadata,json; print(json.dumps({n:importlib.metadata.version(n) for n in "
                + repr(list(pins))
                + "}))",
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        ready = probe.returncode == 0 and json.loads(probe.stdout) == pins
    if not ready:
        if not python.is_file():
            run([sys.executable, "-m", "venv", str(tools)])
        run([str(python), "-m", "pip", "install", "-r", str(BOOTSTRAP_REQUIREMENTS)])
    return uv


def verify_python_dependencies() -> dict[str, str]:
    uv = ensure_uv()
    run([str(uv), "lock", "--check"])
    checked = subprocess.run(
        [
            str(project_python()),
            "-m",
            "el_sbobinator.utils.dependency_versions",
            str(ROOT),
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    installed = json.loads(checked.stdout)
    run([str(uv), "pip", "check", "--python", str(project_python())])
    print(
        f"[OK] {len(installed)} dipendenze Python allineate a uv.lock ({project_python()})"
    )
    return installed


def verify_node_dependencies() -> None:
    ensure_supported_node_version()
    run(["node", str(ROOT / "scripts" / "verify_node_dependencies.mjs")])
    run(["node", str(ROOT / "scripts" / "check_node_imports.mjs")])


def install_node_dependencies(skip_npm_install: bool) -> None:
    if skip_npm_install:
        return
    ensure_supported_node_version()
    run(["npm", "ci", "--no-audit", "--no-fund"], cwd=WEBUI_DIR)


def run_pyright() -> None:
    run([sys.executable, "-m", "pyright", "--pythonpath", sys.executable])


def run_python_checks(with_coverage: bool = False) -> None:
    run([sys.executable, str(ROOT / "scripts" / "check_dependency_policy.py")])
    run([sys.executable, "-m", "pre_commit", "validate-config"])
    existing_targets = [
        str(ROOT / target)
        for target in PYTHON_CHECK_TARGETS
        if (ROOT / target).exists()
    ]
    run([sys.executable, "-m", "ruff", "check", *existing_targets])
    run([sys.executable, "-m", "ruff", "format", "--check", *existing_targets])
    pytest_cmd = [sys.executable, "-m", "pytest", "tests/", "-q"]
    import importlib.util

    if importlib.util.find_spec("xdist") is not None:
        pytest_cmd.extend(["-n", "auto"])

    if with_coverage:
        pytest_cmd.extend(
            [
                "--cov=el_sbobinator",
                "--cov-report=xml:coverage-python.xml",
                "--cov-report=term-missing",
                "--cov-fail-under=85",
            ]
        )
    run(pytest_cmd)
    run_pyright()


def run_webui_checks(
    skip_npm_install: bool,
    with_coverage: bool = False,
    with_browser_e2e: bool = False,
) -> None:
    install_node_dependencies(skip_npm_install=skip_npm_install)
    verify_node_dependencies()
    run(["npm", "run", "lint"], cwd=WEBUI_DIR)
    run(["npm", "run", "typecheck"], cwd=WEBUI_DIR)
    if with_coverage:
        run(["npm", "run", "test:coverage"], cwd=WEBUI_DIR)
    else:
        run(["npm", "test"], cwd=WEBUI_DIR)
    if with_browser_e2e:
        run(["npm", "run", "test:e2e"], cwd=WEBUI_DIR)


def build_webui(skip_npm_install: bool, version: str) -> None:
    install_node_dependencies(skip_npm_install=skip_npm_install)
    verify_node_dependencies()
    run(
        ["npm", "run", "build"],
        cwd=WEBUI_DIR,
        env={**os.environ, "EL_SBOBINATOR_BUILD_VERSION": version},
    )


def pyinstaller_command(target: str, ui: str) -> list[str]:
    spec_dir = PACKAGING_DIR / ("windows" if target == "windows" else "macos")
    command = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--specpath",
        str(spec_dir),
    ]
    if target == "windows":
        command.extend(["--clean", "--onedir", "--windowed"])
        command.extend(["--icon", str(ROOT / "assets" / "icon.ico")])
        command.extend(["--collect-data", "tzdata"])
    else:
        command.extend(["--windowed"])
        command.extend(["--icon", str(ROOT / "assets" / "icon.icns")])

    metadata = ROOT / "build" / "diagnostic_build.json"
    command.extend(["--add-data", f"{metadata}{';' if os.name == 'nt' else ':'}."])
    command.extend(
        [
            "--add-data",
            f"{ROOT / 'el_sbobinator' / 'document_formatting.json'}"
            f"{';' if os.name == 'nt' else ':'}el_sbobinator",
        ]
    )
    command.extend(
        [
            "--add-data",
            f"{ROOT / 'webui' / 'dist'};webui/dist"
            if os.name == "nt"
            else f"{ROOT / 'webui' / 'dist'}:webui/dist",
            "--collect-all",
            "imageio_ffmpeg",
            "--collect-all",
            "keyring",
            "--collect-data",
            "certifi",
            "--hidden-import",
            "webview",
            "--hidden-import",
            "clr",
            "--name",
            APP_NAME,
            str(WEBVIEW_ENTRYPOINT),
        ]
    )
    # Exclude unused standard and external libraries to minimize package size
    for module in [
        "tkinter",
        "PyQt5",
        "PyQt6",
        "PySide2",
        "PySide6",
        "wx",
        "sqlite3",
        "numpy",
        "botocore",
        "boto3",
        "grpc",
        "lxml",
        "Pythonwin",
        "gevent",
        "aiohttp",
        "pygments",
        "rich",
        "distutils",
        "unittest",
    ]:
        command.extend(["--exclude-module", module])
    return command


def artifact_path(target: str) -> Path:
    if target == "windows":
        return ROOT / "dist" / APP_NAME  # onedir folder
    return ROOT / "dist" / f"{APP_NAME}.app"


def run_postbuild_smoke(target: str) -> None:
    expected = artifact_path(target)
    if not expected.exists():
        raise FileNotFoundError(f"Artifact mancante dopo la build: {expected}")
    if target == "windows":
        inner_exe = expected / f"{APP_NAME}.exe"
        if not inner_exe.exists() or inner_exe.stat().st_size <= 0:
            raise RuntimeError(f"Executable interno mancante o vuoto: {inner_exe}")
    else:
        if not any(expected.iterdir()):
            raise RuntimeError(f"Artifact vuoto o corrotto: {expected}")
        verify_macos_build_metadata(expected)
    run([sys.executable, "scripts/smoke_test.py"], cwd=ROOT)


def verify_macos_build_metadata(artifact: Path) -> None:
    from el_sbobinator.services.diagnostics_service import (
        read_build_metadata,
        read_json,
    )

    contents = (artifact / "Contents").resolve()
    metadata = read_build_metadata(contents / "Frameworks", macos_bundle=True)
    if not metadata:
        raise RuntimeError(
            "Metadati della versione mancanti o invalidi nel bundle macOS"
        )
    try:
        frontend = (
            contents / "Frameworks" / "webui" / "dist" / "desktop-build.json"
        ).resolve(strict=True)
        manifest = read_json(frontend) if frontend.is_relative_to(contents) else {}
    except (OSError, RuntimeError):
        manifest = {}
    expected = read_build_metadata(ROOT / "build")
    if (
        not expected
        or metadata["version"] != expected["version"]
        or metadata["version"] != str(manifest.get("version", "")).lstrip("v")
    ):
        raise RuntimeError("Versioni backend e frontend incoerenti nel bundle macOS")


def write_sha256(artifact: Path) -> Path:
    h = hashlib.sha256()
    with artifact.open("rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    digest = h.hexdigest()
    checksum_path = artifact.with_suffix(artifact.suffix + ".sha256")
    checksum_path.write_text(f"{digest}  {artifact.name}\n", encoding="utf-8")
    return checksum_path


def _find_iscc() -> str | None:
    in_path = shutil.which("ISCC") or shutil.which("ISCC.exe")
    if in_path:
        return in_path
    for candidate in [
        r"C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
        r"C:\Program Files\Inno Setup 6\ISCC.exe",
    ]:
        if Path(candidate).exists():
            return candidate
    return None


def run_inno_setup(version: str) -> None:
    iss_script = PACKAGING_DIR / "windows" / "installer.iss"
    iscc = _find_iscc()
    if iscc is None:
        raise FileNotFoundError(
            "Inno Setup (ISCC.exe) non trovato: installer non generato."
        )
    run([iscc, f"/DAppVersion={version}", str(iss_script)], cwd=ROOT)
    installer = ROOT / "dist" / f"El-Sbobinator-Setup-v{version}.exe"
    if not installer.exists() or installer.stat().st_size <= 0:
        raise FileNotFoundError(f"Installer mancante o vuoto: {installer}")
    write_sha256(installer)


def run_create_dmg(version: str) -> None:
    app_path = ROOT / "dist" / f"{APP_NAME}.app"
    dmg_path = ROOT / "dist" / f"El-Sbobinator-v{version}.dmg"
    run(
        [
            "create-dmg",
            "--volname",
            APP_NAME,
            "--window-pos",
            "200",
            "120",
            "--window-size",
            "600",
            "400",
            "--icon-size",
            "100",
            "--app-drop-link",
            "450",
            "185",
            str(dmg_path),
            str(app_path),
        ],
        cwd=ROOT,
    )
    if not dmg_path.exists() or dmg_path.stat().st_size <= 0:
        raise FileNotFoundError(f"DMG mancante o vuoto: {dmg_path}")
    write_sha256(dmg_path)


def command_deps(args: argparse.Namespace) -> None:
    install_python_dependencies(include_dev=bool(args.dev))
    verify_python_dependencies()
    if args.ui == "webui":
        install_node_dependencies(skip_npm_install=bool(args.skip_npm_install))


def command_check(args: argparse.Namespace) -> None:
    with_coverage = bool(args.with_coverage)
    if not args.skip_python:
        verify_python_dependencies()
        run_python_checks(with_coverage=with_coverage)
    if not args.skip_webui:
        run_webui_checks(
            skip_npm_install=bool(args.skip_npm_install),
            with_coverage=with_coverage,
            with_browser_e2e=bool(getattr(args, "with_browser_e2e", False)),
        )


def resolve_build_version(version: str) -> str:
    if version == "0.0.0":
        package = json.loads((WEBUI_DIR / "package.json").read_text(encoding="utf-8"))
        version = str(package["version"])
    return version.lstrip("v")


def write_build_metadata(
    version: str, dependencies: dict[str, str] | None = None
) -> None:
    if dependencies is None:
        dependencies = verify_python_dependencies()
    from el_sbobinator.utils.dependency_versions import lock_hashes

    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=2,
            check=True,
        )
        commit = result.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        commit = "unknown"
    path = ROOT / "build" / "diagnostic_build.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "version": version.lstrip("v"),
                "commit": commit,
                "built_at": datetime.now().astimezone().isoformat(),
                "mode": "packaged",
                "python_version": sys.version.split()[0],
                "python_dependencies": dependencies,
                "dependencies": lock_hashes(ROOT),
            }
        ),
        encoding="utf-8",
    )


def command_build(args: argparse.Namespace) -> None:
    print_windows_webview2_notice(args.target, args.ui)
    version = resolve_build_version(args.version)

    if args.install_deps:
        install_python_dependencies(include_dev=bool(args.dev_deps))

    dependencies = verify_python_dependencies()

    if not args.skip_checks:
        run_python_checks()
        if args.ui == "webui":
            run_webui_checks(skip_npm_install=bool(args.skip_npm_install))

    if args.ui == "webui":
        build_webui(skip_npm_install=bool(args.skip_npm_install), version=version)

    write_build_metadata(version, dependencies)
    run(pyinstaller_command(args.target, args.ui), cwd=ROOT)
    if not args.skip_postbuild_smoke:
        run_postbuild_smoke(args.target)

    if args.target == "windows":
        run_inno_setup(version)
    elif args.target == "macos":
        run_create_dmg(version)


def command_validate(args: argparse.Namespace) -> None:
    from el_sbobinator.services.validation_service import validate_environment

    result = validate_environment(
        api_key=args.api_key, validate_api_key=bool(args.check_api_key)
    )
    print(result["summary"])
    for check in result["checks"]:
        status = check["status"].upper()
        label = check["label"]
        message = check["message"]
        details = check.get("details")
        print(f"- [{status}] {label}: {message}")
        if details:
            print(f"  {details}")
    if not result["ok"]:
        raise SystemExit(1)


def command_verify_deps(args: argparse.Namespace) -> None:
    verify_python_dependencies()
    if args.webui:
        verify_node_dependencies()
    if args.built:
        from el_sbobinator.utils.dependency_versions import verify_frontend_build

        verify_frontend_build(ROOT)


def command_update_local(args: argparse.Namespace) -> None:
    # Fail before modifying the environment if Node cannot build this checkout.
    ensure_supported_node_version()
    install_python_dependencies(include_dev=bool(args.dev))
    verify_python_dependencies()
    build_webui(skip_npm_install=False, version=resolve_build_version("0.0.0"))
    verify_python_dependencies()
    from el_sbobinator.utils.dependency_versions import verify_frontend_build

    verify_frontend_build(ROOT)
    print("[OK] App locale aggiornata: .venv verificato e interfaccia ricostruita.")


def command_audit(args: argparse.Namespace) -> None:
    verify_python_dependencies()
    # Audit the environment that CI/build actually use, including tools/transitives.
    report = ROOT / "build" / "dependency-audit"
    report.mkdir(parents=True, exist_ok=True)
    python_audit = subprocess.run(
        [
            str(project_python()),
            "-m",
            "pip_audit",
            "--local",
            "--progress-spinner",
            "off",
            "--format",
            "json",
            "--output",
            str(report / "python.json"),
        ],
        cwd=ROOT,
    )
    npm_result = 0
    if not args.skip_webui:
        npm_audit = subprocess.run(
            [
                "npm.cmd" if os.name == "nt" else "npm",
                "audit",
                "--package-lock-only",
                "--json",
            ],
            cwd=WEBUI_DIR,
            capture_output=True,
            text=True,
        )
        (report / "npm.json").write_text(npm_audit.stdout, encoding="utf-8")
        npm_result = npm_audit.returncode
    if python_audit.returncode or npm_result:
        raise RuntimeError(f"Audit dipendenze fallito: consulta {report}")
    print("[OK] Audit completo Python/npm: nessun avviso noto.")


def command_lint(args: argparse.Namespace) -> None:
    files = args.files or PYTHON_CHECK_TARGETS
    run(
        [
            sys.executable,
            "-m",
            "ruff",
            "check",
            *(["--fix"] if args.fix else []),
            *files,
        ]
    )
    run(
        [
            sys.executable,
            "-m",
            "ruff",
            "format",
            *([] if args.fix else ["--check"]),
            *files,
        ]
    )


def command_smoke(args: argparse.Namespace) -> None:
    if args.target:
        run_postbuild_smoke(args.target)
    else:
        run([sys.executable, "scripts/smoke_test.py"], cwd=ROOT)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)

    deps_parser = subparsers.add_parser("deps", help="Install Python/Node dependencies")
    deps_parser.add_argument("--ui", choices=["webui"], default="webui")
    deps_parser.add_argument("--dev", action="store_true")
    deps_parser.add_argument("--skip-npm-install", action="store_true")
    deps_parser.set_defaults(func=command_deps)

    verify_parser = subparsers.add_parser(
        "verify-deps", help="Verify pinned Python dependencies"
    )
    verify_parser.set_defaults(func=command_verify_deps)
    verify_parser.add_argument("--webui", action="store_true")
    verify_parser.add_argument("--built", action="store_true")

    audit_parser = subparsers.add_parser(
        "audit", help="Audit the complete installed graph and npm lock"
    )
    audit_parser.add_argument("--skip-webui", action="store_true")
    audit_parser.set_defaults(func=command_audit)
    lint_parser = subparsers.add_parser(
        "lint", help="Run the locked Ruff version, including from hooks"
    )
    lint_parser.add_argument("--fix", action="store_true")
    lint_parser.add_argument("files", nargs="*")
    lint_parser.set_defaults(func=command_lint)

    update_parser = subparsers.add_parser(
        "update-local", help="Update the source .venv and frontend"
    )
    update_parser.add_argument("--dev", action="store_true")
    update_parser.set_defaults(func=command_update_local)

    check_parser = subparsers.add_parser("check", help="Run lint/tests")
    check_parser.add_argument("--skip-python", action="store_true")
    check_parser.add_argument("--skip-webui", action="store_true")
    check_parser.add_argument("--skip-npm-install", action="store_true")
    check_parser.add_argument("--with-coverage", action="store_true")
    check_parser.add_argument("--with-browser-e2e", action="store_true")
    check_parser.set_defaults(func=command_check)

    build_parser = subparsers.add_parser("build", help="Build the distributable app")
    build_parser.add_argument("--target", choices=["windows", "macos"], required=True)
    build_parser.add_argument("--ui", choices=["webui"], default="webui")
    build_parser.add_argument("--install-deps", action="store_true")
    build_parser.add_argument("--dev-deps", action="store_true")
    build_parser.add_argument("--skip-npm-install", action="store_true")
    build_parser.add_argument("--skip-checks", action="store_true")
    build_parser.add_argument("--skip-postbuild-smoke", action="store_true")
    build_parser.add_argument("--version", default="0.0.0")
    build_parser.set_defaults(func=command_build)

    validate_parser = subparsers.add_parser(
        "validate", help="Validate local environment and optional API access"
    )
    validate_parser.add_argument("--api-key", default="")
    validate_parser.add_argument("--check-api-key", action="store_true")
    validate_parser.set_defaults(func=command_validate)

    smoke_parser = subparsers.add_parser(
        "smoke", help="Run smoke tests and optional post-build artifact checks"
    )
    smoke_parser.add_argument("--target", choices=["windows", "macos"])
    smoke_parser.set_defaults(func=command_smoke)

    return parser


def main(argv: list[str] | None = None) -> None:
    effective_argv = list(sys.argv[1:] if argv is None else argv)
    if effective_argv and effective_argv[0].startswith("-"):
        effective_argv.insert(0, "build")

    parser = build_parser()
    args = parser.parse_args(effective_argv)
    if (
        args.command not in {"deps", "update-local"}
        and Path(sys.prefix).resolve() != (ROOT / ".venv").resolve()
    ):
        if not project_python().is_file():
            raise RuntimeError("Prepara .venv con scripts/build_release.py deps.")
        run([str(project_python()), str(Path(__file__).resolve()), *effective_argv])
        return
    args.func(args)


if __name__ == "__main__":
    main()
