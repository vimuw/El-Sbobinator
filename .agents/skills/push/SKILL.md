---
name: push
description: Push authorized El Sbobinator commits to the intended remote branch, or publish an explicitly requested version tag for the release pipeline. A push-only request does not include tagging or release publication.
---

# Push and release

Select the operation from the user's request. Execute external changes only when authorized; reading or editing this skill is not a request to push. Keep push-only work separate from [release tagging](references/release.md). Honor an already chosen version or a stated no-release preference without asking again.

## Push a branch

1. Inspect `git status --short`, the current branch, configured upstream, intended remote/destination and commits to send. Fetch that remote before assessing ahead/behind state. In PowerShell quote revision syntax: `git log --oneline '@{u}..HEAD'` and `git rev-parse --abbrev-ref --symbolic-full-name '@{u}'`. If there is no upstream or HEAD is detached, use the destination given by the user or ask for the missing destination; do not invent one.
2. Identify the commit to push and inspect its changes and applicable verification. Reuse results that apply to that committed content using [verification guidance](../check/references/verification.md). A dirty working tree is not itself a blocker for pushing existing commits; it must not be claimed as tested content of those commits. If a relevant check failed or verification is missing, complete applicable checks against the committed content before pushing. Source fixes or new commits require their own scope.
3. If the remote diverged, stop and describe the divergence. Do not force-push, merge, rebase, amend, stage or commit as an implicit repair. Respect repository protection and the requested destination.
4. Push only the identified commit to the intended branch, using an explicit refspec when needed. For example, after resolving `$pushRemote`, `$targetBranch` and `$targetCommit`: `git push $pushRemote "${targetCommit}:refs/heads/${targetBranch}"`. Avoid broad `--all`, `--tags` or configuration-dependent pushes that include unintended refs.
5. Verify the destination ref with `git ls-remote --heads` or a fetch and comparison to the intended SHA. Report pushed commits and any CI run link/status actually observed. Push completion is not CI success. End a push-only task here.

For an authorized release, read [release tagging](references/release.md) before creating or pushing a tag. If no release was requested, do not add a mandatory release-choice prompt.
