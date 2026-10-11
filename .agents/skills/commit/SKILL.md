---
name: commit
description: Create local atomic Conventional Commits for authorized El Sbobinator changes, with selective staging, hooks and appropriate verification. Use when the user requests commits; it does not include pushing or releasing.
---

# Atomic local commits

## Inspect and group

Inspect `git status --short`, unstaged and staged diffs, and relevant untracked files. Honor a named subset or an existing deliberate staging selection. Preserve unrelated staged and unstaged work; do not empty or rebuild the user's index without need. Resolve ambiguous scope only when it affects what would be committed.

Group by independently meaningful behavior. Keep a cohesive backend/frontend feature with its tests and required schema, dependency or documentation changes. Split independent concerns; do not split a feature just because it crosses languages or its title could use two verbs. Existing dependent changes must stay in the same group or follow an explicit dependency order.

Use [verification guidance](../check/references/verification.md). For application changes, complete or reuse the full coverage gate on the intended combined patch before committing. A documentation-only commit needs relevant document validation, not the application suite. Do not rerun an unchanged full suite for every independent group.

## Process each group

1. Stage only authorized files or hunks. Use `git add -p` for files shared by multiple groups. Avoid `git add -A` when unrelated work exists. Ensure the index contains only the intended commit; account for any pre-existing staged work.
2. Inspect `git diff --cached` and run the staged-file hooks with `pre-commit run`. Hooks here can modify files and temporarily stash unstaged changes. Wait for completion and verify that unrelated content was restored.
3. If hooks change a partially staged file, compare staged and unstaged diffs and restage only the intended hunks. Do not use whole-file `git add` in that case. Rerun hooks until the selected content passes. Stop on unresolved failures; do not use `--no-verify` as a workaround.
4. Verify the staged group is independently valid. Tests on the complete working tree do not prove that omitted changes are unnecessary. Inspect dependencies; where omission can change the result, run the relevant checks against an isolated export of the exact index. Avoid manually stashing unrelated work to manufacture this state.
5. After hook or source changes, repeat affected verification. Confirm `git diff --cached --check` (use `git -c core.safecrlf=false diff --cached --check` if needed for Windows line-ending noise) and inspect the final staged diff before committing.
6. Create the local commit and inspect its actual contents. If the commit-time hook changes content or fails, repeat the staging and verification steps instead of committing blindly.

## Classify the behavior

Choose the type from the final diff and the behavior before and after it, not from the request's wording, the amount of new code or a new component. Inspect the previous implementation and relevant regression evidence when the distinction is unclear. For each group, be able to explain what the user could do before, what failed or was missing, and what changes now.

- `fix`: correct a demonstrated defect or restore an existing behavior or contract. Preserving formatting, clipboard content or confirmed saves, keeping controls reachable, and repairing an existing formula editor are fixes even when they require new components.
- `feat`: add or deliberately extend a user capability. State the capability that was absent, such as nested collections where only flat collections existed. A new dialog, button or implementation file alone does not establish a feature; a deliberate new interaction can qualify when it extends what users can do rather than repairing a failure.
- `perf`: improve measured performance while preserving intended behavior.
- `refactor`: restructure implementation without changing observable behavior.
- `style`: change code formatting only. Do not use it automatically for visual UI changes; classify those by their behavior and purpose.
- `test`, `docs`, `chore`: use for tests, documentation or maintenance/configuration without an application feature or defect correction. For model/default changes, distinguish routine configuration updates from repairs to an existing selection or migration contract.

Keep a repair and the implementation needed for it together. Split an independently useful feature from a fix when their dependencies allow it; for an inseparable group, use the primary behavior and explain the secondary effect in the body. Do not invent a bug to obtain a `fix` label or exaggerate a repair into a feature. Honor a bug-fix-only scope without adding optional capabilities.

Use an imperative, lowercase Conventional Commit subject under 72 characters: `fix(editor): preserve confirmed saves before closing`. Describe the final behavior accurately; add a body when the defect, capability or meaningful tradeoff needs context. The [changelog generator](../../../scripts/generate_changelog.py) maps commit types directly into release categories, so verify that the subject and type support the category they will produce. Existing commits and published tags must not be amended or rewritten merely to correct their labels without separate authorization.

## Finish

Inspect `git status --short` and the created commits. Remaining unrelated work is valid; a clean tree is not a reason to include it. Report commit SHAs, logical groups, checks and remaining work. Commit authorization does not include push, tags, releases, amend or rewriting existing history.
