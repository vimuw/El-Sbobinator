# Contributing to El Sbobinator

Thank you for contributing to El Sbobinator! This document outlines development setup, testing, and packaging procedures.

## Building Native Packages

To build native executable packages without using the command line, double-click the included automation scripts:

- **Windows:** `packaging/Costruisci_EXE_Windows.bat`
- **macOS:** `packaging/Costruisci_APP_Mac.command`

The WebUI is the only supported interface for releases. Legacy desktop entrypoints remain solely as compatibility aliases.

## Prerequisites

| Tool | Required version |
|------|-----------------|
| Python | 3.11 (exact — matches CI) |
| Node.js | 24 (exact — matches CI) |
| pip | bundled with Python |
| npm | bundled with Node.js |

No `.env` or API key is needed to develop or build. Keys are entered at runtime inside the app's Settings screen.

## Installation & Setup

```bash
# Install all dependencies (runtime + dev tools: ruff, pyinstaller, etc.)
python scripts/build_release.py deps --ui webui --dev

# Install git hooks (runs ruff, whitespace, YAML, and JSON checks before every commit)
# Windows: .venv/Scripts/python.exe; macOS/Linux: .venv/bin/python
.venv/Scripts/python.exe -m pre_commit install
```

## Testing & Quality Checks

For Windows source use, close the running app,
then run the single local update command from PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\Aggiorna_App_Locale.ps1
# Verify the current working copy without pulling (during development):
powershell -ExecutionPolicy Bypass -File .\Aggiorna_App_Locale.ps1 -NoPull
```

The command fetches `origin/main`, allows only a fast-forward on `main`, then
synchronizes `.venv` exactly to `uv.lock`, runs `npm ci`, and rebuilds the frontend.
If new Git commits conflict with local work, it stops without replacing that work.
Python runtime, build and development packages share one locked profile. Obsolete
packages are removed during synchronization. The isolated `.dependency-tools`
environment contains the versioned bootstrap manager from `requirements/bootstrap.txt`.
`pyproject.toml` and `uv.lock` are the single Python source of truth; the old direct-only
requirements have been removed. Neither installation nor checking rewrites a lock.

Double-clicking the Windows source launcher selects `.venv` and verifies the complete
runtime graph plus the frontend's lock fingerprints before importing app libraries.
Missing/stale environments show the update command. Packaged apps use bundled libraries.
CI/build also reject missing, obsolete or unexpected Python/npm packages, including
when packaging uses `--skip-checks`, and record the full Python graph and lock hashes.

Dependabot checks uv, bootstrap pip packages, npm, pre-commit and GitHub Actions daily.
Actions use immutable commit references with release comments, also updated by Dependabot.
Its PRs can auto-merge only after the required `Dependency gate` passes Linux, Windows,
macOS, complete audits, frontend build and Chromium smoke tests. The metadata-only
auto-merge workflow never executes PR code with write permissions. Daily CI also audits
new disclosures without waiting for a commit. Ordinary pushes/merges do not produce
installers or releases; those retain the explicit tag/manual triggers.

Use `python scripts/build_release.py verify-deps --webui --built` to verify the current
environment and bundle, and `python scripts/build_release.py audit` for the complete
installed Python graph and npm lock. Dependencies advance through reviewed/tested PRs;
the local command installs the versions accepted on main, rather than resolving newer
versions independently. TypeScript 6 migration explicitly preserves the existing
non-strict checking policy; TypeScript 7 currently conflicts with typescript-eslint's
peer range. Node types stay on the supported Node 24 line. Typography's parser override
uses a declared dependency monitored by Dependabot until upstream releases a safe pin.

`npm run build` also verifies the installed npm graph before compiling, so a stale
`node_modules` cannot produce a bundle labeled with a newer lock.

```bash
# Verify all tooling and dependencies are present
python scripts/build_release.py deps --ui webui --dev

# Run lint, type checks and the Python/frontend test suites with coverage
python scripts/build_release.py check --with-coverage --skip-npm-install

# Verify the production frontend bundle
npm --prefix webui run build

# Install Chromium once, then run the three critical browser cases
npx --prefix webui playwright install chromium
npm --prefix webui run test:e2e:smoke
```

Run these checks before opening a PR. GitHub Actions also installs Chromium's Linux
dependencies with `playwright install --with-deps chromium`. The browser smoke
selection uses the `@ci-smoke` tag on existing tests: undo with a delayed save
acknowledgement through explicit flush and debounced autosave, plus image dragging
with a zoom change, undo/redo and saved reopen. The browser host uses isolated
temporary sessions and deterministic processing without Gemini requests.

For the complete browser suite, run `npm --prefix webui run test:e2e`. Browser
checks do not replace native WebView2 or final installer acceptance.

## Build Commands

```bash
# Windows (creates standalone installer exe)
python scripts/build_release.py build --target windows --ui webui --install-deps --dev-deps

# macOS (creates standalone DMG)
python scripts/build_release.py build --target macos --ui webui --install-deps --dev-deps
```

## Repository Structure

| Path | Description |
|------|-------------|
| `el_sbobinator/` | Python package, pipeline orchestration, and PyWebView backend |
| `webui/` | React + TypeScript frontend (Vite, Tailwind CSS, TipTap) |
| `scripts/build_release.py` | Authoritative automation entrypoint (lint, test, build, packaging) |
| `tests/` | Python unittest suite |
| `launchers/` | PyInstaller desktop entrypoint (`El_Sbobinator_WebUI.pyw`) |
| `packaging/` | Platform-specific installer scripts (Inno Setup for Windows, create-dmg for macOS) |
| `docs/` | Developer architecture, IPC bridge protocol, and pipeline documentation |

## Pull Request Guidelines

- The coverage gate, production frontend build and browser smoke tests above must pass.
- Keep commits focused: one logical change per PR. Follow Conventional Commits format (`feat:`, `fix:`, `refactor:`, `chore:`).
- When adding new features or fixing bugs, add corresponding unit or DOM tests.
- Do not weaken or delete existing tests without justification.

## Developer Documentation

- [docs/architecture.md](docs/architecture.md) — Python/React module map, runtime flow, and threading model.
- [docs/pipeline.md](docs/pipeline.md) — Pipeline phases, retry mechanisms, and Gemini model fallback chain.
- [docs/session_model.md](docs/session_model.md) — On-disk session layout and `session.json` schema.
- [docs/bridge_protocol.md](docs/bridge_protocol.md) — Python ↔ React IPC event and API contracts.
