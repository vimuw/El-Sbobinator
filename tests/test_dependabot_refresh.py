"""Exercise the actual metadata-only workflow without making GitHub writes."""

import copy
import json
import subprocess
import textwrap
from pathlib import Path
from types import SimpleNamespace

import pytest

WORKFLOW = (
    Path(__file__).resolve().parents[1] / ".github/workflows/dependabot-automerge.yml"
)
REPO = "vimuw/El-Sbobinator"
BASE = "a" * 40
HEAD = "b" * 40
REFRESH_TOKEN = "fixture-user-token"


@pytest.fixture
def github(monkeypatch):
    pr = {
        "number": 150,
        "state": "open",
        "draft": False,
        "user": {"login": "dependabot[bot]"},
        # The recorded base is current, but actual ancestry is stale, as in #150.
        "base": {"ref": "main", "sha": BASE},
        "head": {
            "sha": HEAD,
            "ref": "dependabot/uv/python-group",
            "repo": {"full_name": REPO},
        },
        "auto_merge": {"merge_method": "squash"},
    }
    commit = {
        "sha": HEAD,
        "author": {"login": "dependabot[bot]"},
        "committer": {"login": "web-flow"},
        "commit": {"verification": {"verified": True}},
    }
    state = SimpleNamespace(
        pr=pr,
        commits=[commit],
        behind=1,
        comments=[],
        posts=[],
        calls=[],
        second_pr=None,
        latest=None,
        latest_base=BASE,
        fail=False,
        actor_type="User",
    )
    reads = 0
    base_reads = 0

    def run(command, *, input, **kwargs):
        nonlocal reads, base_reads
        assert command[:2] == ["gh", "api"]
        assert kwargs["check"]
        assert kwargs["encoding"] == "utf-8"
        path = command[2].removeprefix(f"repos/{REPO}/")
        state.calls.append(path)
        if state.fail:
            raise subprocess.CalledProcessError(1, command, stderr="API unavailable")
        if input is not None:
            assert command[3:] == ["--method", "POST", "--input", "-"]
            assert path == "issues/150/comments"
            # Dependabot rejects commands posted as github-actions[bot], even
            # when GITHUB_TOKEN is allowed to create the comment itself.
            assert kwargs.get("env", {}).get("GH_TOKEN") == REFRESH_TOKEN
            state.posts.append(json.loads(input))
            data = {"id": 1}
        elif path == "/user":
            assert kwargs.get("env", {}).get("GH_TOKEN") == REFRESH_TOKEN
            data = {"login": "vimuw", "type": state.actor_type}
        elif path == "git/ref/heads/main":
            base_reads += 1
            data = {"object": {"sha": BASE if base_reads == 1 else state.latest_base}}
        elif path.startswith("pulls?"):
            data = [copy.deepcopy(state.pr)]
            if state.second_pr:
                data.append(state.second_pr)
        elif path == "pulls/150":
            reads += 1
            data = state.latest if reads > 1 and state.latest else state.pr
        elif path.startswith("compare/"):
            assert path == f"compare/{BASE}...{HEAD}"
            data = {"behind_by": state.behind}
        elif path.startswith("pulls/150/commits?"):
            data = state.commits
        elif path.startswith("issues/150/comments?"):
            data = state.comments
        else:
            pytest.fail(f"Unexpected GitHub request: {path}")
        # Match gh api --paginate --slurp, including an additional result page.
        if "--paginate" in command:
            assert "--slurp" in command
            data = [[], data]
        return SimpleNamespace(stdout=json.dumps(data))

    monkeypatch.setattr(subprocess, "run", run)
    monkeypatch.setenv("GH_REPO", REPO)
    monkeypatch.setenv("DEPENDABOT_REFRESH_TOKEN", REFRESH_TOKEN)
    monkeypatch.delenv("REFRESH_DRY_RUN", raising=False)
    return state


def run_refresh():
    # Execute the same Python block as Actions, without a YAML package dependency.
    block = WORKFLOW.read_text(encoding="utf-8").split("python - <<'PY'\n", 1)[1]
    source = textwrap.dedent(block).rsplit("\nPY", 1)[0]
    exec(compile(source, str(WORKFLOW), "exec"), {})


def test_stale_pr_is_refreshed_even_when_recorded_base_is_current(github):
    run_refresh()
    assert len(github.posts) == 1
    assert github.posts[0]["body"].startswith("@dependabot recreate\n")
    assert f"dependabot-refresh:{BASE}:{HEAD}" in github.posts[0]["body"]
    # A comment lets Dependabot trigger fresh CI; no branch writes or merge bypass.
    assert not any(
        "update-branch" in path or path.endswith("/merge") for path in github.calls
    )


@pytest.mark.parametrize(
    "change",
    [
        {"state": "closed"},
        {"draft": True},
        {"user": {"login": "human"}},
        {"auto_merge": None},
        {"base": {"ref": "other"}},
        {"head": {"ref": "dependabot/test", "repo": None}},
        {"head": {"ref": "dependabot/test", "repo": {"full_name": "other/repo"}}},
        {"head": {"ref": "manual", "repo": {"full_name": REPO}}},
    ],
)
def test_ineligible_prs_are_untouched(github, change):
    github.pr.update(change)
    run_refresh()
    assert github.posts == []


def test_current_pr_is_untouched(github):
    github.behind = 0
    run_refresh()
    assert github.posts == []
    assert not any("/commits?" in path for path in github.calls)


@pytest.mark.parametrize("change", ["extra", "author", "committer", "unsigned", "sha"])
def test_manual_or_unverified_changes_are_not_overwritten(github, change):
    if change == "extra":
        github.commits.append(copy.deepcopy(github.commits[0]))
    elif change in {"author", "committer"}:
        github.commits[0][change] = {"login": "human"}
    elif change == "unsigned":
        github.commits[0]["commit"]["verification"]["verified"] = False
    else:
        github.commits[0]["sha"] = "c" * 40
    run_refresh()
    assert github.posts == []


@pytest.mark.parametrize("same_revision", [True, False])
def test_duplicate_requests_are_suppressed_per_base_and_head(github, same_revision):
    base = BASE if same_revision else "c" * 40
    github.comments = [
        {
            "user": {"login": "vimuw"},
            "body": f"<!-- dependabot-refresh:{base}:{HEAD} -->",
        }
    ]
    run_refresh()
    assert len(github.posts) == (0 if same_revision else 1)


@pytest.mark.parametrize("change", ["head", "closed", "opt_out", "main"])
def test_changes_during_scan_prevent_stale_commands(github, change):
    github.latest = copy.deepcopy(github.pr)
    if change == "head":
        github.latest["head"]["sha"] = "c" * 40
    elif change == "closed":
        github.latest["state"] = "closed"
    elif change == "opt_out":
        github.latest["auto_merge"] = None
    else:
        github.latest_base = "c" * 40
    run_refresh()
    assert github.posts == []


def test_only_one_refresh_is_requested_per_run(github):
    github.second_pr = {**github.pr, "number": 151}
    run_refresh()
    assert len(github.posts) == 1
    assert "pulls/151" not in github.calls


def test_dry_run_reads_real_metadata_without_posting(github, monkeypatch):
    monkeypatch.setenv("REFRESH_DRY_RUN", "true")
    run_refresh()
    assert github.posts == []
    assert "pulls/150" in github.calls


def test_api_failure_is_reported_instead_of_claiming_success(github):
    github.fail = True
    with pytest.raises(subprocess.CalledProcessError):
        run_refresh()
    assert github.posts == []


def test_missing_user_token_fails_without_posting_an_ineffective_command(
    github, monkeypatch
):
    monkeypatch.delenv("DEPENDABOT_REFRESH_TOKEN")
    with pytest.raises(SystemExit, match="DEPENDABOT_REFRESH_TOKEN"):
        run_refresh()
    assert github.posts == []


def test_bot_token_is_rejected_before_posting(github):
    github.actor_type = "Bot"
    with pytest.raises(SystemExit, match="user"):
        run_refresh()
    assert github.posts == []


def test_previous_rejected_bot_command_does_not_suppress_user_retry(github):
    github.comments = [
        {
            "user": {"login": "github-actions[bot]"},
            "body": f"@dependabot recreate\n<!-- dependabot-refresh:{BASE}:{HEAD} -->",
        },
        {
            "user": {"login": "dependabot[bot]"},
            "body": "Sorry, only users with push access can use that command.",
        },
    ]
    run_refresh()
    assert len(github.posts) == 1


def test_rejected_user_command_is_reported_instead_of_claiming_it_is_pending(github):
    github.comments = [
        {
            "user": {"login": "vimuw"},
            "body": f"@dependabot recreate\n<!-- dependabot-refresh:{BASE}:{HEAD} -->",
        },
        {
            "user": {"login": "dependabot[bot]"},
            "body": "Sorry, only users with push access can use that command.",
        },
    ]
    with pytest.raises(SystemExit, match="needs push access"):
        run_refresh()
    assert github.posts == []


def test_dry_run_can_diagnose_missing_token_without_writes(github, monkeypatch):
    monkeypatch.delenv("DEPENDABOT_REFRESH_TOKEN")
    monkeypatch.setenv("REFRESH_DRY_RUN", "true")
    run_refresh()
    assert github.posts == []
