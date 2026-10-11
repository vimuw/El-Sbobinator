# Release tagging

A `v*` tag can trigger build and publication. Read the current [build workflow](../../../../.github/workflows/build.yml) before acting: branch/PR checks, packaging jobs and release publication have different conditions. Tag authorization includes this known publication effect; a push-only request does not.

## Prepare a concrete release

1. Resolve the version and immutable target commit from the request. If the user said to choose the next version, propose or select a SemVer appropriate to the actual changes within that authority. Inspect remote release tags and the target's history; do not equate the highest local tag with the latest published stable release, or mistake a prerelease for it. Use `gh release list`/`gh release view` when publication status matters. Ask for a missing version/target only when it cannot be inferred or selected within the request.
2. Confirm the target and destination repository/branch, and list what the release includes. Ensure intended source changes are committed; do not commit them merely because tagging was requested. Resolve missing commit authority explicitly. Unrelated dirty work can stay in place while the target is verified in an isolated checkout.
3. Complete or reuse the full coverage gate and applicable production/packaging validation against that commit using [verification guidance](../../check/references/verification.md). Inspect the workflow's additional validation gates. Do not run tests on a dirty tree and label its HEAD verified. Keep native/installer evidence and untested platform limits explicit; do not invent a certification requirement or repeat already applicable checks.
4. Check the chosen tag is unused both locally and remotely. Validate its format and the project's `v` prefix. Stop on a collision; never overwrite, delete or move an existing version tag as an implicit retry. An existing exact tag can be used only if the request explicitly covers completing that release and its target matches.

Once version, target and publication are authorized and preparation is complete, proceed without a second generic confirmation. If authorization is absent, present the prepared version/commit, included changes, verification and publication effect before asking to publish.

## Create, push and verify

Resolve `$releaseTag`, `$releaseCommit` and `$releaseRemote` first. Prefer an annotated tag tied explicitly to the verified commit:

```powershell
git tag -a $releaseTag $releaseCommit -m "Release $releaseTag"
git push $releaseRemote "refs/tags/${releaseTag}:refs/tags/${releaseTag}"
git ls-remote --tags $releaseRemote "refs/tags/${releaseTag}" "refs/tags/${releaseTag}^{}"
```

For an annotated tag, compare the peeled `^{}` commit to `$releaseCommit`, not the tag object's SHA. Check command exit codes before continuing. If a push fails, retain the local tag and diagnose the actual remote state; do not blindly repeat or replace it.

Find the matching Actions run by tag/ref and target SHA when available (`gh run list`, `gh run view`). Report separately: local tag created, remote tag confirmed, build pending/passed/failed, and Release/assets published only when verified. Share the actual run or repository Actions URL. Do not claim Windows Setup or macOS DMG are available merely because the tag push succeeded. Observe once or use a requested monitor; do not create an automation implicitly or poll unchanged runs indefinitely.
