---
name: check
description: Verify El Sbobinator with its authoritative lint, type, test and coverage checks. Use for project validation or a requested check; report failures without editing source unless repairs are authorized.
---

# Project verification

Start with `git status --short` and identify the requested content: current working tree, staged snapshot, commit, or branch. Check that content, not a different checkout. Preserve existing changes and the index. Verification may produce caches and reports; it does not authorize source fixes, commits, pushes or releases.

For an unqualified project check, run from the repository root:

```powershell
python scripts/build_release.py check --with-coverage --skip-npm-install
```

Read [verification guidance](references/verification.md) for scoped commands, environment setup, reuse of prior results, behavioral checks and platform limits. `scripts/build_release.py`, `webui/package.json` and test configuration are the authoritative sources for the command's behavior and thresholds.

If a step fails, inspect the actual error and use a focused reproduction to distinguish a defect from missing tooling. Continue useful analysis, but report the check as incomplete or failed. Do not run repository-wide autofix, install dependencies or rewrite lockfiles as an implicit response to a failure. Apply repairs only within the user's authorized scope, then repeat the affected checks.

Report the checked revision or working-tree scope, completed stages, failures, material skipped checks and relevant coverage results. Wait for final exit codes. A passing automated check proves only the checks that ran; distinguish browser, native desktop, packaged app and installer evidence when readiness is requested.
