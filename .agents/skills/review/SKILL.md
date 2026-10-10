---
name: review
description: Review El Sbobinator working-tree changes, commits, branches or pull requests for evidenced bugs and regressions, with project checks and relevant domain contracts. Review is read-only unless fixes are also requested.
---

# Change review

## Establish scope

Start with `git status --short`. For uncommitted changes inspect all three sources:

```powershell
git diff
git diff --cached
git ls-files --others --exclude-standard
```

Read relevant untracked files explicitly; neither diff includes them. For a named commit, branch or PR, resolve the intended base and head, inspect that comparison, and record the head SHA. Do not treat unrelated working-tree changes as part of it. Use an isolated checkout if executing the requested revision would otherwise overwrite local work; do not switch, stash or reset the user's checkout to review it.

Review authorizes inspection and verification. Present concrete findings before changing source unless the user already requested repairs. A subsequent `procedi` authorizes the proposed remediation; preserve unrelated work and do not infer commit, push, merge or release authority.

## Verify and inspect

Use [project verification guidance](../check/references/verification.md). An unqualified review of application changes includes the full coverage gate; a deliberately narrow review can use the relevant side and focused behavior checks. Documentation-only reviews use document/link validation. Tests must exercise the reviewed content. Reuse applicable completed checks when content and environment still match; after changes repeat the affected checks.

Trace changed behavior through its callers, consumers and error paths. Check ordering, stale asynchronous results, persistence, resource ownership, compatibility and validation at process boundaries. Report relevant pre-existing defects separately from regressions introduced by the patch. Broad test success does not replace reproducing a suspected semantic failure.

Load only domain references relevant to the changes:

| Changed behavior | Reference |
| --- | --- |
| Saves, close/reopen, archive paths, relocation, recovery | [Persistence and identity](references/persistence.md) |
| TipTap, formatting, images, clipboard, Google Docs, editor UI | [Editor and document fidelity](references/editor.md) |
| Bridge, startup, Gemini, subprocesses, credentials, imports, updater | [Runtime contracts](references/runtime.md) |

For maintainability-only requests use [maintainability](../maintainability/SKILL.md); do not turn a bug review into a broad refactoring exercise. Security-sensitive paths still need ordinary security inspection; use a specialized scan only when requested or warranted by the actual scope.

## Report

Lead with actionable findings, highest impact first. Each needs a verified file/line, concrete triggering condition, observable consequence and focused remediation. Use P1/P2/P3 according to impact; reserve P0 for a demonstrated critical blocker. Exclude speculation, style preferences and rules contradicted by current sources. Add an inline code comment only for an actionable line-specific finding.

Then give verification results and limits, followed by `Pass`, `Pass with Recommendations`, or `Needs Fixes`. If checks are incomplete, qualify the verdict rather than implying a verified pass. If no actionable issues were found, say so plainly. State source/history side effects. When proposing fixes, make the proposal concrete and respect authorization already given; do not ask the same permission again.
