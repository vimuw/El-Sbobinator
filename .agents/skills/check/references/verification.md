# Verification choices

## Scope and sources

Run commands from the root of the content being verified. The authority is [build_release.py](../../../../scripts/build_release.py); frontend scripts are in [package.json](../../../../webui/package.json), coverage configuration in [vitest.config.ts](../../../../webui/vitest.config.ts), and browser setup in [playwright.config.ts](../../../../webui/playwright.config.ts). Read them when options or thresholds matter. Do not lower thresholds, exclude failing code or update fixtures merely to make a check green.

| Need | Command from repository root |
| --- | --- |
| Full application gate | `python scripts/build_release.py check --with-coverage --skip-npm-install` |
| Deliberately scoped backend check | `python scripts/build_release.py check --with-coverage --skip-webui --skip-npm-install` |
| Deliberately scoped frontend check | `python scripts/build_release.py check --with-coverage --skip-python --skip-npm-install` |
| One Python regression | `python -m pytest tests/test_example.py -q` (replace the example path) |
| Selected frontend regression | `npm --prefix webui test -- src/example.dom.test.tsx` (replace the example path) |
| Selected browser behavior | `npm --prefix webui run test:e2e -- e2e/example.spec.ts --project=chromium` (replace the example path) |
| Production frontend bundle | `npm --prefix webui run build` |
| Patch whitespace | `git -c core.safecrlf=false diff --check` and, when staged content matters, `git -c core.safecrlf=false diff --cached --check` |

An explicit `check` means the full gate unless scoped by the user. During implementation start with focused checks, then use the full gate for application fixes, unqualified application reviews and commits. Narrow inspections can use the affected side; documentation/skill-only work needs structural, reference and instruction validation. Run a production build when bundle, asset, entrypoint or build-configuration behavior changes. Add browser tests when gestures, selection, layout or browser integration are material; `--with-browser-e2e` includes the configured full browser suite when needed.

The full gate runs Python lint/format checks, pytest, Pyright, frontend lint, TypeScript and Vitest coverage. Python worker parallelism depends on installed `pytest-xdist`. Vitest coverage has exclusions: a passing percentage does not certify every editor or archive path. The default gate does not build the app or run Playwright, native desktop or installer acceptance.

## Environment and preservation

Check tooling before interpreting a missing-module, command or browser-binary error as a code defect. `--skip-npm-install` assumes matching installed dependencies; do not silently remove it when that would rewrite a lockfile. Use the project's dependency workflow when installation is within the task, preserving unrelated changes.

Use an isolated profile/session root for native persistence and destructive recovery probes. Never test on the user's lecture archive or saved credentials. Place evidence in an ignored `_smoke/` area or a task-specific temporary directory.

If coverage database collisions or existing artifacts matter, set a unique `COVERAGE_FILE`, save its prior value and restore it in `finally`. The script still writes `coverage-python.xml`; account for existing reports or run in an isolated checkout. Delete only artifacts created by this task. Inspect status after verification; do not silently stage generated reports.

## Reuse and exact content

Record the content/revision, environment and completed stages for significant verification. Reuse a result only while relevant source, tests, dependencies and configuration match. Hook changes invalidate affected results. Do not rerun identical suites without a new change, failure or unresolved concern.

For a commit, branch or staged snapshot that differs from the working tree, inspect/test the intended content in isolation. A temporary checkout or index export must preserve the user's checkout and contain the required tracked files. Install matching dependencies there or reuse them only when configuration matches. Do not assume results against omitted working-tree changes apply to the commit. Do not create commits, stash, reset or clean the user's tree just to run checks.

Wait for process completion; an intermediate `RUN` line is not success. A first-stage failure leaves later stages unexecuted. Report this accurately and diagnose the failure with targeted checks before retrying.

## Behavioral and platform evidence

Use the behavior that the change affects: delayed saves and close/reopen readback for persistence; copy gestures and actual recipient semantics for clipboard fidelity; pointer movement with zoom/scroll changes for geometry. Visual screenshots alone do not prove editability, history or saved content.

Keep these evidence levels distinct: unit/DOM tests, Chromium browser, source pywebview/WebView2, PyInstaller app, Windows Setup/update/uninstall, and macOS WKWebView/DMG. Ordinary Windows readiness and publication readiness have different gates. For a Windows-scoped task, report untested macOS behavior without expanding into that platform unless the change or user request requires it. A source-level fix or successful CI trigger is not proof of a packaged release working.
