import re
from pathlib import Path
from typing import NamedTuple

WORKFLOW = Path(__file__).resolve().parents[1] / ".github" / "workflows" / "build.yml"


class Job(NamedTuple):
    needs: list[str]
    condition: str


def workflow_jobs() -> dict[str, Job]:
    text = WORKFLOW.read_text(encoding="utf-8")
    body = text.split("\njobs:\n", 1)[1]
    jobs: dict[str, Job] = {}
    for match in re.finditer(r"^  ([\w-]+):\n((?:(?!^  [\w-]+:\n).*\n?)*)", body, re.M):
        block = match.group(2)
        needs = re.search(r"^    needs: \[([^\]]*)\]", block, re.M)
        condition = re.search(r"^    if: (.+)$", block, re.M)
        jobs[match.group(1)] = Job(
            needs=[n.strip() for n in needs.group(1).split(",")] if needs else [],
            condition=condition.group(1) if condition else "",
        )
    return jobs


def test_jobs_after_a_skippable_job_do_not_inherit_the_implicit_success_guard():
    # A plain `if:` implies success(), so one skipped ancestor (for example
    # browser-e2e without full_e2e) silently skips the whole release chain.
    jobs = workflow_jobs()
    for name, job in jobs.items():
        skippable = [need for need in job.needs if jobs[need].condition]
        if skippable:
            assert "!cancelled()" in job.condition or "always()" in job.condition, name


def test_build_requires_the_gate_and_release_context_to_succeed():
    condition = workflow_jobs()["build"].condition
    assert "!cancelled()" in condition
    assert "needs.dependency-gate.result == 'success'" in condition
    assert "needs.release-context.result == 'success'" in condition
    assert "startsWith(github.ref, 'refs/tags/')" in condition
    assert "github.event_name == 'workflow_dispatch'" in condition


def test_release_requires_a_successful_build_and_a_tag():
    condition = workflow_jobs()["release"].condition
    assert "!cancelled()" in condition
    assert "needs.build.result == 'success'" in condition
    assert "needs.release-context.outputs.tag != ''" in condition


WEB_RELEASE = WORKFLOW.parent / "web-release.yml"


def test_web_release_runs_only_for_web_tags_and_desktop_release_ignores_them():
    web = WEB_RELEASE.read_text(encoding="utf-8")
    trigger = web.split("\non:\n", 1)[1].split("\npermissions:", 1)[0]
    assert re.findall(r"^\s+- '([^']+)'$", trigger, re.M) == ["web-v*"]
    assert "branches" not in trigger and "pull_request" not in trigger
    desktop_tags = re.search(
        r"^    tags:\n((?:      - .*\n)+)", WORKFLOW.read_text(encoding="utf-8"), re.M
    )
    assert desktop_tags is not None
    # GitHub tag filters match from the start: 'v*' never matches web-v1.0.0.
    assert all(
        pattern.startswith("'v")
        for pattern in re.findall(r"- ('[^']+')", desktop_tags.group(1))
    )


def test_web_release_pins_actions_and_deploys_only_after_tests_and_build():
    web = WEB_RELEASE.read_text(encoding="utf-8")
    uses = re.findall(r"uses: (\S+)", web)
    assert uses and all(
        re.fullmatch(r"[\w.-]+/[\w.-]+@[0-9a-f]{40}", action) for action in uses
    )
    assert "permissions:\n  contents: read" in web
    order = [
        web.index("git merge-base --is-ancestor"),
        web.index("npm run typecheck"),
        web.index("npm test"),
        web.index("npm run test:e2e:web"),
        web.index("npm run build:web"),
        web.index("cloudflare/wrangler-action@"),
    ]
    assert order == sorted(order)
    assert "EL_SBOBINATOR_WEB_VERSION: ${{ github.ref_name }}" in web
    assert (
        "secrets.CLOUDFLARE_API_TOKEN" in web and "secrets.CLOUDFLARE_ACCOUNT_ID" in web
    )
    assert "--project-name=el-sbobinator-web --branch=main" in web


def test_web_release_publishes_nothing_on_github():
    # The web site stays out of the desktop repository's Releases page and artifacts.
    web = WEB_RELEASE.read_text(encoding="utf-8")
    for public in (
        "action-gh-release",
        "upload-artifact",
        "gh release",
        "contents: write",
    ):
        assert public not in web
