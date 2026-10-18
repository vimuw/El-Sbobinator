import re
from pathlib import Path

WORKFLOW = Path(__file__).resolve().parents[1] / ".github" / "workflows" / "build.yml"


def workflow_jobs() -> dict[str, dict[str, object]]:
    text = WORKFLOW.read_text(encoding="utf-8")
    body = text.split("\njobs:\n", 1)[1]
    jobs: dict[str, dict[str, object]] = {}
    for match in re.finditer(r"^  ([\w-]+):\n((?:(?!^  [\w-]+:\n).*\n?)*)", body, re.M):
        block = match.group(2)
        needs = re.search(r"^    needs: \[([^\]]*)\]", block, re.M)
        condition = re.search(r"^    if: (.+)$", block, re.M)
        jobs[match.group(1)] = {
            "needs": [n.strip() for n in needs.group(1).split(",")] if needs else [],
            "if": condition.group(1) if condition else "",
        }
    return jobs


def test_jobs_after_a_skippable_job_do_not_inherit_the_implicit_success_guard():
    # A plain `if:` implies success(), so one skipped ancestor (for example
    # browser-e2e without full_e2e) silently skips the whole release chain.
    jobs = workflow_jobs()
    for name, job in jobs.items():
        skippable = [need for need in job["needs"] if jobs[need]["if"]]
        if skippable:
            assert "!cancelled()" in job["if"] or "always()" in job["if"], name


def test_build_requires_the_gate_and_release_context_to_succeed():
    condition = workflow_jobs()["build"]["if"]
    assert "!cancelled()" in condition
    assert "needs.dependency-gate.result == 'success'" in condition
    assert "needs.release-context.result == 'success'" in condition
    assert "startsWith(github.ref, 'refs/tags/')" in condition
    assert "github.event_name == 'workflow_dispatch'" in condition


def test_release_requires_a_successful_build_and_a_tag():
    condition = workflow_jobs()["release"]["if"]
    assert "!cancelled()" in condition
    assert "needs.build.result == 'success'" in condition
    assert "needs.release-context.outputs.tag != ''" in condition
