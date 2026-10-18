"""Persistence regressions for session-owned playback audio (real local FFmpeg)."""

import json
import os
import shutil
import subprocess
import threading
import wave
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import MagicMock, patch
from urllib.request import Request, urlopen

import pytest

from el_sbobinator.app_webview import ElSbobinatorApi
from el_sbobinator.core.media_server import LocalMediaServer
from el_sbobinator.core.session_storage import _folder_size
from el_sbobinator.core.session_store import PRECONVERTED_AUDIO_FINAL
from el_sbobinator.services.archive_service import (
    find_candidate_audio_path,
    list_completed_sessions,
)
from el_sbobinator.services.audio_service import (
    preconvert_media_to_mp3,
    probe_media_duration,
    resolve_ffmpeg,
)
from el_sbobinator.services.export_service import export_final_html_document
from el_sbobinator.services.revision_service import execute_failed_blocks_retry_workflow
from el_sbobinator.services.session_audio_service import (
    attach_playback_audio,
    create_playback_audio,
    managed_audio_path,
    playback_audio_path,
)
from el_sbobinator.services.sharing_service import (
    create_sbobina_package,
    find_audio_for_session,
    unpack_and_import_package,
)


@pytest.fixture
def session_audio(tmp_path):
    source = tmp_path / "Lezione originale.wav"
    with wave.open(str(source), "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(16000)
        audio.writeframes(b"\x00\x00" * 32000)
    root = tmp_path / "sessions"
    session = root / "lezione"
    session.mkdir(parents=True)
    html = session / "Lezione_Sbobina.html"
    html.write_text("<p>Lezione</p>", encoding="utf-8")
    data = {
        "stage": "done",
        "title": "Lezione",
        "input": {
            "path": str(source),
            "name": source.name,
            "size": source.stat().st_size,
        },
        "outputs": {"html": str(html)},
        "phase1": {"duration_seconds": 2},
    }
    (session / "session.json").write_text(json.dumps(data), encoding="utf-8")
    api = ElSbobinatorApi()
    with patch.object(api, "_get_session_root", return_value=str(root)):
        yield api, session, source, data


def load_session(session):
    return json.loads((session / "session.json").read_text(encoding="utf-8"))


def resolve_audio(api, session, source=""):
    with patch(
        "el_sbobinator.core.media_server.LocalMediaServer.stream_url_for_file",
        return_value="http://localhost/audio",
    ) as stream:
        result = api.stream_media_file(str(source), str(session))
    return result, stream.call_args.args[0] if stream.called else None


def test_legacy_open_retains_audio_after_source_move_and_restart(session_audio):
    api, session, source, original = session_audio
    source_bytes = source.read_bytes()
    result, played = resolve_audio(api, session, source)
    assert result["ok"] and "warning" not in result
    assert played is not None
    assert Path(played).parent == session / "audio"
    saved = load_session(session)
    assert saved["input"] == original["input"]
    assert saved["title"] == "Lezione"
    assert not os.path.isabs(saved["playback_audio"])
    duration, _ = probe_media_duration(played)
    assert duration is not None and duration == pytest.approx(2, abs=0.15)
    assert_mp3_bitrate(played, 32)
    source.rename(source.with_name("Spostata.wav"))
    assert source.with_name("Spostata.wav").read_bytes() == source_bytes
    restarted = ElSbobinatorApi()
    with patch.object(restarted, "_get_session_root", return_value=str(session.parent)):
        with patch(
            "el_sbobinator.services.session_audio_service.preconvert_media_to_mp3"
        ) as convert:
            reopened, reopened_path = resolve_audio(restarted, session, source)
    assert reopened["ok"] and reopened_path == played
    convert.assert_not_called()
    assert find_candidate_audio_path(saved, str(session)) == played


def test_legacy_open_retains_supplied_moved_source_with_stale_metadata(session_audio):
    api, session, source, original = session_audio
    moved = source.with_name("Spostata.wav")
    source.rename(moved)
    source_bytes = moved.read_bytes()

    result, played = resolve_audio(api, session, moved)

    assert result["ok"] and "warning" not in result
    assert played is not None
    saved = load_session(session)
    assert played == playback_audio_path(saved, str(session))
    assert saved["input"] == original["input"]
    assert saved["title"] == original["title"]
    assert moved.read_bytes() == source_bytes
    duration, _ = probe_media_duration(played)
    assert duration == pytest.approx(2, abs=0.15)

    restarted = ElSbobinatorApi()
    with (
        patch.object(restarted, "_get_session_root", return_value=str(session.parent)),
        patch(
            "el_sbobinator.services.session_audio_service.preconvert_media_to_mp3"
        ) as convert,
    ):
        # A valid supplied source must not replace the existing retained copy.
        assert resolve_audio(restarted, session, moved)[1] == played
        moved.unlink()
        reopened, reopened_path = resolve_audio(restarted, session, moved)
    assert reopened["ok"] and reopened_path == played
    convert.assert_not_called()


@pytest.mark.parametrize("suffix", [".txt", ".wav"])
def test_legacy_open_rejects_invalid_supplied_fallback(session_audio, suffix):
    api, session, source, original = session_audio
    source.unlink()
    invalid = source.with_name(f"Non audio{suffix}")
    invalid.write_text("Questo file non contiene audio.", encoding="utf-8")

    with patch(
        "el_sbobinator.services.session_audio_service.preconvert_media_to_mp3"
    ) as convert:
        result, played = resolve_audio(api, session, invalid)

    assert not result["ok"] and played is None
    assert load_session(session) == original
    assert not (session / "audio").exists()
    convert.assert_not_called()


def test_interrupted_playback_copy_uses_and_frees_transcription_audio(session_audio):
    api, session, source, original = session_audio
    # Closing the app while a run encodes its playback copy leaves this behind.
    preconverted = session / PRECONVERTED_AUDIO_FINAL
    ok, error = preconvert_media_to_mp3(str(source), str(preconverted))
    assert ok, error
    source.rename(source.with_name("Spostata.wav"))

    result, played = resolve_audio(api, session, source)

    assert result["ok"] and "warning" not in result
    assert played is not None
    assert played == playback_audio_path(load_session(session), str(session))
    assert not preconverted.exists()
    assert load_session(session)["input"] == original["input"]
    duration, _ = probe_media_duration(played)
    assert duration == pytest.approx(2, abs=0.15)


def test_relink_then_move_original_and_remove_frees_only_internal_audio(session_audio):
    api, session, source, _ = session_audio
    assert api.update_session_input_path(str(session), str(source))["ok"]
    saved = load_session(session)
    internal_path = playback_audio_path(saved, str(session))
    assert internal_path is not None
    internal = Path(internal_path)
    retained_size = internal.stat().st_size
    source.rename(source.with_name("Altrove.wav"))
    before = _folder_size(str(session))
    assert resolve_audio(api, session, source)[0]["ok"]
    assert api.remove_session_audio(str(session))["ok"]
    assert not internal.exists()
    assert _folder_size(str(session)) < before - retained_size + 100
    assert source.with_name("Altrove.wav").exists()
    saved = load_session(session)
    assert saved["title"] == "Lezione" and saved["audio_removed"]
    # Stale browser/queue source paths must never resurrect removed audio.
    assert not resolve_audio(api, session, source.with_name("Altrove.wav"))[0][
        "has_audio"
    ]
    assert find_audio_for_session(str(session), saved) is None
    assert api.update_session_input_path(
        str(session), str(source.with_name("Altrove.wav"))
    )["ok"]
    assert not load_session(session).get("audio_removed")


def assert_mp3_bitrate(path, bitrate):
    decoded = subprocess.run(
        [resolve_ffmpeg(), "-hide_banner", "-i", str(path), "-f", "null", "-"],
        capture_output=True,
        text=True,
        errors="replace",
        check=True,
    )
    stream = next(line for line in decoded.stderr.splitlines() if "Audio: mp3" in line)
    assert "16000 Hz, mono" in stream
    assert f", {bitrate} kb/s" in stream


def test_preconverted_transcription_audio_stays_48k_while_playback_is_32k(
    session_audio,
):
    _api, session, source, _data = session_audio
    preconverted = session / "preconverted.mp3"
    ok, error = preconvert_media_to_mp3(str(source), str(preconverted), bitrate="48k")
    assert ok, error
    content = preconverted.read_bytes()
    path = create_playback_audio(
        str(session), "missing.wav", preconverted_path=str(preconverted)
    )
    assert preconverted.read_bytes() == content
    assert_mp3_bitrate(preconverted, 48)
    assert_mp3_bitrate(path, 32)
    assert 0.55 < Path(path).stat().st_size / len(content) < 0.8
    assert probe_media_duration(path)[0] == pytest.approx(2, abs=0.15)


@pytest.mark.parametrize(
    "failure", ["cancelled", "disk full", "empty_output", "promotion"]
)
@pytest.mark.parametrize("use_preconverted", [False, True])
def test_failed_conversion_never_publishes_partial_or_changes_source(
    tmp_path, failure, use_preconverted
):
    session = tmp_path / "session"
    session.mkdir()
    source = tmp_path / "original.wav"
    source.write_bytes(b"original content")
    preconverted = session / "transcription.mp3"
    if use_preconverted:
        preconverted.write_bytes(b"transcription" * 1024)
    cache = str(preconverted) if use_preconverted else None

    def convert(**kwargs):
        Path(kwargs["output_path"]).write_bytes(
            b"partial" if failure == "empty_output" else b"mp3" * 1024
        )
        return failure in {"empty_output", "promotion"}, failure

    with patch(
        "el_sbobinator.services.session_audio_service.preconvert_media_to_mp3",
        side_effect=convert,
    ):
        if failure == "promotion":
            with patch(
                "el_sbobinator.services.session_audio_service.os.replace",
                side_effect=OSError("disk full"),
            ):
                with pytest.raises(OSError):
                    create_playback_audio(
                        str(session), str(source), preconverted_path=cache
                    )
        else:
            with pytest.raises(RuntimeError):
                create_playback_audio(
                    str(session), str(source), preconverted_path=cache
                )
    assert list((session / "audio").iterdir()) == []
    assert source.read_bytes() == b"original content"
    if use_preconverted:
        assert preconverted.read_bytes() == b"transcription" * 1024


def test_existing_48k_playback_is_not_reencoded_on_open(session_audio):
    api, session, source, data = session_audio
    existing = session / "audio" / "old-playback.mp3"
    existing.parent.mkdir()
    ok, error = preconvert_media_to_mp3(str(source), str(existing), bitrate="48k")
    assert ok, error
    content = existing.read_bytes()
    attach_playback_audio(data, str(session), str(existing))
    (session / "session.json").write_text(json.dumps(data), encoding="utf-8")
    source.unlink()
    with patch(
        "el_sbobinator.services.session_audio_service.preconvert_media_to_mp3"
    ) as convert:
        result, played = resolve_audio(api, session, source)
    assert result["ok"] and played == str(existing)
    assert existing.read_bytes() == content
    convert.assert_not_called()


def test_relink_failure_preserves_previous_association(session_audio):
    api, session, source, _ = session_audio
    assert api.update_session_input_path(str(session), str(source))["ok"]
    saved = load_session(session)
    with patch(
        "el_sbobinator.services.session_audio_service.preconvert_media_to_mp3",
        return_value=(False, "disk full"),
    ):
        assert not api.update_session_input_path(str(session), str(source))["ok"]
    assert load_session(session) == saved
    assert playback_audio_path(saved, str(session))


def test_failed_relink_metadata_write_removes_new_copy_only(session_audio):
    api, session, source, _ = session_audio
    assert api.update_session_input_path(str(session), str(source))["ok"]
    saved = load_session(session)
    with patch(
        "el_sbobinator.bridge.controllers.session_controller._atomic_write_json",
        side_effect=OSError("read only"),
    ):
        assert not api.update_session_input_path(str(session), str(source))["ok"]
    assert load_session(session) == saved
    assert len(list((session / "audio").glob("*.mp3"))) == 1


def test_failed_remove_restores_association(session_audio):
    api, session, source, _ = session_audio
    assert api.update_session_input_path(str(session), str(source))["ok"]
    saved = load_session(session)
    with patch(
        "el_sbobinator.bridge.controllers.session_controller.discard_playback_audio",
        side_effect=PermissionError("busy"),
    ):
        assert not api.remove_session_audio(str(session))["ok"]
    assert load_session(session) == saved
    assert playback_audio_path(saved, str(session))
    assert source.exists()


def test_copy_still_streamed_at_relink_is_deleted_on_a_later_open(session_audio):
    api, session, source, _ = session_audio
    assert api.update_session_input_path(str(session), str(source))["ok"]
    old_path = playback_audio_path(load_session(session), str(session))
    assert old_path is not None
    old = Path(old_path)
    # Windows cannot delete a copy that the player's open stream still reads.
    with patch(
        "el_sbobinator.bridge.controllers.session_controller.discard_playback_audio",
        side_effect=PermissionError("in use"),
    ):
        assert api.update_session_input_path(str(session), str(source))["ok"]
    current_path = playback_audio_path(load_session(session), str(session))
    assert current_path is not None
    current = Path(current_path)
    assert old.exists() and current != old
    os.utime(old, (old.stat().st_atime, old.stat().st_mtime - 3600))
    # A copy published moments ago may still be waiting for its session link.
    pending = session / "audio" / f"playback-{'0' * 32}.mp3"
    pending.write_bytes(b"\x00" * 2048)

    result, played = resolve_audio(api, session)

    assert result["ok"] and played == str(current)
    assert not old.exists()
    assert current.exists() and pending.exists() and source.exists()


def test_legacy_conversion_failure_plays_original_with_explicit_warning(session_audio):
    api, session, source, original = session_audio
    with patch(
        "el_sbobinator.services.session_audio_service.preconvert_media_to_mp3",
        return_value=(False, "disk full"),
    ):
        result, played = resolve_audio(api, session, source)
    assert result["ok"] and played == str(source)
    assert "originale" in result["warning"]
    assert load_session(session) == original


def test_internal_audio_survives_archive_move_and_package_roundtrip(
    session_audio, tmp_path
):
    api, session, source, original = session_audio
    assert resolve_audio(api, session, source)[0]["ok"]
    saved = load_session(session)
    source.unlink()
    moved = tmp_path / "moved" / "lezione"
    moved.parent.mkdir()
    shutil.move(str(session), moved)
    assert playback_audio_path(saved, str(moved))
    assert find_candidate_audio_path(saved, str(moved))
    # Repair the document location exactly as the archive listing does.
    saved["outputs"]["html"] = str(moved / "Lezione_Sbobina.html")
    (moved / "session.json").write_text(json.dumps(saved), encoding="utf-8")
    package = tmp_path / "lezione.sbobina"
    assert create_sbobina_package(str(moved), str(package))["audio_included"]
    imported = unpack_and_import_package(str(package), str(tmp_path / "imported"))
    assert imported["ok"] and imported["has_audio"]
    imported_dir = Path(imported["session_dir"])
    imported_data = load_session(imported_dir)
    assert imported_data["title"] == original["title"]
    assert playback_audio_path(imported_data, str(imported_dir))
    # A text-only package cannot retain a usable host audio reference.
    assert create_sbobina_package(str(moved), str(package), include_mode="text_only")[
        "ok"
    ]
    text_only = unpack_and_import_package(str(package), str(tmp_path / "text-only"))
    assert text_only["ok"] and not text_only["has_audio"]
    assert (
        find_audio_for_session(
            text_only["session_dir"], load_session(Path(text_only["session_dir"]))
        )
        is None
    )


def test_imported_playback_copy_keeps_the_source_identity(session_audio, tmp_path):
    # Duplicate detection matches the archive by source name, size and duration:
    # the internal copy's UUID name and smaller size must not replace them.
    api, session, source, original = session_audio
    assert resolve_audio(api, session, source)[0]["ok"]
    package = tmp_path / "lezione.sbobina"
    assert create_sbobina_package(str(session), str(package))["audio_included"]
    imported = unpack_and_import_package(str(package), str(tmp_path / "imported"))
    imported_dir = Path(imported["session_dir"])
    imported_data = load_session(imported_dir)
    playback = playback_audio_path(imported_data, str(imported_dir))
    assert playback and Path(playback).name.startswith("playback-")
    assert imported_data["input"]["path"] == playback
    assert imported_data["input"]["name"] == original["input"]["name"]
    assert imported_data["input"]["size"] == original["input"]["size"]
    listed, _total = list_completed_sessions(str(tmp_path / "imported"))
    assert listed[0]["input_name"] == source.name
    assert listed[0]["input_size"] == original["input"]["size"]

    # A package carrying the original file keeps that file's own identity.
    legacy = tmp_path / "legacy"
    shutil.copytree(session, legacy)
    legacy_data = load_session(legacy)
    legacy_data.pop("playback_audio")
    legacy_data["input"]["name"] = "Nome precedente.wav"
    (legacy / "session.json").write_text(json.dumps(legacy_data), encoding="utf-8")
    assert create_sbobina_package(
        str(legacy), str(package), audio_path_override=str(source)
    )["audio_included"]
    imported = unpack_and_import_package(str(package), str(tmp_path / "legacy-in"))
    legacy_input = load_session(Path(imported["session_dir"]))["input"]
    assert legacy_input["name"] == source.name
    assert legacy_input["size"] == source.stat().st_size


@pytest.mark.parametrize(
    "relative",
    ["../source.mp3", "audio/../../source.mp3", "audio/file.html", "", "/external.mp3"],
)
def test_managed_audio_rejects_external_or_non_audio_paths(tmp_path, relative):
    assert managed_audio_path(str(tmp_path / "session"), relative) is None


def test_playback_audio_resolves_through_a_linked_session_root(tmp_path):
    real_root = tmp_path / "real"
    (real_root / "session").mkdir(parents=True)
    # A link at a different depth than its target, like macOS /var -> /private/var.
    linked_root = tmp_path / "links" / "nested" / "root"
    linked_root.parent.mkdir(parents=True)
    try:
        os.symlink(real_root, linked_root, target_is_directory=True)
    except OSError:
        if os.name != "nt":
            raise
        import _winapi

        _winapi.CreateJunction(str(real_root), str(linked_root))
    session = linked_root / "session"
    source = tmp_path / "source.mp3"
    source.write_bytes(b"mp3" * 1024)

    def convert(**kwargs):
        shutil.copyfile(kwargs["input_path"], kwargs["output_path"])
        return True, None

    with patch(
        "el_sbobinator.services.session_audio_service.preconvert_media_to_mp3",
        side_effect=convert,
    ):
        path = create_playback_audio(str(session), str(source))
    data = {}
    attach_playback_audio(data, str(session), path)

    assert not os.path.isabs(data["playback_audio"])
    assert playback_audio_path(data, str(session)) == path
    assert playback_audio_path(data, str(real_root / "session")) == path


def test_missing_source_creates_no_asset(tmp_path):
    with pytest.raises(FileNotFoundError):
        create_playback_audio(str(tmp_path / "session"), str(tmp_path / "missing.mp3"))
    assert list((tmp_path / "session" / "audio").iterdir()) == []


def test_remove_cannot_delete_original_via_forged_playback_path(session_audio):
    api, session, source, data = session_audio
    attach_playback_audio(data, str(session), str(source))
    (session / "session.json").write_text(json.dumps(data), encoding="utf-8")
    assert api.remove_session_audio(str(session))["ok"]
    assert source.exists()


def test_real_byte_range_stream_after_original_is_removed(session_audio):
    api, session, source, _ = session_audio
    try:
        first = api.stream_media_file(str(source), str(session))
        assert first["ok"]
        source.unlink()
        reopened = api.stream_media_file(str(source), str(session))
        with urlopen(
            Request(reopened["url"], headers={"Range": "bytes=0-255"}), timeout=3
        ) as response:
            assert response.status == 206
            assert response.headers["Content-Type"] == "audio/mpeg"
            received = response.read()
        internal = playback_audio_path(load_session(session), str(session))
        assert internal is not None
        assert received == Path(internal).read_bytes()[:256]
    finally:
        LocalMediaServer.shutdown_all()


def test_editor_autosave_and_open_timestamp_survive_slow_audio_preparation(
    session_audio,
):
    api, session, source, _ = session_audio
    entered, finish = threading.Event(), threading.Event()

    def convert(**kwargs):
        entered.set()
        assert finish.wait(timeout=4)
        Path(kwargs["output_path"]).write_bytes(b"mp3" * 1024)
        return True, None

    def edit_and_touch():
        api._mark_session_user_edited_for_html(str(session / "Lezione_Sbobina.html"))
        assert api.touch_session_opened(str(session))["ok"]

    with patch(
        "el_sbobinator.services.session_audio_service.preconvert_media_to_mp3",
        side_effect=convert,
    ):
        with ThreadPoolExecutor(max_workers=2) as pool:
            preparing = pool.submit(
                api._resolve_stream_media_path, str(source), str(session)
            )
            assert entered.wait(timeout=2)
            try:
                editing = pool.submit(edit_and_touch)
                editing.result(timeout=2)
            finally:
                finish.set()
            assert preparing.result(timeout=2)[0]
    saved = load_session(session)
    assert saved["user_edited"] and saved["last_opened_at"]
    assert playback_audio_path(saved, str(session))


def test_failed_legacy_metadata_write_warns_without_leaving_an_orphan(session_audio):
    api, session, source, original = session_audio
    with patch(
        "el_sbobinator.bridge.controllers.media_controller._atomic_write_json",
        side_effect=OSError("read only"),
    ):
        result, played = resolve_audio(api, session, source)
    assert result["ok"] and result["warning"] and played == str(source)
    assert load_session(session) == original
    assert list((session / "audio").iterdir()) == []


@pytest.mark.parametrize("audio_change", ["legacy_open", "relink", "remove"])
def test_retry_preserves_concurrent_audio_changes(session_audio, audio_change):
    api, session, source, _ = session_audio
    if audio_change != "legacy_open":
        assert api.update_session_input_path(str(session), str(source))["ok"]
    snapshot = load_session(session)
    snapshot["revision_failed_blocks"] = [1]
    (session / "session.json").write_text(json.dumps(snapshot), encoding="utf-8")
    revised_dir = session / "phase2_revised"
    revised_dir.mkdir()
    (revised_dir / "rev_001.raw.md").write_text("Blocco grezzo.", encoding="utf-8")
    runtime = MagicMock()
    runtime.cancelled.return_value = False
    expected_audio = {}
    audio_keys = ("input", "title", "playback_audio", "audio_removed")

    def revise_with_audio_change(**kwargs):
        if audio_change == "legacy_open":
            assert resolve_audio(api, session, source)[0]["ok"]
        elif audio_change == "relink":
            replacement = source.with_name("Nuovo audio.wav")
            shutil.copyfile(source, replacement)
            assert api.update_session_input_path(str(session), str(replacement))["ok"]
            replacement.unlink()
        else:
            assert api.remove_session_audio(str(session))["ok"]
        current = load_session(session)
        expected_audio.update(
            {key: current[key] for key in audio_keys if key in current}
        )
        source.unlink()
        return kwargs["client"], "Blocco revisionato."

    def export_after_retry_save(**kwargs):
        # Check the per-block save as well as the workflow's final save.
        current = load_session(session)
        assert {
            key: current[key] for key in audio_keys if key in current
        } == expected_audio
        return export_final_html_document(**kwargs)

    with (
        patch("el_sbobinator.services.config_service.load_config", return_value={}),
        patch("el_sbobinator.services.generation_service.create_gemini_client"),
        patch(
            "el_sbobinator.services.generation_service.load_fallback_keys",
            return_value=[],
        ),
        patch(
            "el_sbobinator.services.revision_service._revise_single_macro_block",
            side_effect=revise_with_audio_change,
        ),
        patch(
            "el_sbobinator.services.export_service.export_final_html_document",
            side_effect=export_after_retry_save,
        ),
    ):
        result = execute_failed_blocks_retry_workflow(
            session=snapshot,
            session_path=str(session / "session.json"),
            session_dir=str(session),
            api_key="offline-mocked",
            runtime=runtime,
            retry_cancel_event=threading.Event(),
        )
    assert result["ok"] and result["retried_blocks"] == [1]
    assert Path(result["html_path"]).name == f"{source.stem}_Sbobina.html"
    assert "Blocco revisionato." in Path(result["html_path"]).read_text(
        encoding="utf-8"
    )
    saved = load_session(session)
    assert {key: saved[key] for key in audio_keys if key in saved} == expected_audio
    assert saved["revision_failed_blocks"] == []
    assert saved["completion_status"] == "completed"
    reopened, played = resolve_audio(api, session)
    if audio_change == "remove":
        assert not reopened["has_audio"] and played is None
        assert list((session / "audio").glob("*.mp3")) == []
    else:
        assert reopened["ok"] and "warning" not in reopened
        assert played == playback_audio_path(saved, str(session))


def test_archive_keeps_source_identity_when_playback_audio_is_retained(session_audio):
    api, session, source, original = session_audio
    assert resolve_audio(api, session, source)[0]["ok"]
    for source_exists in (True, False):
        if not source_exists:
            source.unlink()
        result = api.get_completed_sessions(limit=0)
        assert result["ok"] and len(result["sessions"]) == 1
        archived = result["sessions"][0]
        assert archived["input_path"] == str(source)
        assert archived["input_size"] == original["input"]["size"]
        assert archived["name"] == "Lezione"
        reopened, played = resolve_audio(api, session, archived["input_path"])
        assert reopened["ok"] and "warning" not in reopened
        assert played != archived["input_path"]
