"""Manual model selection, legacy data migration and regeneration regressions."""

import json
import threading
import time
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest

from el_sbobinator.bridge.controllers.pipeline_controller import _handle_file_completed
from el_sbobinator.core.session_store import SessionPaths, new_session, save_session
from el_sbobinator.pipeline.pipeline import (
    _export_html_and_finish,
    _handle_regeneration_flow,
    _run_phase2_revision,
)
from el_sbobinator.pipeline.pipeline_adapter import PipelineAdapter
from el_sbobinator.pipeline.pipeline_hooks import PipelineRuntime
from el_sbobinator.pipeline.pipeline_session import initialize_session_context
from el_sbobinator.pipeline.pipeline_settings import load_and_sanitize_settings
from el_sbobinator.services import (
    archive_service,
    config_service,
    generation_service,
    revision_service,
)
from el_sbobinator.services.generation_service import (
    AdaptiveGovernor,
    DegenerateOutputError,
    retry_with_quota,
)


def test_old_config_keeps_chosen_model_and_drops_obsolete_field_on_save(
    tmp_path, monkeypatch
):
    config_path = tmp_path / "config.json"
    config_path.write_text(
        json.dumps(
            {
                "preferred_model": "gemini-2.5-flash",
                "fallback_models": ["gemini-3.6-flash"],
                "session_root": str(tmp_path / "sessions"),
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(config_service, "CONFIG_FILE", str(config_path))
    monkeypatch.setattr(
        config_service, "LEGACY_CONFIG_FILE", str(tmp_path / "legacy.json")
    )
    monkeypatch.setattr(config_service, "_config_cache", None)
    loaded = config_service.load_config()
    assert loaded["preferred_model"] == "gemini-2.5-flash"
    assert "fallback_models" not in loaded
    config_service.save_config(None)
    saved = json.loads(config_path.read_text(encoding="utf-8"))
    assert saved["preferred_model"] == "gemini-2.5-flash"
    assert "fallback_models" not in saved


def test_old_session_keeps_selected_model_and_drops_obsolete_field():
    session = {
        "settings": {
            "model": "gemini-2.5-flash",
            "fallback_models": ["gemini-3.6-flash"],
            "effective_model": "gemini-3.6-flash",
        }
    }
    settings, changed = load_and_sanitize_settings(session)
    assert changed
    assert settings.model == settings.effective_model == "gemini-2.5-flash"
    assert "fallback_models" not in session["settings"]
    assert not load_and_sanitize_settings(session)[1]


@pytest.mark.parametrize(
    "stored, expected",
    [
        ("gemini-3.6-flash", "gemini-3.6-flash"),
        ("gemini-3.7-flash", "gemini-3.8-flash"),
        ("unknown-model", "gemini-2.5-flash"),
    ],
)
@pytest.mark.parametrize("failed_blocks", [[], [1]])
def test_completed_session_preserves_historical_model_on_reuse(
    stored, expected, failed_blocks, tmp_path, monkeypatch
):
    input_path = tmp_path / "lecture.mp3"
    input_path.write_bytes(b"isolated audio fixture")
    archive = tmp_path / "archive"
    directory = archive / "session"
    directory.mkdir(parents=True)
    html = directory / "lecture.html"
    html_bytes = b"<p>Existing completed transcript</p>"
    html.write_bytes(html_bytes)
    session_path = directory / "session.json"
    session = new_session(
        str(input_path),
        settings={
            "model": "gemini-2.5-flash",
            "fallback_models": [stored],
            "effective_model": stored,
        },
    )
    session.update(
        stage="done",
        outputs={"html": str(html)},
        revision_failed_blocks=failed_blocks,
    )
    save_session(str(session_path), session)
    paths = SessionPaths(
        str(directory),
        str(session_path),
        str(directory / "phase1_chunks"),
        str(directory / "phase2_revised"),
        str(directory / "phase2_macro_blocks.json"),
    )
    monkeypatch.setattr(
        "el_sbobinator.pipeline.pipeline_session.resolve_session_paths",
        lambda *_args, **_kwargs: paths,
    )
    monkeypatch.setattr(
        "el_sbobinator.pipeline.pipeline_session.load_config",
        lambda: {"preferred_model": "gemini-2.5-flash"},
    )
    context = initialize_session_context(
        str(input_path), session_dir_hint=str(directory), resume_session=True
    )
    persisted = json.loads(session_path.read_text(encoding="utf-8"))
    assert persisted["settings"]["model"] == "gemini-2.5-flash"
    assert persisted["settings"]["effective_model"] == expected
    assert "fallback_models" not in persisted["settings"]
    assert not load_and_sanitize_settings(context.session)[1]

    cancel_event = threading.Event()
    adapter = PipelineAdapter(None, cancel_event, dispatcher=Mock())
    runtime = PipelineRuntime(adapter)
    monkeypatch.setattr(adapter, "_emit_js", Mock())
    adapter.update_model(context.settings.model)
    monkeypatch.setattr(
        "el_sbobinator.pipeline.pipeline._ask_regeneration_decision",
        lambda *_args: (False, False),
    )
    status, stage, timed_out = _handle_regeneration_flow(
        str(input_path),
        context,
        adapter,
        runtime,
        "done",
        cancel_event,
        context.save,
        Mock(),
    )
    assert (status, stage, timed_out) == ("early_done", "done", False)
    assert adapter.last_effective_model == expected
    emit = Mock()
    monkeypatch.setattr(adapter, "emit", emit)
    completion, completed = _handle_file_completed(
        0,
        {"id": "lecture", "name": input_path.name, "path": str(input_path)},
        adapter,
        adapter.last_run_status,
    )
    assert completed
    assert completion == ("completed_with_warnings" if failed_blocks else "completed")
    assert emit.call_args.args[0] == "fileDone"
    assert emit.call_args.args[1]["effective_model"] == expected
    assert emit.call_args.args[1]["revision_failed_blocks"] == failed_blocks
    sessions, total = archive_service.list_completed_sessions(str(archive))
    assert total == 1
    assert sessions[0]["effective_model"] == expected
    assert html.read_bytes() == html_bytes
    assert json.loads(session_path.read_text(encoding="utf-8")) == persisted


@pytest.mark.parametrize("stage", ["boundary", "phase2"])
@pytest.mark.parametrize("revision_mode", ["cached", "fresh", "retry", "failed"])
def test_revision_resume_records_only_the_model_that_produces_saved_content(
    stage, revision_mode, tmp_path, monkeypatch
):
    input_path = tmp_path / "lecture.mp3"
    input_path.write_bytes(b"isolated audio fixture")
    archive = tmp_path / "archive"
    directory = archive / "session"
    directory.mkdir(parents=True)
    session_path = directory / "session.json"
    historical_model = "gemini-3.6-flash"
    selected_model = "gemini-2.5-flash"
    session = new_session(
        str(input_path),
        settings={
            "model": selected_model,
            "fallback_models": [historical_model],
            "effective_model": historical_model,
        },
    )
    session.update(stage=stage, phase2={"macro_total": 1, "revised_done": 1})
    save_session(str(session_path), session)
    paths = SessionPaths(
        str(directory),
        str(session_path),
        str(directory / "phase1_chunks"),
        str(directory / "phase2_revised"),
        str(directory / "phase2_macro_blocks.json"),
    )
    monkeypatch.setattr(
        "el_sbobinator.pipeline.pipeline_session.resolve_session_paths",
        lambda *_args, **_kwargs: paths,
    )
    monkeypatch.setattr(
        "el_sbobinator.pipeline.pipeline_session.load_config",
        lambda: {"preferred_model": selected_model},
    )
    context = initialize_session_context(str(input_path), resume_session=True)
    original_text = "Original transcript"
    historical_text = "Text previously revised by Gemini 3.6"
    new_text = "Text newly revised by Gemini 2.5"
    Path(context.macro_path).write_text(
        json.dumps({"blocks": [original_text]}), encoding="utf-8"
    )
    revised_path = Path(context.phase2_revised_dir) / "rev_001.md"
    if revision_mode == "cached":
        revised_path.write_text(historical_text, encoding="utf-8")

    client = Mock()
    response = SimpleNamespace(text=new_text)
    error = RuntimeError("Selected model unavailable")
    generate = client.models.generate_content
    if revision_mode == "cached":
        generate.side_effect = AssertionError("Cached revisions must not call Gemini")
    elif revision_mode == "retry":
        generate.side_effect = [error, response]
    elif revision_mode == "failed":
        generate.side_effect = [error, error]
    else:
        generate.return_value = response
    # Exercise real generation and revision/cache paths without API retry waits
    # or writing the user's usage counters.
    monkeypatch.setattr(
        revision_service,
        "retry_with_quota",
        lambda fn, *, client, **_kwargs: (client, fn(client)),
    )
    monkeypatch.setattr(revision_service.usage_service, "record_work_completed", Mock())
    monkeypatch.setattr(revision_service, "sleep_with_cancel", lambda *_args: True)
    dispatcher = Mock()
    adapter = PipelineAdapter(None, threading.Event(), dispatcher=dispatcher)
    runtime = PipelineRuntime(adapter)
    adapter.update_model(selected_model)
    _, revised_text, should_exit = _run_phase2_revision(
        client,
        context.settings.model,
        original_text,
        context.macro_path,
        context.phase2_revised_dir,
        context.session,
        context.save,
        runtime,
        [],
        lambda: None,
        Mock(),
        context.settings,
    )
    assert not should_exit
    assert _export_html_and_finish(
        str(input_path),
        context,
        context.session,
        context.save,
        revised_text,
        context.phase2_revised_dir,
        runtime,
        adapter,
        Mock(),
        time.monotonic(),
    )
    expected_model = (
        selected_model if revision_mode in ("fresh", "retry") else historical_model
    )
    expected_text = {
        "cached": historical_text,
        "fresh": new_text,
        "retry": new_text,
        "failed": original_text,
    }[revision_mode]
    assert (
        generate.call_count
        == {"cached": 0, "fresh": 1, "retry": 2, "failed": 2}[revision_mode]
    )
    for call in generate.call_args_list:
        assert call.kwargs["model"] == selected_model
    assert revised_path.read_text(encoding="utf-8").strip() == expected_text
    persisted = json.loads(session_path.read_text(encoding="utf-8"))
    assert persisted["stage"] == "done"
    assert persisted["settings"]["effective_model"] == expected_model
    assert not load_and_sanitize_settings(persisted)[1]
    assert adapter.last_effective_model == expected_model
    _handle_file_completed(
        0,
        {"id": "lecture", "name": input_path.name, "path": str(input_path)},
        adapter,
        adapter.last_run_status,
    )
    assert dispatcher.emit.call_args.args[1]["effective_model"] == expected_model
    sessions, total = archive_service.list_completed_sessions(str(archive))
    assert total == 1
    assert sessions[0]["effective_model"] == expected_model
    assert expected_text in Path(persisted["outputs"]["html"]).read_text(
        encoding="utf-8"
    )


@pytest.mark.parametrize(
    "error",
    [
        RuntimeError("404 NOT_FOUND model unsupported for generateContent"),
        DegenerateOutputError("repeated output"),
    ],
)
def test_model_failure_surfaces_without_requesting_another_model(error):
    if not isinstance(error, DegenerateOutputError):
        error.code = 404
    generate = Mock(side_effect=error)
    client = object()
    with pytest.raises(type(error)) as caught:
        retry_with_quota(
            generate,
            client=client,
            fallback_keys=[],
            model_name="gemini-2.5-flash",
            cancelled=lambda: False,
            runtime=None,
            request_fallback_key=lambda: None,
            governor=AdaptiveGovernor(),
            retry_sleep_seconds=0.0,
        )
    assert caught.value is error
    generate.assert_called_once_with(client)


def test_regeneration_replaces_previous_model_in_completion_metadata():
    adapter = PipelineAdapter(None, threading.Event())
    with patch.object(adapter, "_emit_js"):
        adapter.update_model("gemini-3.6-flash")
        adapter.update_model("gemini-2.5-flash")
    assert adapter.last_effective_model == "gemini-2.5-flash"


@pytest.mark.parametrize(
    "stored, expected",
    [
        ("gemini-3.5-flash", "gemini-3.6-flash"),
        ("gemini-3.7-flash", "gemini-3.8-flash"),
        ("gemini-2.5-flash", "gemini-2.5-flash"),
    ],
)
def test_revision_retry_resolves_saved_model_alias_before_request(
    stored, expected, tmp_path, monkeypatch
):
    client = object()
    retry = Mock(return_value=(client, {"retried_blocks": [], "failed_blocks": [1]}))
    monkeypatch.setattr(
        config_service, "load_config", lambda: {"preferred_model": "gemini-2.5-flash"}
    )
    monkeypatch.setattr(generation_service, "create_gemini_client", lambda _key: client)
    monkeypatch.setattr(generation_service, "load_fallback_keys", lambda: [])
    monkeypatch.setattr(revision_service, "retry_failed_revision_blocks", retry)
    revision_service.execute_failed_blocks_retry_workflow(
        session={"settings": {"model": stored}},
        session_path=str(tmp_path / "session.json"),
        session_dir=str(tmp_path),
        api_key="test-key",
        runtime=Mock(),
        retry_cancel_event=threading.Event(),
    )
    assert retry.call_args.kwargs["model_name"] == expected
