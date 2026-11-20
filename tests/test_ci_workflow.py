import json
import os
import re
import subprocess
import sys
import textwrap
from pathlib import Path
from typing import NamedTuple

import pytest

from scripts import ci_change_scope

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
    assert "--project-name=elsbobinator --branch=main" in web


def test_web_release_builds_drive_from_the_repository_variable_and_checks_it():
    web = WEB_RELEASE.read_text(encoding="utf-8")
    variable = (
        "EL_SBOBINATOR_GOOGLE_CLIENT_ID: ${{ vars.EL_SBOBINATOR_GOOGLE_CLIENT_ID }}"
    )
    build = web.split("- name: Build the static site", 1)[1].split(
        "\n      - name:", 1
    )[0]
    assert variable in build and "npm run build:web" in build
    # The client ID is public: never a secret, which would also hide it from the build logs.
    assert "secrets.EL_SBOBINATOR_GOOGLE_CLIENT_ID" not in web
    check = web.split("- name: Check the Google Drive sync", 1)[1].split(
        "\n      - name:", 1
    )[0]
    assert variable in check
    with_drive, without_drive = check.split("\n          else\n", 1)
    assert 'if [ -n "$EL_SBOBINATOR_GOOGLE_CLIENT_ID" ]' in with_drive
    assert "test -f dist-web/drive-auth.html" in with_drive and "exit 1" in with_drive
    # Without the variable the release goes on without Drive.
    assert "::warning::" in without_drive and "exit" not in without_drive
    order = [
        web.index("npm run build:web"),
        web.index("- name: Check the Google Drive sync"),
        web.index("cloudflare/wrangler-action@"),
    ]
    assert order == sorted(order)


def test_web_release_builds_reports_from_the_repository_variable_and_checks_them():
    web = WEB_RELEASE.read_text(encoding="utf-8")
    variable = "EL_SBOBINATOR_SENTRY_DSN: ${{ vars.EL_SBOBINATOR_SENTRY_DSN }}"
    build = web.split("- name: Build the static site", 1)[1].split(
        "\n      - name:", 1
    )[0]
    assert variable in build
    # The DSN is public: a secret would also hide it from the build logs.
    assert "secrets.EL_SBOBINATOR_SENTRY_DSN" not in web
    check = web.split("- name: Check the feedback and error reports", 1)[1].split(
        "\n      - name:", 1
    )[0]
    assert variable in check
    with_reports, without_reports = check.split("\n          else\n", 1)
    assert "test -f ../functions/api/report.ts" in with_reports
    assert "dist-web/_headers" in with_reports and "exit 1" in with_reports
    # Without the variable the release goes on with reports by email.
    assert "::warning::" in without_reports and "exit" not in without_reports
    assert "reports by email" in without_reports and "Google" not in without_reports
    order = [
        web.index("npm run build:web"),
        web.index("- name: Check the feedback and error reports"),
        web.index("cloudflare/wrangler-action@"),
    ]
    assert order == sorted(order)


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


def test_pull_requests_build_and_browser_test_the_web_site_before_the_gate():
    # Without this, a dependency update that breaks the web site passes every PR check
    # and fails only at the web-v* tag.
    jobs = workflow_jobs()
    assert jobs["web-checks"].needs == ["change-scope"]
    assert "web-checks" in jobs["dependency-gate"].needs
    text = WORKFLOW.read_text(encoding="utf-8")
    assert "check_jobs = ['checks', 'web-checks'," in text
    web_job = text.split("\n  web-checks:\n", 1)[1].split("\n  checks-windows:\n", 1)[0]
    assert "npm run build:web" in web_job and "npm run test:e2e:web" in web_job


WEB_STAGING = WORKFLOW.parent / "web-staging.yml"


def test_web_staging_is_manual_and_never_deploys_production():
    staging = WEB_STAGING.read_text(encoding="utf-8")
    trigger = staging.split("\non:\n", 1)[1].split("\npermissions:", 1)[0]
    assert trigger.strip() == "workflow_dispatch:"
    assert "permissions:\n  contents: read" in staging
    uses = re.findall(r"uses: (\S+)", staging)
    assert uses and all(
        re.fullmatch(r"[\w.-]+/[\w.-]+@[0-9a-f]{40}", action) for action in uses
    )
    assert "--project-name=elsbobinator --branch=staging" in staging
    assert "--branch=main" not in staging
    # A staging build must carry no web-v* version, so the site labels itself a preview.
    assert "EL_SBOBINATOR_WEB_VERSION" not in staging
    # With Drive, so its login (the /api/drive Function) can be tried before production.
    build = staging.split("- name: Build the static site", 1)[1].split(
        "\n      - name:", 1
    )[0]
    assert (
        "EL_SBOBINATOR_GOOGLE_CLIENT_ID: ${{ vars.EL_SBOBINATOR_GOOGLE_CLIENT_ID }}"
        in build
    )
    # And with the reports, so the /api/report tunnel can be tried there too.
    assert "EL_SBOBINATOR_SENTRY_DSN: ${{ vars.EL_SBOBINATOR_SENTRY_DSN }}" in build
    order = [
        staging.index("npm run typecheck"),
        staging.index("npm test"),
        staging.index("npm run test:e2e:web"),
        staging.index("npm run build:web"),
        staging.index("cloudflare/wrangler-action@"),
    ]
    assert order == sorted(order)
    for public in (
        "action-gh-release",
        "upload-artifact",
        "gh release",
        "contents: write",
    ):
        assert public not in staging


@pytest.mark.parametrize(
    ("paths", "desktop_checks"),
    [
        (["webui/src/App.tsx", "webui/package-lock.json"], False),
        (["functions/api/report.ts", ".github/workflows/web-release.yml"], False),
        ([".github/dependabot.yml", ".github/workflows/web-staging.yml"], False),
        (["webui/src/App.tsx", "docs/web/STATO.md", "README.md"], False),
        (["webui/src/App.tsx", "el_sbobinator/pipeline.py"], True),
        (["webui/src/App.tsx", "brand-new-file.cfg"], True),
        (["webui"], True),
        (["webui/src/App.tsx", ".github/workflows/build.yml"], True),
        (["webui/src/App.tsx", "uv.lock"], True),
        ([], True),
        (None, True),
    ],
)
def test_desktop_checks_are_skipped_only_when_every_change_is_web_only(
    paths, desktop_checks
):
    assert ci_change_scope.classify(paths)["desktop_checks"] is desktop_checks


def test_documentation_only_changes_keep_their_exemption():
    assert ci_change_scope.classify(["README.md", "docs/guide.md"]) == {
        "docs_only": True,
        "desktop_checks": False,
    }
    assert (
        ci_change_scope.classify(["docs/guide.md", "webui/a.ts"])["docs_only"] is False
    )
    assert ci_change_scope.classify(["docs/diagram.png"])["docs_only"] is False


@pytest.mark.parametrize(
    "env",
    [
        {"EVENT_NAME": "schedule", "CURRENT_SHA": "a" * 40},
        {"EVENT_NAME": "workflow_dispatch", "CURRENT_SHA": "a" * 40},
        {
            "EVENT_NAME": "push",
            "EVENT_REF": "refs/tags/v2.7.4",
            "BEFORE_SHA": "b" * 40,
            "CURRENT_SHA": "a" * 40,
        },
        {
            "EVENT_NAME": "push",
            "EVENT_REF": "refs/heads/main",
            "BEFORE_SHA": "0" * 40,
            "CURRENT_SHA": "a" * 40,
        },
        {"EVENT_NAME": "pull_request", "PR_BASE_SHA": "", "PR_HEAD_SHA": "a" * 40},
    ],
)
def test_runs_without_a_change_range_check_the_desktop_app(env):
    revisions = ci_change_scope.revision_range(env)
    assert revisions is None
    assert ci_change_scope.classify(ci_change_scope.changed_paths(revisions)) == {
        "docs_only": False,
        "desktop_checks": True,
    }


@pytest.mark.parametrize(
    ("env", "desktop_checks"),
    [
        (
            {"EVENT_NAME": "schedule", "SCHEDULE": ci_change_scope.DAILY_WEB_SCHEDULE},
            False,
        ),
        (
            {
                "EVENT_NAME": "schedule",
                "SCHEDULE": ci_change_scope.WEEKLY_DESKTOP_SCHEDULE,
            },
            True,
        ),
        # An unknown or missing schedule string fails closed.
        ({"EVENT_NAME": "schedule", "SCHEDULE": "0 0 * * *"}, True),
        ({"EVENT_NAME": "schedule"}, True),
        # The schedule string means nothing outside scheduled runs.
        (
            {
                "EVENT_NAME": "workflow_dispatch",
                "SCHEDULE": ci_change_scope.DAILY_WEB_SCHEDULE,
            },
            True,
        ),
    ],
)
def test_only_the_weekly_schedule_checks_the_desktop_backup(env, desktop_checks):
    scope = ci_change_scope.scope_for(env, None)
    assert scope == {"docs_only": False, "desktop_checks": desktop_checks}


def test_the_workflow_schedules_match_the_classifier():
    text = WORKFLOW.read_text(encoding="utf-8")
    crons = re.findall(r'^    - cron: "([^"]+)"$', text, re.M)
    assert sorted(crons) == sorted(
        [ci_change_scope.WEEKLY_DESKTOP_SCHEDULE, ci_change_scope.DAILY_WEB_SCHEDULE]
    )
    assert "SCHEDULE: ${{ github.event.schedule }}" in text


def test_pull_requests_and_branch_pushes_compare_their_change_range():
    assert (
        ci_change_scope.revision_range(
            {"EVENT_NAME": "pull_request", "PR_BASE_SHA": "b", "PR_HEAD_SHA": "h"}
        )
        == "b...h"
    )
    assert (
        ci_change_scope.revision_range(
            {
                "EVENT_NAME": "push",
                "EVENT_REF": "refs/heads/main",
                "BEFORE_SHA": "b",
                "CURRENT_SHA": "h",
            }
        )
        == "b..h"
    )


def test_an_unavailable_change_range_checks_the_desktop_app(monkeypatch):
    def missing_range(command):
        raise subprocess.CalledProcessError(128, command)

    monkeypatch.setattr(ci_change_scope.subprocess, "check_output", missing_range)
    assert ci_change_scope.changed_paths("missing...range") is None


def _gate(**results: str) -> subprocess.CompletedProcess[str]:
    text = WORKFLOW.read_text(encoding="utf-8")
    gate = text.split("\n  dependency-gate:\n", 1)[1]
    script = textwrap.dedent(
        gate.split("<<'PY'\n", 1)[1].split("\n          PY\n", 1)[0]
    )
    outputs = {
        "docs_only": results.pop("docs_only"),
        "desktop_checks": results.pop("desktop_checks"),
        "full_e2e": "false",
    }
    needs = {"change-scope": {"result": "success", "outputs": outputs}}
    needs["browser-e2e"] = {"result": "skipped", "outputs": {}}
    needs.update(
        {name: {"result": result, "outputs": {}} for name, result in results.items()}
    )
    return subprocess.run(
        [sys.executable, "-c", script],
        env={**os.environ, "RESULTS": json.dumps(needs)},
        capture_output=True,
        text=True,
    )


WEB_ONLY_RUN = {
    "checks": "success",
    "web-checks": "success",
    "audit": "success",
    "checks-windows": "skipped",
    "checks-macos": "skipped",
}


def test_desktop_checks_run_and_gate_only_for_desktop_changes():
    jobs = workflow_jobs()
    for name in ("checks-windows", "checks-macos"):
        assert jobs[name].needs == ["change-scope"]
        assert "needs.change-scope.outputs.docs_only != 'true'" in jobs[name].condition
        assert (
            "needs.change-scope.outputs.desktop_checks == 'true'"
            in jobs[name].condition
        )
        assert name in jobs["dependency-gate"].needs
    # The web site and the security audit still run for every change.
    for name in ("checks", "web-checks", "audit"):
        assert "desktop_checks" not in jobs[name].condition
    text = WORKFLOW.read_text(encoding="utf-8")
    assert "check_jobs = ['checks', 'web-checks', 'audit']" in text
    assert "run: python scripts/ci_change_scope.py" in text

    assert (
        _gate(docs_only="false", desktop_checks="false", **WEB_ONLY_RUN).returncode == 0
    )
    desktop_run = {
        **WEB_ONLY_RUN,
        "checks-windows": "success",
        "checks-macos": "success",
    }
    assert (
        _gate(docs_only="false", desktop_checks="true", **desktop_run).returncode == 0
    )
    # A desktop change whose desktop jobs were skipped or failed must not pass the gate.
    assert _gate(docs_only="false", desktop_checks="true", **WEB_ONLY_RUN).returncode
    failed = {**desktop_run, "checks-macos": "failure"}
    assert _gate(docs_only="false", desktop_checks="true", **failed).returncode
    # Nor may a web-only change pass when the always-on checks are skipped.
    assert _gate(
        docs_only="false",
        desktop_checks="false",
        **{**WEB_ONLY_RUN, "web-checks": "skipped"},
    ).returncode
    # A missing desktop scope fails closed.
    assert _gate(docs_only="false", desktop_checks="", **desktop_run).returncode
    docs_run = dict.fromkeys(WEB_ONLY_RUN, "skipped")
    assert _gate(docs_only="true", desktop_checks="false", **docs_run).returncode == 0
