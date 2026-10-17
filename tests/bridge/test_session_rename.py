import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from el_sbobinator.services.sharing_service import (
    create_sbobina_package,
    unpack_and_import_package,
)
from tests.bridge.test_controllers import DummyExportHost, DummySessionHost


@pytest.fixture
def archived_session(tmp_path):
    root = tmp_path / "sessions"
    session = root / "lesson"
    session.mkdir(parents=True)
    html = session / "Originale_Sbobina.html"
    html.write_text(
        "<html><body><h1>Titolo modificato a mano</h1><p>Mitosi cellulare.</p></body></html>",
        encoding="utf-8",
    )
    audio = tmp_path / "audio.mp3"
    audio.write_bytes(b"source audio")
    data = {
        "stage": "done",
        "title": "Originale",
        "updated_at": "2026-08-01T12:00:00Z",
        "last_opened_at": "2026-09-01T10:00:00Z",
        "input": {"path": str(audio), "name": audio.name, "size": audio.stat().st_size},
        "outputs": {"html": str(html)},
        "phase1": {"duration_seconds": 60},
    }
    (session / "session.json").write_text(json.dumps(data), encoding="utf-8")
    return DummySessionHost(str(root)), session, html, data


def test_rename_persists_without_changing_document_identity_or_dates(archived_session):
    host, session, html, original = archived_session
    document = html.read_bytes()
    host.get_completed_sessions(limit=1)  # Warm the backend cache.
    assert host.rename_session(str(session), "  Fisiopatologia: immunità, lezione 2  ")[
        "ok"
    ]

    saved = json.loads((session / "session.json").read_text(encoding="utf-8"))
    assert saved == {
        **original,
        "title": "Fisiopatologia: immunità, lezione 2",
        "title_is_custom": True,
    }
    assert html.read_bytes() == document
    assert Path(original["input"]["path"]).read_bytes() == b"source audio"
    reopened = DummySessionHost(host._get_session_root())
    for api in (host, reopened):
        listing = api.get_completed_sessions(limit=1)["sessions"][0]
        assert listing["name"] == saved["title"]
        assert listing["input_name"] == "audio.mp3"
        assert listing["session_dir"] == str(session)
        assert listing["completed_at_iso"] == original["updated_at"]
    assert reopened.search_sessions("Mitosi")["results"][0]["name"] == saved["title"]


@pytest.mark.parametrize("name", ["", "  ", "x" * 201, "a\nb", "a\x00b", 42, None])
def test_rename_rejects_invalid_names_without_writing(archived_session, name):
    host, session, _html, _data = archived_session
    metadata = session / "session.json"
    original = metadata.read_bytes()
    assert not host.rename_session(str(session), name)["ok"]
    assert metadata.read_bytes() == original


def test_rename_rejects_outside_root_root_and_incomplete_sessions(
    archived_session, tmp_path
):
    host, session, _html, data = archived_session
    assert not host.rename_session(str(tmp_path), "Nome")["ok"]
    assert not host.rename_session(host._get_session_root(), "Nome")["ok"]
    assert not host.rename_session(str(session / "missing"), "Nome")["ok"]
    data["stage"] = "phase2"
    metadata = session / "session.json"
    metadata.write_text(json.dumps(data), encoding="utf-8")
    original = metadata.read_bytes()
    assert not host.rename_session(str(session), "Nome")["ok"]
    assert metadata.read_bytes() == original


def test_rename_reports_failed_write_and_preserves_previous_name(archived_session):
    host, session, _html, _data = archived_session
    metadata = session / "session.json"
    original = metadata.read_bytes()
    with patch(
        "el_sbobinator.bridge.controllers.session_controller._atomic_write_json",
        side_effect=OSError("Disco pieno"),
    ):
        result = host.rename_session(str(session), "Nuovo nome")
    assert not result["ok"]
    assert "Disco pieno" in result["error"]
    assert metadata.read_bytes() == original


def test_custom_title_survives_audio_relink_and_removal(archived_session):
    host, session, html, data = archived_session
    # Even a deliberate title equal to the source filename is authoritative.
    assert host.rename_session(str(session), "audio.mp3")["ok"]
    prepared = session / "audio" / "playback.mp3"
    prepared.parent.mkdir()
    prepared.write_bytes(b"retained audio")
    with patch(
        "el_sbobinator.bridge.controllers.session_controller.create_playback_audio",
        return_value=str(prepared),
    ):
        assert host.update_session_input_path(str(session), data["input"]["path"])["ok"]
    assert (
        json.loads((session / "session.json").read_text(encoding="utf-8"))["title"]
        == "audio.mp3"
    )
    result = host.remove_session_audio(str(session))
    assert result["ok"] and result["name"] == "audio.mp3"
    assert host.get_completed_sessions()["sessions"][0]["name"] == "audio.mp3"
    assert html.exists()


def test_renamed_package_round_trip_preserves_display_name_and_document_body(
    archived_session, tmp_path
):
    host, session, html, _data = archived_session
    title = "Microbiologia: batteri / lezione 2.1"
    assert host.rename_session(str(session), title)["ok"]
    package = tmp_path / "export.sbobina"
    assert create_sbobina_package(str(session), str(package), include_mode="text_only")[
        "ok"
    ]
    result = unpack_and_import_package(str(package), str(tmp_path / "imported"))
    assert result["ok"] and result["name"] == title
    saved = json.loads(
        (Path(result["session_dir"]) / "session.json").read_text(encoding="utf-8")
    )
    assert saved["title"] == title and saved["title_is_custom"]
    assert "<h1>Titolo modificato a mano</h1>" in Path(result["html_path"]).read_text(
        encoding="utf-8"
    )
    assert "<h1>Titolo modificato a mano</h1>" in html.read_text(encoding="utf-8")
    window = MagicMock()
    window.create_file_dialog.return_value = None
    DummyExportHost(window=window).export_sbobina_package(str(session))
    assert (
        window.create_file_dialog.call_args.kwargs["save_filename"]
        == "Microbiologia_ batteri _ lezione 2.1_Sbobina.sbobina"
    )
