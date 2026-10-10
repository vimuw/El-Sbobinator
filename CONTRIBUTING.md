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
pre-commit install
```

## Testing & Quality Checks

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
