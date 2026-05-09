import json
import os
import re
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import MagicMock, mock_open, patch

from el_sbobinator.app_webview import ElSbobinatorApi, PipelineAdapter


class _SyncThread:
    """threading.Thread replacement that runs target() synchronously on start()."""

    def __init__(self, target=None, args=(), daemon=False, **kw):
        self._target = target
        self._args = args

    def start(self):
        if self._target:
            self._target(*self._args)

    def join(self, timeout=None):
        pass


class _FakeWindow:
    def __init__(self):
        self.calls: list[str] = []
        self.dialog_result: str | None = None

    def evaluate_js(self, script):
        self.calls.append(script)

    def create_file_dialog(self, *_args, **_kwargs):
        return self.dialog_result


class AppWebviewTests(unittest.TestCase):
    def test_dispatcher_batches_js_calls(self):
        window = _FakeWindow()
        adapter = PipelineAdapter(window, cancel_event=__import__("threading").Event())  # type: ignore[arg-type]

        adapter.aggiorna_progresso(0.5)
        adapter.aggiorna_fase("fase 1")
        adapter.emit("fileDone", {"id": "abc"}, batched=False)
        adapter._dispatcher.flush()

        joined = "\n".join(window.calls)
        self.assertIn("updateProgress", joined)
        self.assertIn("updatePhase", joined)
        self.assertIn("fileDone", joined)

    def test_update_model_first_call_sets_primary_model(self):
        adapter = PipelineAdapter(None, cancel_event=__import__("threading").Event())
        adapter.update_model("gemini-2.5-flash")
        self.assertEqual(adapter.last_primary_model, "gemini-2.5-flash")
        self.assertEqual(adapter.last_effective_model, "gemini-2.5-flash")

    def test_update_model_subsequent_call_does_not_change_primary_model(self):
        adapter = PipelineAdapter(None, cancel_event=__import__("threading").Event())
        adapter.update_model("gemini-2.5-flash")
        adapter.update_model("gemini-2.5-flash-lite")
        self.assertEqual(adapter.last_primary_model, "gemini-2.5-flash")
        self.assertEqual(adapter.last_effective_model, "gemini-2.5-flash-lite")

    def test_reset_run_state_clears_primary_model(self):
        adapter = PipelineAdapter(None, cancel_event=__import__("threading").Event())
        adapter.update_model("gemini-2.5-flash")
        adapter.update_model("gemini-2.5-flash-lite")
        adapter.reset_run_state()
        self.assertIsNone(adapter.last_primary_model)
        self.assertIsNone(adapter.last_effective_model)

    def test_primary_model_reset_allows_new_run_to_capture_new_primary(self):
        adapter = PipelineAdapter(None, cancel_event=__import__("threading").Event())
        adapter.update_model("gemini-2.5-flash")
        adapter.update_model("gemini-2.5-flash-lite")
        adapter.reset_run_state()
        adapter.update_model("gemini-3-flash-preview")
        self.assertEqual(adapter.last_primary_model, "gemini-3-flash-preview")
        self.assertEqual(adapter.last_effective_model, "gemini-3-flash-preview")

    def test_save_html_content_preserves_head(self):
        import tempfile as _tempfile

        api = ElSbobinatorApi()
        with _tempfile.NamedTemporaryFile(
            "w+", suffix=".html", delete=False, encoding="utf-8"
        ) as tmp:
            tmp.write(
                "<!DOCTYPE html><html><head><meta charset='utf-8'><style>body{color:red}</style></head>"
                "<body><p>Old</p></body></html>"
            )
            path = tmp.name

        with patch(
            "el_sbobinator.app_webview.get_desktop_dir",
            return_value=_tempfile.gettempdir(),
        ):
            result = api.save_html_content(path, "<p>New</p>")
        self.assertTrue(result["ok"])

        with open(path, encoding="utf-8") as fh:
            saved = fh.read()

        self.assertIn("<style>body{color:red}</style>", saved)
        self.assertIn("<body>\n<p>New</p>\n</body>", saved)

    def test_open_url_rejects_non_allowlisted_url(self):
        api = ElSbobinatorApi()
        result = api.open_url("https://evil.example.com/payload")
        self.assertFalse(result["ok"])

    def test_open_url_rejects_filesystem_path(self):
        api = ElSbobinatorApi()
        result = api.open_url("C:\\Windows\\System32\\cmd.exe")
        self.assertFalse(result["ok"])

    @patch("el_sbobinator.app_webview.open_path_with_default_app")
    def test_open_url_accepts_allowed_github_url(self, mock_open):
        api = ElSbobinatorApi()
        result = api.open_url("https://github.com/vimuw/El-Sbobinator/releases/latest")
        self.assertTrue(result["ok"])
        mock_open.assert_called_once()

    def test_save_html_content_rejects_non_html_path(self):
        api = ElSbobinatorApi()
        result = api.save_html_content("/etc/passwd", "<p>hack</p>")
        self.assertFalse(result["ok"])

    def test_save_html_content_rejects_missing_file(self):
        api = ElSbobinatorApi()
        result = api.save_html_content("/tmp/nonexistent_file_xyz.html", "<p>x</p>")
        self.assertFalse(result["ok"])

    def test_ask_media_file_accepts_string_dialog_result(self):
        api = ElSbobinatorApi()
        window = _FakeWindow()
        with tempfile.NamedTemporaryFile("wb", suffix=".mp3", delete=False) as tmp:
            window.dialog_result = tmp.name
        api.set_window(window)  # type: ignore[arg-type]

        result = api.ask_media_file()

        self.assertIsNotNone(result)
        assert result is not None
        self.assertEqual(result["path"], window.dialog_result)
        self.assertEqual(
            result["name"], __import__("os").path.basename(window.dialog_result)
        )

    def test_ask_files_accepts_string_dialog_result(self):
        api = ElSbobinatorApi()
        window = _FakeWindow()
        with tempfile.NamedTemporaryFile("wb", suffix=".mp3", delete=False) as tmp:
            window.dialog_result = tmp.name
        api.set_window(window)  # type: ignore[arg-type]

        result = api.ask_files()

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["path"], window.dialog_result)
        self.assertEqual(
            result[0]["name"], __import__("os").path.basename(window.dialog_result)
        )

    @patch("el_sbobinator.services.validation_service.validate_environment")
    def test_validate_environment_returns_backend_result(self, mock_validate):
        api = ElSbobinatorApi()
        mock_validate.return_value = {
            "ok": True,
            "summary": "Ambiente pronto.",
            "checks": [
                {"id": "ffmpeg", "label": "FFmpeg", "status": "ok", "message": "ok"}
            ],
        }

        result = api.validate_environment(api_key="fake", check_api_key=True)

        self.assertTrue(result["ok"])
        self.assertEqual(result["result"]["summary"], "Ambiente pronto.")
        mock_validate.assert_called_once_with(
            api_key="fake",
            validate_api_key=True,
            preferred_model=None,
            fallback_models=None,
        )

    @patch("el_sbobinator.app_webview.cleanup_orphan_sessions")
    def test_cleanup_old_sessions_uses_14_day_default(self, mock_cleanup):
        api = ElSbobinatorApi()
        mock_cleanup.return_value = {"removed": 2, "freed_bytes": 4096, "errors": 0}

        result = api.cleanup_old_sessions()

        self.assertTrue(result["ok"])
        self.assertEqual(result["removed"], 2)
        mock_cleanup.assert_called_once_with(14)

    def test_stop_processing_unblocks_pending_prompts(self):
        api = ElSbobinatorApi()
        regenerate_event = threading.Event()
        new_key_event = threading.Event()
        received = {}

        def on_regenerate(payload):
            received["regenerate"] = payload
            regenerate_event.set()

        def on_new_key(payload):
            received["new_key"] = payload
            new_key_event.set()

        api._adapter.ask_regenerate("lesson.mp3", on_regenerate, "resume")
        api._adapter.ask_new_api_key(on_new_key)

        result = api.stop_processing()

        self.assertTrue(result["ok"])
        self.assertTrue(api._cancel_event.is_set())
        self.assertTrue(regenerate_event.wait(timeout=1))
        self.assertTrue(new_key_event.wait(timeout=1))
        self.assertEqual(received["regenerate"], {"regenerate": False})
        self.assertEqual(received["new_key"], {"key": ""})

    def test_answer_regenerate_none_cancels_processing_and_preserves_null(self):
        api = ElSbobinatorApi()
        regenerate_event = threading.Event()
        received = {}

        def on_regenerate(payload):
            received["regenerate"] = payload
            regenerate_event.set()

        api._adapter.ask_regenerate("lesson.mp3", on_regenerate, "resume")

        result = api.answer_regenerate(None)

        self.assertTrue(result["ok"])
        self.assertTrue(api._cancel_event.is_set())
        self.assertTrue(regenerate_event.wait(timeout=1))
        self.assertEqual(received["regenerate"], {"regenerate": None})

    @patch("el_sbobinator.pipeline.pipeline.esegui_sbobinatura")
    def test_process_done_marks_cancelled_when_run_status_is_cancelled(
        self, mock_pipeline_run
    ):
        api = ElSbobinatorApi()
        emitted = []

        def fake_emit(fn_name, data, batched=None):
            emitted.append((fn_name, data, batched))

        def fake_pipeline_run(_path, _api_key, adapter, resume_session=True):
            self.assertTrue(resume_session)
            adapter.set_run_result("cancelled", "Prompt di ripresa chiuso.")

        mock_pipeline_run.side_effect = fake_pipeline_run
        api._adapter.emit = fake_emit

        with tempfile.NamedTemporaryFile("wb", suffix=".mp3", delete=False) as tmp:
            tmp.write(b"fake")
            file_path = tmp.name

        try:
            result = api.start_processing(
                [
                    {
                        "id": "file-1",
                        "path": file_path,
                        "name": "lesson.mp3",
                        "size": 4,
                        "duration": 1,
                    }
                ],
                api_key="fake-key",
                resume_session=True,
            )

            self.assertTrue(result["ok"])
            self.assertIsNotNone(api._processing_thread)
            assert api._processing_thread is not None
            api._processing_thread.join(timeout=2)
            self.assertFalse(
                api._processing_thread.is_alive(),
                "Il thread di processing non si e' fermato.",
            )
        finally:
            try:
                __import__("os").unlink(file_path)
            except OSError:
                pass

        process_done_events = [
            data for fn_name, data, _batched in emitted if fn_name == "processDone"
        ]
        self.assertEqual(len(process_done_events), 1)
        self.assertTrue(process_done_events[0]["cancelled"])
        self.assertEqual(process_done_events[0]["completed"], 0)
        self.assertEqual(process_done_events[0]["failed"], 0)
        self.assertEqual(process_done_events[0]["total"], 1)

    @patch("el_sbobinator.pipeline.pipeline.esegui_sbobinatura")
    def test_start_processing_honors_file_level_resume_override(
        self, mock_pipeline_run
    ):
        api = ElSbobinatorApi()
        observed_resume_values = []

        def fake_pipeline_run(_path, _api_key, adapter, resume_session=True):
            observed_resume_values.append(resume_session)
            adapter.set_run_result("completed", "")
            adapter.last_output_html = _path + ".html"
            adapter.last_output_dir = __import__("os").path.dirname(_path)

        mock_pipeline_run.side_effect = fake_pipeline_run

        with tempfile.NamedTemporaryFile("wb", suffix=".mp3", delete=False) as tmp:
            tmp.write(b"fake")
            file_path = tmp.name

        try:
            result = api.start_processing(
                [
                    {
                        "id": "file-1",
                        "path": file_path,
                        "name": "lesson.mp3",
                        "size": 4,
                        "duration": 1,
                        "resume_session": False,
                    }
                ],
                api_key="fake-key",
                resume_session=True,
            )

            self.assertTrue(result["ok"])
            self.assertIsNotNone(api._processing_thread)
            assert api._processing_thread is not None
            api._processing_thread.join(timeout=2)
            self.assertFalse(api._processing_thread.is_alive())
        finally:
            try:
                __import__("os").unlink(file_path)
            except OSError:
                pass

        self.assertEqual(observed_resume_values, [False])

    def test_read_html_content_falls_back_to_session_dir(self):
        import os

        api = ElSbobinatorApi()
        with (
            tempfile.TemporaryDirectory() as desktop_dir,
            tempfile.TemporaryDirectory() as session_root,
        ):
            session_dir = os.path.join(session_root, "abc123")
            os.makedirs(session_dir)
            html_name = "Lesson_Sbobina.html"
            session_html = os.path.join(session_dir, html_name)
            with open(session_html, "w", encoding="utf-8") as fh:
                fh.write(
                    "<!DOCTYPE html><html><head></head><body><p>ok</p></body></html>"
                )

            desktop_html = os.path.join(desktop_dir, html_name)

            with (
                patch(
                    "el_sbobinator.app_webview.get_desktop_dir",
                    return_value=desktop_dir,
                ),
                patch.object(api, "_get_session_root", return_value=session_root),
            ):
                result = api.read_html_content(desktop_html)

        self.assertTrue(result["ok"], result.get("error"))
        self.assertIn("<p>ok</p>", result["content"])

    def test_save_html_content_falls_back_to_session_dir(self):
        import os

        api = ElSbobinatorApi()
        with (
            tempfile.TemporaryDirectory() as desktop_dir,
            tempfile.TemporaryDirectory() as session_root,
        ):
            session_dir = os.path.join(session_root, "abc123")
            os.makedirs(session_dir)
            html_name = "Lesson_Sbobina.html"
            session_html = os.path.join(session_dir, html_name)
            with open(session_html, "w", encoding="utf-8") as fh:
                fh.write(
                    "<!DOCTYPE html><html><head><style>body{}</style></head>"
                    "<body><p>Old</p></body></html>"
                )

            desktop_html = os.path.join(desktop_dir, html_name)

            with (
                patch(
                    "el_sbobinator.app_webview.get_desktop_dir",
                    return_value=desktop_dir,
                ),
                patch.object(api, "_get_session_root", return_value=session_root),
            ):
                result = api.save_html_content(desktop_html, "<p>New</p>")

            self.assertTrue(result["ok"], result.get("error"))
            with open(session_html, encoding="utf-8") as fh:
                saved = fh.read()
            self.assertIn("<p>New</p>", saved)

    def test_read_html_content_rebuilds_from_session_when_file_missing_everywhere(self):
        import json
        import os

        api = ElSbobinatorApi()
        with (
            tempfile.TemporaryDirectory() as desktop_dir,
            tempfile.TemporaryDirectory() as session_root,
            tempfile.TemporaryDirectory() as audio_dir,
        ):
            session_dir = os.path.join(session_root, "abc123")
            phase2_revised_dir = os.path.join(session_dir, "phase2_revised")
            os.makedirs(phase2_revised_dir)

            with open(
                os.path.join(phase2_revised_dir, "rev_000.md"), "w", encoding="utf-8"
            ) as fh:
                fh.write("## Contenuto della sbobina")

            audio_path = os.path.join(audio_dir, "Lesson.mp3")
            with open(audio_path, "wb") as fh:
                fh.write(b"fake")

            html_name = "Lesson_Sbobina.html"
            session_json = {
                "schema_version": 1,
                "stage": "done",
                "input": {"path": audio_path},
                "outputs": {"html": os.path.join(desktop_dir, html_name)},
                "settings": {},
                "phase1": {},
                "phase2": {},
                "last_error": None,
            }
            session_path = os.path.join(session_dir, "session.json")
            with open(session_path, "w", encoding="utf-8") as fh:
                json.dump(session_json, fh)

            desktop_html = os.path.join(desktop_dir, html_name)

            with (
                patch(
                    "el_sbobinator.app_webview.get_desktop_dir",
                    return_value=desktop_dir,
                ),
                patch.object(api, "_get_session_root", return_value=session_root),
            ):
                result = api.read_html_content(desktop_html)

            self.assertTrue(result["ok"], result.get("error"))
            self.assertIn("Contenuto della sbobina", result["content"])

            rebuilt_path = os.path.join(session_dir, html_name)
            self.assertTrue(
                os.path.isfile(rebuilt_path),
                "HTML deve essere scritto nella session dir",
            )

            with open(session_path, encoding="utf-8") as fh:
                updated = json.load(fh)
            self.assertEqual(
                os.path.basename(updated["outputs"]["html"]),
                html_name,
                "session.json deve essere aggiornato con il nuovo path",
            )

    def test_rebuild_html_uses_html_basename_when_input_path_renamed(self):
        """If input_path in session.json produces a different basename than the
        recorded outputs.html, the rebuilt file must still use html_basename."""
        import json
        import os

        api = ElSbobinatorApi()
        with (
            tempfile.TemporaryDirectory() as desktop_dir,
            tempfile.TemporaryDirectory() as session_root,
            tempfile.TemporaryDirectory() as audio_dir,
        ):
            session_dir = os.path.join(session_root, "abc123")
            phase2_revised_dir = os.path.join(session_dir, "phase2_revised")
            os.makedirs(phase2_revised_dir)

            with open(
                os.path.join(phase2_revised_dir, "rev_000.md"), "w", encoding="utf-8"
            ) as fh:
                fh.write("## Contenuto renamed")

            # input_path now points to a file with a *different* stem than html_basename
            renamed_audio = os.path.join(audio_dir, "RenamedLesson.mp3")
            with open(renamed_audio, "wb") as fh:
                fh.write(b"fake")

            original_html_name = "OriginalLesson_Sbobina.html"
            session_json = {
                "schema_version": 1,
                "stage": "done",
                "input": {"path": renamed_audio},
                "outputs": {"html": os.path.join(desktop_dir, original_html_name)},
                "settings": {},
                "phase1": {},
                "phase2": {},
                "last_error": None,
            }
            session_path = os.path.join(session_dir, "session.json")
            with open(session_path, "w", encoding="utf-8") as fh:
                json.dump(session_json, fh)

            desktop_html = os.path.join(desktop_dir, original_html_name)

            with (
                patch(
                    "el_sbobinator.app_webview.get_desktop_dir",
                    return_value=desktop_dir,
                ),
                patch.object(api, "_get_session_root", return_value=session_root),
            ):
                result = api.read_html_content(desktop_html)

            self.assertTrue(result["ok"], result.get("error"))
            self.assertIn("Contenuto renamed", result["content"])

            # The file in session_dir must use the ORIGINAL html basename, not
            # "RenamedLesson_Sbobina.html" (which export would derive from input_path)
            rebuilt_path = os.path.join(session_dir, original_html_name)
            self.assertTrue(
                os.path.isfile(rebuilt_path),
                "Rebuilt HTML must use html_basename, not the name derived from input_path",
            )
            wrong_path = os.path.join(session_dir, "RenamedLesson_Sbobina.html")
            self.assertFalse(
                os.path.isfile(wrong_path),
                "A file with the input_path-derived basename must not exist",
            )

            with open(session_path, encoding="utf-8") as fh:
                updated = json.load(fh)
            self.assertEqual(
                os.path.basename(updated["outputs"]["html"]),
                original_html_name,
                "session.json must record the canonical html_basename",
            )

    def test_rebuild_html_from_session_picks_newest_session(self):
        """Two sessions share the same html basename; the newer one must be rebuilt."""
        import json
        import os
        import time

        api = ElSbobinatorApi()
        with (
            tempfile.TemporaryDirectory() as desktop_dir,
            tempfile.TemporaryDirectory() as session_root,
            tempfile.TemporaryDirectory() as audio_dir,
        ):
            html_name = "Lecture_Sbobina.html"
            audio_path = os.path.join(audio_dir, "Lecture.mp3")
            with open(audio_path, "wb") as fh:
                fh.write(b"fake")

            def _make_session(name, content, mtime_offset):
                sdir = os.path.join(session_root, name)
                p2dir = os.path.join(sdir, "phase2_revised")
                os.makedirs(p2dir)
                with open(
                    os.path.join(p2dir, "rev_000.md"), "w", encoding="utf-8"
                ) as fh:
                    fh.write(content)
                sdata = {
                    "schema_version": 1,
                    "stage": "done",
                    "input": {"path": audio_path},
                    "outputs": {"html": os.path.join(desktop_dir, html_name)},
                    "settings": {},
                    "phase1": {},
                    "phase2": {},
                    "last_error": None,
                }
                spath = os.path.join(sdir, "session.json")
                with open(spath, "w", encoding="utf-8") as fh:
                    json.dump(sdata, fh)
                t = time.time() + mtime_offset
                os.utime(spath, (t, t))
                return sdir

            _make_session("old_session", "## Vecchia sbobina", -3600)
            _make_session("new_session", "## Nuova sbobina", 0)

            with (
                patch(
                    "el_sbobinator.app_webview.get_desktop_dir",
                    return_value=desktop_dir,
                ),
                patch.object(api, "_get_session_root", return_value=session_root),
            ):
                result = api.read_html_content(os.path.join(desktop_dir, html_name))

            self.assertTrue(result["ok"], result.get("error"))
            self.assertIn("Nuova sbobina", result["content"])
            self.assertNotIn("Vecchia sbobina", result["content"])

    def test_rebuild_html_from_session_skips_incomplete_session(self):
        """Regression: a session whose stage != 'done' must not be used as a
        rebuild candidate even if phase2_revised/ and session.json exist."""
        import json
        import os

        api = ElSbobinatorApi()
        with (
            tempfile.TemporaryDirectory() as desktop_dir,
            tempfile.TemporaryDirectory() as session_root,
            tempfile.TemporaryDirectory() as audio_dir,
        ):
            html_name = "Lecture_Incomplete.html"
            audio_path = os.path.join(audio_dir, "Lecture.mp3")
            with open(audio_path, "wb") as fh:
                fh.write(b"fake")

            sdir = os.path.join(session_root, "incomplete_session")
            p2dir = os.path.join(sdir, "phase2_revised")
            os.makedirs(p2dir)
            with open(os.path.join(p2dir, "rev_000.md"), "w", encoding="utf-8") as fh:
                fh.write("## Partial content")
            sdata = {
                "schema_version": 1,
                "stage": "phase2",
                "input": {"path": audio_path},
                "outputs": {"html": os.path.join(desktop_dir, html_name)},
                "settings": {},
                "phase1": {},
                "phase2": {},
                "last_error": None,
            }
            with open(os.path.join(sdir, "session.json"), "w", encoding="utf-8") as fh:
                json.dump(sdata, fh)

            with (
                patch(
                    "el_sbobinator.app_webview.get_desktop_dir",
                    return_value=desktop_dir,
                ),
                patch.object(api, "_get_session_root", return_value=session_root),
            ):
                result = api.read_html_content(os.path.join(desktop_dir, html_name))

            self.assertFalse(result["ok"])

    def test_html_shell_cache_hit_after_desktop_file_deleted(self):
        """Bug 4 regression: shell cached under Desktop path must be reused when
        save_html_content falls back to the session-dir copy after the Desktop
        file is deleted while the preview modal was open."""
        import os
        from unittest.mock import patch as _patch

        api = ElSbobinatorApi()
        html_name = "Lesson_Cache.html"
        full_html = (
            "<!DOCTYPE html><html>"
            "<head><style>body{color:red}</style></head>"
            "<body><p>Original</p></body>"
            "</html>"
        )

        with (
            tempfile.TemporaryDirectory() as desktop_dir,
            tempfile.TemporaryDirectory() as session_root,
        ):
            session_dir = os.path.join(session_root, "sess1")
            os.makedirs(session_dir)
            session_html = os.path.join(session_dir, html_name)
            desktop_html = os.path.join(desktop_dir, html_name)

            with open(desktop_html, "w", encoding="utf-8") as fh:
                fh.write(full_html)
            with open(session_html, "w", encoding="utf-8") as fh:
                fh.write(full_html)

            with (
                _patch(
                    "el_sbobinator.app_webview.get_desktop_dir",
                    return_value=desktop_dir,
                ),
                _patch.object(api, "_get_session_root", return_value=session_root),
            ):
                read_result = api.read_html_content(desktop_html)
                self.assertTrue(read_result["ok"])

                os.remove(desktop_html)

                with _patch(
                    "el_sbobinator.app_webview.save_html_body_content",
                    wraps=__import__(
                        "el_sbobinator.utils.file_ops",
                        fromlist=["save_html_body_content"],
                    ).save_html_body_content,
                ) as mock_save:
                    result = api.save_html_content(desktop_html, "<p>New</p>")

                self.assertTrue(result["ok"], result.get("error"))
                self.assertIsNotNone(
                    mock_save.call_args, "save_html_body_content must have been called"
                )
                shell_arg = mock_save.call_args.kwargs.get("shell")
                self.assertIsNotNone(
                    shell_arg,
                    "shell must be passed from cache — no extra disk read expected",
                )

            with open(session_html, encoding="utf-8") as fh:
                saved = fh.read()
            self.assertIn("<p>New</p>", saved)
            self.assertIn("<style>body{color:red}</style>", saved)

    def test_save_uses_same_session_dir_as_read_when_background_write_changes_mtime(
        self,
    ):
        """Bug 2 regression: _resolved_path_cache must pin the session dir chosen by
        read_html_content so that a background mtime change cannot redirect
        save_html_content to a different session dir."""
        import os
        import time
        from unittest.mock import patch as _patch

        api = ElSbobinatorApi()
        html_name = "Lecture_Sbobina.html"
        full_html = (
            "<!DOCTYPE html><html>"
            "<head><style>body{color:green}</style></head>"
            "<body><p>Original</p></body>"
            "</html>"
        )

        with (
            tempfile.TemporaryDirectory() as desktop_dir,
            tempfile.TemporaryDirectory() as session_root,
        ):
            sess_a = os.path.join(session_root, "sess_a")
            sess_b = os.path.join(session_root, "sess_b")
            os.makedirs(sess_a)
            os.makedirs(sess_b)

            path_a = os.path.join(sess_a, html_name)
            path_b = os.path.join(sess_b, html_name)
            desktop_html = os.path.join(desktop_dir, html_name)

            with open(path_a, "w", encoding="utf-8") as fh:
                fh.write(full_html.replace("Original", "A"))
            with open(path_b, "w", encoding="utf-8") as fh:
                fh.write(full_html.replace("Original", "B"))

            now = time.time()
            os.utime(path_a, (now - 10, now - 10))
            os.utime(path_b, (now, now))

            with (
                _patch(
                    "el_sbobinator.app_webview.get_desktop_dir",
                    return_value=desktop_dir,
                ),
                _patch.object(api, "_get_session_root", return_value=session_root),
            ):
                read_result = api.read_html_content(desktop_html)
                self.assertTrue(read_result["ok"])
                self.assertIn(
                    "<p>B</p>",
                    read_result["content"],
                    "read must pick sess_b (higher mtime)",
                )

                os.utime(path_a, (now + 20, now + 20))

                result = api.save_html_content(desktop_html, "<p>Edited</p>")

            self.assertTrue(result["ok"], result.get("error"))

            with open(path_b, encoding="utf-8") as fh:
                saved_b = fh.read()
            with open(path_a, encoding="utf-8") as fh:
                saved_a = fh.read()

            self.assertIn(
                "<p>Edited</p>", saved_b, "save must write to sess_b (pinned by cache)"
            )
            self.assertNotIn(
                "<p>Edited</p>",
                saved_a,
                "sess_a must not be touched despite higher mtime now",
            )

    def test_read_html_content_pins_cache_when_file_exists(self):
        """Bug 1 regression: _resolved_path_cache must be populated even when the
        original file exists at read time, so a transient unavailability at save
        time does not cause a mtime-based session-dir mismatch."""
        import os
        from unittest.mock import patch as _patch

        api = ElSbobinatorApi()
        html_name = "Lecture_Sbobina.html"
        full_html = (
            "<!DOCTYPE html><html>"
            "<head><style>body{color:red}</style></head>"
            "<body><p>Original</p></body>"
            "</html>"
        )

        with (
            tempfile.TemporaryDirectory() as desktop_dir,
            tempfile.TemporaryDirectory() as session_root,
        ):
            desktop_html = os.path.join(desktop_dir, html_name)
            with open(desktop_html, "w", encoding="utf-8") as fh:
                fh.write(full_html)

            with (
                _patch(
                    "el_sbobinator.app_webview.get_desktop_dir",
                    return_value=desktop_dir,
                ),
                _patch.object(api, "_get_session_root", return_value=session_root),
            ):
                result = api.read_html_content(desktop_html)
                self.assertTrue(result["ok"])

            real_path = os.path.realpath(os.path.abspath(desktop_html))
            self.assertIn(
                real_path,
                api._resolved_path_cache,
                "_resolved_path_cache must be populated even when file exists at read time",
            )
            self.assertEqual(api._resolved_path_cache[real_path], real_path)

    def test_html_shell_cache_no_poisoning_on_same_basename(self):
        """Bug 2 regression: two files with the same basename in different session
        dirs must not overwrite each other's cache entry.  File A's save must
        receive shell_A even after file B (same basename, different path) was
        read afterwards."""
        import os
        from unittest.mock import patch as _patch

        api = ElSbobinatorApi()
        html_name = "lecture.html"
        shell_a = "<head><style>body{color:red}</style></head>"
        shell_b = "<head><style>body{color:blue}</style></head>"
        html_a = f"<!DOCTYPE html><html>{shell_a}<body><p>A</p></body></html>"
        html_b = f"<!DOCTYPE html><html>{shell_b}<body><p>B</p></body></html>"

        with (
            tempfile.TemporaryDirectory() as desktop_dir,
            tempfile.TemporaryDirectory() as session_root,
        ):
            sess_a = os.path.join(session_root, "sessA")
            sess_b = os.path.join(session_root, "sessB")
            os.makedirs(sess_a)
            os.makedirs(sess_b)
            path_a = os.path.join(sess_a, html_name)
            path_b = os.path.join(sess_b, html_name)

            with open(path_a, "w", encoding="utf-8") as fh:
                fh.write(html_a)
            with open(path_b, "w", encoding="utf-8") as fh:
                fh.write(html_b)

            with (
                _patch(
                    "el_sbobinator.app_webview.get_desktop_dir",
                    return_value=desktop_dir,
                ),
                _patch.object(api, "_get_session_root", return_value=session_root),
            ):
                self.assertTrue(api.read_html_content(path_a)["ok"])
                self.assertTrue(api.read_html_content(path_b)["ok"])

                with _patch(
                    "el_sbobinator.app_webview.save_html_body_content",
                    wraps=__import__(
                        "el_sbobinator.utils.file_ops",
                        fromlist=["save_html_body_content"],
                    ).save_html_body_content,
                ) as mock_save:
                    result = api.save_html_content(path_a, "<p>New A</p>")

            self.assertTrue(result["ok"], result.get("error"))
            shell_arg = mock_save.call_args.kwargs.get("shell")
            self.assertIsNotNone(shell_arg, "shell must be passed from cache")
            self.assertIn(
                "color:red", "".join(shell_arg), "must use shell_A, not shell_B"
            )
            self.assertNotIn("color:blue", "".join(shell_arg))


class TestFallbackAllowedRootsRecheck(unittest.TestCase):
    """Regression tests: fallback path returned by _find_html_in_session_dirs must be
    re-checked against allowed_roots before use (symlink-escape security gap)."""

    def _make_api_with_roots(self, tmp, desktop_dir, session_root):
        from el_sbobinator.app_webview import ElSbobinatorApi

        api = ElSbobinatorApi()
        return api, desktop_dir, session_root

    def test_read_html_content_rejects_fallback_outside_allowed_roots(self):
        import os
        import tempfile
        from unittest.mock import patch

        from el_sbobinator.app_webview import ElSbobinatorApi

        with tempfile.TemporaryDirectory() as tmp:
            desktop_dir = os.path.join(tmp, "desktop")
            session_root = os.path.join(tmp, "sessions")
            outside_dir = os.path.join(tmp, "outside")
            os.makedirs(desktop_dir)
            os.makedirs(session_root)
            os.makedirs(outside_dir)

            outside_html = os.path.join(outside_dir, "note.html")
            with open(outside_html, "w", encoding="utf-8") as fh:
                fh.write("<html><body><p>secret</p></body></html>")

            desktop_html = os.path.join(desktop_dir, "note.html")
            api = ElSbobinatorApi()

            with (
                patch(
                    "el_sbobinator.app_webview.get_desktop_dir",
                    return_value=desktop_dir,
                ),
                patch.object(api, "_get_session_root", return_value=session_root),
                patch.object(
                    api,
                    "_find_html_in_session_dirs",
                    return_value=os.path.realpath(outside_html),
                ),
                patch.object(api, "_rebuild_html_from_session", return_value=None),
            ):
                result = api.read_html_content(desktop_html)

        self.assertFalse(result["ok"])
        self.assertIn("Accesso negato", result["error"])

    def test_save_html_content_rejects_fallback_outside_allowed_roots(self):
        import os
        import tempfile
        from unittest.mock import patch

        from el_sbobinator.app_webview import ElSbobinatorApi

        with tempfile.TemporaryDirectory() as tmp:
            desktop_dir = os.path.join(tmp, "desktop")
            session_root = os.path.join(tmp, "sessions")
            outside_dir = os.path.join(tmp, "outside")
            os.makedirs(desktop_dir)
            os.makedirs(session_root)
            os.makedirs(outside_dir)

            outside_html = os.path.join(outside_dir, "note.html")
            with open(outside_html, "w", encoding="utf-8") as fh:
                fh.write("<html><body><p>original</p></body></html>")

            desktop_html = os.path.join(desktop_dir, "note.html")
            api = ElSbobinatorApi()

            with (
                patch(
                    "el_sbobinator.app_webview.get_desktop_dir",
                    return_value=desktop_dir,
                ),
                patch.object(api, "_get_session_root", return_value=session_root),
                patch.object(
                    api,
                    "_find_html_in_session_dirs",
                    return_value=os.path.realpath(outside_html),
                ),
                patch.object(api, "_rebuild_html_from_session", return_value=None),
            ):
                result = api.save_html_content(desktop_html, "<p>pwned</p>")

            self.assertFalse(result["ok"])
            self.assertIn("Accesso negato", result["error"])
            with open(outside_html, encoding="utf-8") as fh:
                self.assertNotIn(
                    "pwned", fh.read(), "file outside allowed roots must not be written"
                )

    def test_delete_session_removes_folder_when_inside_session_root(self):
        import os

        api = ElSbobinatorApi()
        with tempfile.TemporaryDirectory() as session_root:
            session_dir = os.path.join(session_root, "abc123")
            os.makedirs(session_dir)
            sentinel = os.path.join(session_dir, "session.json")
            with open(sentinel, "w", encoding="utf-8") as fh:
                fh.write("{}")

            with patch.object(api, "_get_session_root", return_value=session_root):
                result = api.delete_session(session_dir)

        self.assertTrue(result["ok"], result.get("error"))
        self.assertFalse(os.path.exists(session_dir))

    def test_delete_session_rejects_path_outside_session_root(self):
        import os

        api = ElSbobinatorApi()
        with (
            tempfile.TemporaryDirectory() as session_root,
            tempfile.TemporaryDirectory() as outside_dir,
        ):
            victim = os.path.join(outside_dir, "important")
            os.makedirs(victim)

            with patch.object(api, "_get_session_root", return_value=session_root):
                result = api.delete_session(victim)

            self.assertFalse(result["ok"])
            self.assertIn("Percorso non valido", result["error"])
            self.assertTrue(os.path.exists(victim))

    def test_delete_session_evicts_resolved_path_cache(self):
        import os

        api = ElSbobinatorApi()
        with tempfile.TemporaryDirectory() as session_root:
            session_dir = os.path.join(session_root, "ses1")
            os.makedirs(session_dir)
            html_path = os.path.join(session_dir, "note.html")
            with open(html_path, "w") as fh:
                fh.write("<html><body></body></html>")

            api._resolved_path_cache["key1"] = html_path
            api._resolved_path_cache["key2"] = session_dir
            api._resolved_path_cache["key3"] = "/unrelated/path"

            with patch.object(api, "_get_session_root", return_value=session_root):
                result = api.delete_session(session_dir)

        self.assertTrue(result["ok"], result.get("error"))
        self.assertNotIn("key1", api._resolved_path_cache)
        self.assertNotIn("key2", api._resolved_path_cache)
        self.assertIn("key3", api._resolved_path_cache)

    def test_download_and_install_update_uses_streaming_urlopen(self):
        import io
        import os
        import sys

        api = ElSbobinatorApi()
        fake_data = b"fake exe payload"

        class _FakeResp:
            def __init__(self):
                self._buf = io.BytesIO(fake_data)

            def read(self, n):
                return self._buf.read(n)

            def __enter__(self):
                return self

            def __exit__(self, *_):
                pass

        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_path = os.path.join(tmpdir, "setup.exe")

            class _FakeTmpFile:
                name = tmp_path

                def __enter__(self):
                    return self

                def __exit__(self, *_):
                    pass

            fake_proc = MagicMock()
            fake_proc.poll.return_value = 1  # exits immediately in _poll_then_destroy

            with (
                patch(
                    "urllib.request.urlopen", return_value=_FakeResp()
                ) as mock_urlopen,
                patch("tempfile.NamedTemporaryFile", return_value=_FakeTmpFile()),
                patch.object(sys, "platform", "win32"),
                patch("el_sbobinator.core.updater._verify_sha256", return_value=None),
                patch(
                    "el_sbobinator.core.updater.subprocess.Popen",
                    return_value=fake_proc,
                ),
                patch(
                    "el_sbobinator.core.updater._Thread",
                    side_effect=_SyncThread,
                ),
                patch("el_sbobinator.core.updater.time.sleep"),
                patch.dict("sys.modules", {"webview": MagicMock(windows=[])}),
            ):
                api.download_and_install_update("v1.2.3")

            mock_urlopen.assert_called_once()
            _call_args = mock_urlopen.call_args
            self.assertEqual(
                _call_args.kwargs.get("timeout") or _call_args.args[1], 120
            )
            with open(tmp_path, "rb") as fh:
                self.assertEqual(fh.read(), fake_data)

    def test_stale_prewarm_blocked_by_gen_counter(self):
        """Regression: gen counter prevents a late get_completed_sessions write from
        overwriting an invalidation (delete_session / pipeline-done) that fired
        while I/O was in progress outside the lock."""
        import threading
        from unittest.mock import patch as _patch

        api = ElSbobinatorApi()
        # The __init__ prewarm thread may populate _sessions_cache before the
        # test's bg thread starts, causing a cache-hit that skips os.scandir.
        # Join it first, then explicitly invalidate the cache inside the patches.
        api._prewarm_thread.join(timeout=3)

        scan_started = threading.Event()
        scan_proceed = threading.Event()

        def fake_scandir(_path):
            scan_started.set()
            scan_proceed.wait(timeout=5)
            return iter([])

        with tempfile.TemporaryDirectory() as td:
            with (
                _patch.object(api, "_get_session_root", return_value=td),
                _patch(
                    "el_sbobinator.app_webview.os.scandir", side_effect=fake_scandir
                ),
            ):
                with api._sessions_cache_lock:
                    api._sessions_cache = None
                    api._sessions_cache_ts = 0.0

                bg = threading.Thread(target=api.get_completed_sessions)
                bg.start()

                self.assertTrue(scan_started.wait(timeout=2), "scandir did not start")

                # Simulate an invalidation while I/O is in progress
                with api._sessions_cache_lock:
                    api._sessions_cache = None
                    api._sessions_cache_gen += 1

                scan_proceed.set()
                bg.join(timeout=2)

        with api._sessions_cache_lock:
            self.assertIsNone(
                api._sessions_cache,
                "Stale prewarm must not overwrite a concurrent invalidation",
            )

    def test_delete_session_increments_cache_gen(self):
        """delete_session must increment _sessions_cache_gen so concurrent prewarms
        can detect the invalidation via the gen-counter guard."""
        import os

        api = ElSbobinatorApi()
        with tempfile.TemporaryDirectory() as session_root:
            session_dir = os.path.join(session_root, "sess_gen")
            os.makedirs(session_dir)
            with open(os.path.join(session_dir, "session.json"), "w") as fh:
                fh.write("{}")

            with api._sessions_cache_lock:
                initial_gen = api._sessions_cache_gen

            with patch.object(api, "_get_session_root", return_value=session_root):
                api.delete_session(session_dir)

        with api._sessions_cache_lock:
            self.assertEqual(api._sessions_cache_gen, initial_gen + 1)
            self.assertIsNone(api._sessions_cache)

    def test_cleanup_registers_atexit_handler_for_temp_exe(self):
        import sys

        from el_sbobinator.core.updater import _try_unlink

        api = ElSbobinatorApi()
        registered: list[tuple] = []

        def _capture(*args: object) -> None:
            registered.append(args)

        class _FakeResp:
            def read(self, n):
                return b""

            def __enter__(self):
                return self

            def __exit__(self, *_):
                pass

        class _FakeTmpFile:
            name = "/tmp/fake_setup.exe"

            def __enter__(self):
                return self

            def __exit__(self, *_):
                pass

        fake_proc = MagicMock()
        fake_proc.poll.return_value = 1  # exits immediately in _poll_then_destroy

        with (
            patch("urllib.request.urlopen", return_value=_FakeResp()),
            patch("tempfile.NamedTemporaryFile", return_value=_FakeTmpFile()),
            patch.object(sys, "platform", "win32"),
            patch("el_sbobinator.core.updater._verify_sha256", return_value=None),
            patch(
                "el_sbobinator.core.updater.subprocess.Popen",
                return_value=fake_proc,
            ),
            patch("el_sbobinator.core.updater.atexit.register", side_effect=_capture),
            patch(
                "el_sbobinator.core.updater._Thread",
                side_effect=_SyncThread,
            ),
            patch("el_sbobinator.core.updater.time.sleep"),
            patch("builtins.open", mock_open()),
            patch.dict("sys.modules", {"webview": MagicMock(windows=[])}),
        ):
            api.download_and_install_update("v1.0.0")

        self.assertEqual(len(registered), 1)
        args = registered[0]
        self.assertIs(args[0], _try_unlink)
        self.assertEqual(args[1], "/tmp/fake_setup.exe")

    def test_try_unlink_silently_ignores_oserror(self):
        from el_sbobinator.core.updater import _try_unlink

        with patch("el_sbobinator.core.updater.os.unlink", side_effect=OSError("gone")):
            _try_unlink("/nonexistent/path")  # must not raise


class SaveThemePreferenceTests(unittest.TestCase):
    """save_theme_preference bridge method."""

    def test_dark_written_to_file(self):
        import os

        api = ElSbobinatorApi()
        with tempfile.TemporaryDirectory() as tmpdir:
            pref_file = os.path.join(tmpdir, "theme_pref.txt")
            with patch("el_sbobinator.app_webview.THEME_PREF_FILE", pref_file):
                api.save_theme_preference("dark")
            with open(pref_file, encoding="utf-8") as fh:
                self.assertEqual(fh.read(), "dark")

    def test_light_written_to_file(self):
        import os

        api = ElSbobinatorApi()
        with tempfile.TemporaryDirectory() as tmpdir:
            pref_file = os.path.join(tmpdir, "theme_pref.txt")
            with patch("el_sbobinator.app_webview.THEME_PREF_FILE", pref_file):
                api.save_theme_preference("light")
            with open(pref_file, encoding="utf-8") as fh:
                self.assertEqual(fh.read(), "light")

    def test_invalid_value_does_not_create_file(self):
        import os

        api = ElSbobinatorApi()
        with tempfile.TemporaryDirectory() as tmpdir:
            pref_file = os.path.join(tmpdir, "theme_pref.txt")
            with patch("el_sbobinator.app_webview.THEME_PREF_FILE", pref_file):
                api.save_theme_preference("system")
            self.assertFalse(os.path.exists(pref_file))

    def test_overwrite_updates_value(self):
        import os

        api = ElSbobinatorApi()
        with tempfile.TemporaryDirectory() as tmpdir:
            pref_file = os.path.join(tmpdir, "theme_pref.txt")
            with patch("el_sbobinator.app_webview.THEME_PREF_FILE", pref_file):
                api.save_theme_preference("dark")
                api.save_theme_preference("light")
            with open(pref_file, encoding="utf-8") as fh:
                self.assertEqual(fh.read(), "light")


class BootBgColorTests(unittest.TestCase):
    """_boot_bg_color resolution order: pref file > OS signal > default."""

    def _call_with_pref(self, pref_path):
        from el_sbobinator.webview_entry import _boot_bg_color

        with patch("el_sbobinator.services.config_service.THEME_PREF_FILE", pref_path):
            return _boot_bg_color()

    def test_pref_file_dark_returns_dark_color(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            import os

            pref_file = os.path.join(tmpdir, "theme_pref.txt")
            with open(pref_file, "w", encoding="utf-8") as fh:
                fh.write("dark")
            self.assertEqual(self._call_with_pref(pref_file), "#0f1115")

    def test_pref_file_light_returns_light_color(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            import os

            pref_file = os.path.join(tmpdir, "theme_pref.txt")
            with open(pref_file, "w", encoding="utf-8") as fh:
                fh.write("light")
            self.assertEqual(self._call_with_pref(pref_file), "#f3f4f6")

    def test_missing_pref_file_falls_back_to_default(self):
        from el_sbobinator.webview_entry import _boot_bg_color

        nonexistent = "/tmp/__no_such_theme_pref_xyz__.txt"
        with (
            patch("el_sbobinator.services.config_service.THEME_PREF_FILE", nonexistent),
            patch("sys.platform", "linux"),
        ):
            result = _boot_bg_color()
        self.assertEqual(result, "#f3f4f6")

    def test_garbage_pref_file_falls_back_to_os_signal(self):
        import subprocess

        with tempfile.TemporaryDirectory() as tmpdir:
            import os

            pref_file = os.path.join(tmpdir, "theme_pref.txt")
            with open(pref_file, "w", encoding="utf-8") as fh:
                fh.write("system")

            fake_result = subprocess.CompletedProcess(
                args=[], returncode=0, stdout="Dark\n", stderr=""
            )
            with (
                patch(
                    "el_sbobinator.services.config_service.THEME_PREF_FILE", pref_file
                ),
                patch("sys.platform", "darwin"),
                patch("subprocess.run", return_value=fake_result),
            ):
                from el_sbobinator.webview_entry import _boot_bg_color

                result = _boot_bg_color()
        self.assertEqual(result, "#0f1115")


class TestReadHtmlContentPathValidation(unittest.TestCase):
    """Path-validation branches in read_html_content that differ from save_html_content."""

    def test_rejects_non_html_extension(self):
        """read_html_content must reject any path whose extension is not .html."""
        api = ElSbobinatorApi()
        for bad_path in ("/some/file.txt", "/tmp/note.pdf", "/etc/passwd"):
            with self.subTest(bad_path=bad_path):
                result = api.read_html_content(bad_path)
                self.assertFalse(result["ok"])
                self.assertIn("html", result["error"].lower())

    def test_rejects_path_outside_allowed_roots(self):
        """An .html path outside both desktop dir and session root must be denied."""
        import os

        api = ElSbobinatorApi()
        with (
            tempfile.TemporaryDirectory() as outside_dir,
            tempfile.TemporaryDirectory() as desktop_dir,
            tempfile.TemporaryDirectory() as session_root,
        ):
            outside_html = os.path.join(outside_dir, "secret.html")
            with open(outside_html, "w", encoding="utf-8") as fh:
                fh.write("<html><body>secret</body></html>")

            with (
                patch(
                    "el_sbobinator.app_webview.get_desktop_dir",
                    return_value=desktop_dir,
                ),
                patch.object(api, "_get_session_root", return_value=session_root),
            ):
                result = api.read_html_content(outside_html)

        self.assertFalse(result["ok"])
        self.assertIn("Accesso negato", result["error"])

    def test_stale_path_outside_root_resolved_via_session_fallback(self):
        """A stale html_path (outside allowed roots, file absent) is resolved via
        _find_html_in_session_dirs so manually-moved sessions become accessible."""
        import os

        api = ElSbobinatorApi()
        with (
            tempfile.TemporaryDirectory() as outside_dir,
            tempfile.TemporaryDirectory() as desktop_dir,
            tempfile.TemporaryDirectory() as session_root,
        ):
            stale_html = os.path.join(outside_dir, "lecture_Sbobina.html")
            session_subdir = os.path.join(session_root, "abc123session")
            os.makedirs(session_subdir, exist_ok=True)
            actual_html = os.path.join(session_subdir, "lecture_Sbobina.html")
            with open(actual_html, "w", encoding="utf-8") as fh:
                fh.write("<html><body><p>contenuto</p></body></html>")

            with (
                patch(
                    "el_sbobinator.app_webview.get_desktop_dir",
                    return_value=desktop_dir,
                ),
                patch.object(api, "_get_session_root", return_value=session_root),
            ):
                result = api.read_html_content(stale_html)

        self.assertTrue(result["ok"], result.get("error"))
        self.assertIn("contenuto", result["content"])

    def test_existing_file_outside_allowed_roots_still_rejected(self):
        """Security: a file that EXISTS outside allowed roots must still be denied."""
        import os

        api = ElSbobinatorApi()
        with (
            tempfile.TemporaryDirectory() as outside_dir,
            tempfile.TemporaryDirectory() as desktop_dir,
            tempfile.TemporaryDirectory() as session_root,
        ):
            outside_html = os.path.join(outside_dir, "evil.html")
            with open(outside_html, "w", encoding="utf-8") as fh:
                fh.write("<html><body>evil</body></html>")

            with (
                patch(
                    "el_sbobinator.app_webview.get_desktop_dir",
                    return_value=desktop_dir,
                ),
                patch.object(api, "_get_session_root", return_value=session_root),
            ):
                result = api.read_html_content(outside_html)

        self.assertFalse(result["ok"])
        self.assertIn("Accesso negato", result["error"])


class TestSaveHtmlContentPathValidation(unittest.TestCase):
    """Path-validation branches in save_html_content not covered by existing tests."""

    def test_returns_not_found_when_file_missing_and_no_fallback(self):
        """When the HTML file is absent and no session-dir copy exists, save returns an error."""
        import os

        api = ElSbobinatorApi()
        with (
            tempfile.TemporaryDirectory() as desktop_dir,
            tempfile.TemporaryDirectory() as session_root,
        ):
            missing_html = os.path.join(desktop_dir, "missing.html")
            with (
                patch(
                    "el_sbobinator.app_webview.get_desktop_dir",
                    return_value=desktop_dir,
                ),
                patch.object(api, "_get_session_root", return_value=session_root),
            ):
                result = api.save_html_content(missing_html, "<p>x</p>")

        self.assertFalse(result["ok"])
        self.assertIn("trovato", result["error"])

    def test_rejects_non_html_extension(self):
        """save_html_content must reject paths without a .html extension."""
        api = ElSbobinatorApi()
        result = api.save_html_content("/tmp/file.txt", "<p>x</p>")
        self.assertFalse(result["ok"])
        self.assertIn("html", result["error"].lower())

    def test_stale_path_outside_root_resolved_via_session_fallback(self):
        """A stale html_path (outside allowed roots, file absent) is resolved via
        _find_html_in_session_dirs so saves still reach the session-dir copy."""
        import os

        api = ElSbobinatorApi()
        with (
            tempfile.TemporaryDirectory() as outside_dir,
            tempfile.TemporaryDirectory() as desktop_dir,
            tempfile.TemporaryDirectory() as session_root,
        ):
            stale_html = os.path.join(outside_dir, "lecture_Sbobina.html")
            session_subdir = os.path.join(session_root, "abc123session")
            os.makedirs(session_subdir, exist_ok=True)
            actual_html = os.path.join(session_subdir, "lecture_Sbobina.html")
            with open(actual_html, "w", encoding="utf-8") as fh:
                fh.write("<html><body><p>old</p></body></html>")

            with (
                patch(
                    "el_sbobinator.app_webview.get_desktop_dir",
                    return_value=desktop_dir,
                ),
                patch.object(api, "_get_session_root", return_value=session_root),
                patch("el_sbobinator.app_webview.save_html_body_content") as mock_save,
            ):
                result = api.save_html_content(stale_html, "<p>new</p>")
                saved_path = mock_save.call_args[0][0] if mock_save.called else None

        self.assertTrue(result["ok"], result.get("error"))
        self.assertIsNotNone(
            saved_path, "save_html_body_content should have been called"
        )
        assert saved_path is not None
        self.assertTrue(
            os.path.normcase(os.path.realpath(saved_path)).startswith(
                os.path.normcase(os.path.realpath(session_root))
            ),
            "save must write to the resolved session-dir path, not the stale path",
        )

    def test_existing_file_outside_allowed_roots_still_rejected(self):
        """Security: a file that EXISTS outside allowed roots must still be denied."""
        import os

        api = ElSbobinatorApi()
        with (
            tempfile.TemporaryDirectory() as outside_dir,
            tempfile.TemporaryDirectory() as desktop_dir,
            tempfile.TemporaryDirectory() as session_root,
        ):
            outside_html = os.path.join(outside_dir, "evil.html")
            with open(outside_html, "w", encoding="utf-8") as fh:
                fh.write("<html><body>evil</body></html>")

            with (
                patch(
                    "el_sbobinator.app_webview.get_desktop_dir",
                    return_value=desktop_dir,
                ),
                patch.object(api, "_get_session_root", return_value=session_root),
            ):
                result = api.save_html_content(outside_html, "<p>pwned</p>")

            with open(outside_html, encoding="utf-8") as fh:
                file_content = fh.read()

        self.assertFalse(result["ok"])
        self.assertIn("Accesso negato", result["error"])
        self.assertNotIn(
            "pwned", file_content, "file outside allowed roots must not be written"
        )


class TestSearchSessions(unittest.TestCase):
    """Tests for ElSbobinatorApi.search_sessions."""

    def test_rejects_query_shorter_than_three_chars(self):
        api = ElSbobinatorApi()
        result = api.search_sessions("ab")
        self.assertFalse(result["ok"])
        self.assertEqual(result["results"], [])

    def test_rejects_empty_query(self):
        api = ElSbobinatorApi()
        result = api.search_sessions("")
        self.assertFalse(result["ok"])

    def test_rejects_query_longer_than_200_chars(self):
        api = ElSbobinatorApi()
        result = api.search_sessions("x" * 201)
        self.assertFalse(result["ok"])

    def test_returns_empty_results_when_session_root_missing(self):
        api = ElSbobinatorApi()
        with patch.object(
            api, "_get_session_root", return_value="/nonexistent_session_root_xyz"
        ):
            result = api.search_sessions("mitosi")
        self.assertTrue(result["ok"])
        self.assertEqual(result["results"], [])

    def test_finds_matching_done_session(self):
        """Happy path: a done session whose HTML contains the query is returned."""
        import json
        import os

        api = ElSbobinatorApi()
        with (
            tempfile.TemporaryDirectory() as session_root,
            tempfile.TemporaryDirectory() as html_dir,
        ):
            session_dir = os.path.join(session_root, "sess1")
            os.makedirs(session_dir)

            html_path = os.path.join(html_dir, "lecture.html")
            with open(html_path, "w", encoding="utf-8") as fh:
                fh.write(
                    "<html><body><p>Mitosi e meiosi sono processi cellulari.</p></body></html>"
                )

            session_data = {
                "stage": "done",
                "input": {"path": "/audio/lecture.mp3"},
                "outputs": {"html": html_path},
            }
            with open(
                os.path.join(session_dir, "session.json"), "w", encoding="utf-8"
            ) as fh:
                json.dump(session_data, fh)

            with patch.object(api, "_get_session_root", return_value=session_root):
                result = api.search_sessions("mitosi")

        self.assertTrue(result["ok"])
        self.assertEqual(len(result["results"]), 1)
        self.assertEqual(result["results"][0]["name"], "lecture.mp3")
        self.assertGreater(result["results"][0]["match_count"], 0)

    def test_skips_non_done_session(self):
        """Sessions with stage != 'done' must not appear in results."""
        import json
        import os

        api = ElSbobinatorApi()
        with (
            tempfile.TemporaryDirectory() as session_root,
            tempfile.TemporaryDirectory() as html_dir,
        ):
            session_dir = os.path.join(session_root, "in_progress")
            os.makedirs(session_dir)

            html_path = os.path.join(html_dir, "lecture.html")
            with open(html_path, "w", encoding="utf-8") as fh:
                fh.write("<html><body><p>mitosi</p></body></html>")

            session_data = {
                "stage": "phase2",
                "input": {"path": "/audio/lecture.mp3"},
                "outputs": {"html": html_path},
            }
            with open(
                os.path.join(session_dir, "session.json"), "w", encoding="utf-8"
            ) as fh:
                json.dump(session_data, fh)

            with patch.object(api, "_get_session_root", return_value=session_root):
                result = api.search_sessions("mitosi")

        self.assertTrue(result["ok"])
        self.assertEqual(result["results"], [])

    def test_result_count_capped_by_limit(self):
        """limit parameter caps the number of returned results."""
        import json
        import os

        api = ElSbobinatorApi()
        with (
            tempfile.TemporaryDirectory() as session_root,
            tempfile.TemporaryDirectory() as html_dir,
        ):
            for i in range(5):
                sdir = os.path.join(session_root, f"sess_{i}")
                os.makedirs(sdir)
                html_path = os.path.join(html_dir, f"lecture_{i}.html")
                with open(html_path, "w", encoding="utf-8") as fh:
                    fh.write(f"<html><body><p>mitosi session {i}</p></body></html>")
                with open(
                    os.path.join(sdir, "session.json"), "w", encoding="utf-8"
                ) as fh:
                    json.dump(
                        {
                            "stage": "done",
                            "input": {"path": f"/audio/lec{i}.mp3"},
                            "outputs": {"html": html_path},
                        },
                        fh,
                    )

            with patch.object(api, "_get_session_root", return_value=session_root):
                result = api.search_sessions("mitosi", limit=2)

        self.assertTrue(result["ok"])
        self.assertLessEqual(len(result["results"]), 2)


class TestUpdateSessionInputPath(unittest.TestCase):
    """Tests for ElSbobinatorApi.update_session_input_path."""

    def test_rejects_session_dir_outside_session_root(self):
        import os

        api = ElSbobinatorApi()
        with (
            tempfile.TemporaryDirectory() as session_root,
            tempfile.TemporaryDirectory() as outside_dir,
        ):
            with patch.object(api, "_get_session_root", return_value=session_root):
                result = api.update_session_input_path(outside_dir, "/audio/file.mp3")

        self.assertFalse(result["ok"])
        self.assertIn("Percorso non valido", result["error"])

    def test_rejects_missing_session_json(self):
        import os

        api = ElSbobinatorApi()
        with tempfile.TemporaryDirectory() as session_root:
            session_dir = os.path.join(session_root, "sess1")
            os.makedirs(session_dir)

            with patch.object(api, "_get_session_root", return_value=session_root):
                result = api.update_session_input_path(session_dir, "/audio/file.mp3")

        self.assertFalse(result["ok"])
        self.assertIn("non trovato", result["error"])

    def test_rejects_empty_new_path(self):
        import json
        import os

        api = ElSbobinatorApi()
        with tempfile.TemporaryDirectory() as session_root:
            session_dir = os.path.join(session_root, "sess1")
            os.makedirs(session_dir)
            with open(
                os.path.join(session_dir, "session.json"), "w", encoding="utf-8"
            ) as fh:
                json.dump({"input": {"path": "/old.mp3"}, "stage": "done"}, fh)

            with patch.object(api, "_get_session_root", return_value=session_root):
                result = api.update_session_input_path(session_dir, "")

        self.assertFalse(result["ok"])
        self.assertIn("vuoto", result["error"])

    def test_happy_path_updates_path_and_invalidates_cache(self):
        import json
        import os

        api = ElSbobinatorApi()
        with tempfile.TemporaryDirectory() as session_root:
            session_dir = os.path.join(session_root, "sess1")
            os.makedirs(session_dir)
            session_path = os.path.join(session_dir, "session.json")
            with open(session_path, "w", encoding="utf-8") as fh:
                json.dump({"input": {"path": "/old.mp3"}, "stage": "done"}, fh)

            with api._sessions_cache_lock:
                api._sessions_cache = {"sessions": []}
            initial_gen = api._sessions_cache_gen

            with patch.object(api, "_get_session_root", return_value=session_root):
                result = api.update_session_input_path(session_dir, "/new/audio.mp3")

            with open(session_path, encoding="utf-8") as fh:
                updated = json.load(fh)

        self.assertTrue(result["ok"])
        self.assertEqual(updated["input"]["path"], "/new/audio.mp3")
        self.assertEqual(updated["input"]["name"], "audio.mp3")
        with api._sessions_cache_lock:
            self.assertIsNone(api._sessions_cache)
            self.assertEqual(api._sessions_cache_gen, initial_gen + 1)


class TestStreamMediaFile(unittest.TestCase):
    """Tests for ElSbobinatorApi.stream_media_file."""

    def test_returns_url_from_media_server(self):
        api = ElSbobinatorApi()
        with patch(
            "el_sbobinator.app_webview.LocalMediaServer.stream_url_for_file",
            return_value="http://127.0.0.1:8765/audio/abc",
        ):
            result = api.stream_media_file("/audio/lecture.mp3")

        self.assertTrue(result["ok"])
        self.assertEqual(result["url"], "http://127.0.0.1:8765/audio/abc")

    def test_returns_error_dict_on_exception(self):
        api = ElSbobinatorApi()
        with patch(
            "el_sbobinator.app_webview.LocalMediaServer.stream_url_for_file",
            side_effect=RuntimeError("server failed to bind"),
        ):
            result = api.stream_media_file("/bad/path.mp3")

        self.assertFalse(result["ok"])
        self.assertIn("server failed", result["error"])

    def test_rejects_disallowed_extension(self):
        api = ElSbobinatorApi()
        with patch(
            "el_sbobinator.app_webview.LocalMediaServer.stream_url_for_file"
        ) as mock_server:
            result = api.stream_media_file("/some/file.html")
            mock_server.assert_not_called()

        self.assertFalse(result["ok"])
        self.assertIn("non supportato", result["error"])

    def test_rejects_no_extension(self):
        api = ElSbobinatorApi()
        with patch(
            "el_sbobinator.app_webview.LocalMediaServer.stream_url_for_file"
        ) as mock_server:
            result = api.stream_media_file("/etc/passwd")
            mock_server.assert_not_called()

        self.assertFalse(result["ok"])

    def test_extension_check_is_case_insensitive(self):
        api = ElSbobinatorApi()
        with patch(
            "el_sbobinator.app_webview.LocalMediaServer.stream_url_for_file",
            return_value="http://127.0.0.1:9000/stream-xyz/media",
        ):
            result = api.stream_media_file("/audio/lecture.MP3")

        self.assertTrue(result["ok"])

    def test_all_allowed_extensions_pass_guard(self):
        api = ElSbobinatorApi()
        allowed = api._ALLOWED_STREAM_EXTS
        for ext in allowed:
            with self.subTest(ext=ext):
                with patch(
                    "el_sbobinator.app_webview.LocalMediaServer.stream_url_for_file",
                    return_value="http://127.0.0.1:9001/stream-abc/media",
                ):
                    result = api.stream_media_file(f"/audio/file{ext}")
                self.assertTrue(result["ok"], f"Expected ok for extension {ext}")


class TestGetCompletedSessions(unittest.TestCase):
    """Tests for total count surfacing and load_all (limit=0) in get_completed_sessions."""

    def _make_session(self, tmpdir: str, name: str, html_name: str = "out.html") -> str:
        import json as _json
        import os as _os

        session_dir = _os.path.join(tmpdir, name)
        _os.makedirs(session_dir, exist_ok=True)
        html_path = _os.path.join(session_dir, html_name)
        open(html_path, "w").close()
        session_data = {
            "stage": "done",
            "updated_at": "2024-01-01T00:00:00",
            "outputs": {"html": html_path},
            "input": {"path": f"/audio/{name}.mp3", "size": 1024},
            "settings": {},
        }
        with open(_os.path.join(session_dir, "session.json"), "w") as fh:
            _json.dump(session_data, fh)
        return session_dir

    def _clear_cache(self, api: "ElSbobinatorApi") -> None:
        with api._sessions_cache_lock:
            api._sessions_cache = None
            api._sessions_cache_ts = 0.0

    def test_total_zero_when_no_sessions(self):
        api = ElSbobinatorApi()
        api._prewarm_thread.join(timeout=3)
        with tempfile.TemporaryDirectory() as td:
            self._clear_cache(api)
            with patch.object(api, "_get_session_root", return_value=td):
                result = api.get_completed_sessions()
        self.assertTrue(result["ok"])
        self.assertEqual(result["total"], 0)
        self.assertEqual(result["sessions"], [])

    def test_total_reflects_all_candidates_when_limit_truncates(self):
        api = ElSbobinatorApi()
        api._prewarm_thread.join(timeout=3)
        with tempfile.TemporaryDirectory() as td:
            for i in range(5):
                self._make_session(td, f"sess_{i:02d}")
            self._clear_cache(api)
            with patch.object(api, "_get_session_root", return_value=td):
                result = api.get_completed_sessions(limit=2)
        self.assertTrue(result["ok"])
        self.assertEqual(result["total"], 5)
        self.assertEqual(len(result["sessions"]), 2)

    def test_total_equals_sessions_when_within_limit(self):
        api = ElSbobinatorApi()
        api._prewarm_thread.join(timeout=3)
        with tempfile.TemporaryDirectory() as td:
            for i in range(3):
                self._make_session(td, f"sess_{i:02d}")
            self._clear_cache(api)
            with patch.object(api, "_get_session_root", return_value=td):
                result = api.get_completed_sessions(limit=10)
        self.assertTrue(result["ok"])
        self.assertEqual(result["total"], 3)
        self.assertEqual(len(result["sessions"]), 3)

    def test_load_all_returns_all_sessions(self):
        api = ElSbobinatorApi()
        api._prewarm_thread.join(timeout=3)
        with tempfile.TemporaryDirectory() as td:
            for i in range(5):
                self._make_session(td, f"sess_{i:02d}")
            with patch.object(api, "_get_session_root", return_value=td):
                result = api.get_completed_sessions(limit=0)
        self.assertTrue(result["ok"])
        self.assertEqual(result["total"], 5)
        self.assertEqual(len(result["sessions"]), 5)

    def test_load_all_bypasses_and_does_not_write_cache(self):
        api = ElSbobinatorApi()
        api._prewarm_thread.join(timeout=3)
        with tempfile.TemporaryDirectory() as td:
            for i in range(3):
                self._make_session(td, f"sess_{i:02d}")
            with api._sessions_cache_lock:
                api._sessions_cache = None
                api._sessions_cache_ts = 0.0
            with patch.object(api, "_get_session_root", return_value=td):
                api.get_completed_sessions(limit=0)
        with api._sessions_cache_lock:
            self.assertIsNone(api._sessions_cache, "load_all must not write to cache")

    def test_total_included_in_error_return(self):
        api = ElSbobinatorApi()
        api._prewarm_thread.join(timeout=3)
        with tempfile.TemporaryDirectory() as td:
            self._clear_cache(api)
            with patch.object(api, "_get_session_root", return_value=td):
                with patch(
                    "el_sbobinator.app_webview.os.scandir",
                    side_effect=OSError("disk error"),
                ):
                    result = api.get_completed_sessions()
        self.assertFalse(result["ok"])
        self.assertIn("total", result)
        self.assertEqual(result["total"], 0)


class TestMoveSessionRoot(unittest.TestCase):
    """Tests for _do_move_session_root: atomic-rename fast path, cross-device
    fallback, and partial-failure option-b (SESSION_ROOT updated even on error)."""

    _SET_ROOT = "el_sbobinator.app_webview.set_session_root"
    _SAVE_ROOT = "el_sbobinator.app_webview.save_session_root_to_config"
    _INVALIDATE = "el_sbobinator.app_webview.invalidate_session_storage_cache"

    def setUp(self):
        self.api = ElSbobinatorApi()

    def test_atomic_rename_on_same_filesystem(self):
        """Fast path: os.rename succeeds; shutil.move must never be called."""
        import os as _os

        with (
            tempfile.TemporaryDirectory() as parent,
            patch(self._SET_ROOT) as mock_set,
            patch(self._SAVE_ROOT),
            patch(self._INVALIDATE),
            patch(
                "shutil.move", side_effect=AssertionError("must not reach item-by-item")
            ),
        ):
            old_root = _os.path.join(parent, "old")
            new_path = _os.path.join(parent, "new")
            _os.makedirs(_os.path.join(old_root, "sess_01"))
            _os.makedirs(_os.path.join(old_root, "sess_02"))

            self.api._do_move_session_root(old_root, new_path)

            # Filesystem checks inside block — temp dir is still alive here.
            self.assertFalse(_os.path.exists(old_root))
            self.assertTrue(_os.path.isdir(new_path))

        state = dict(self.api._move_state)
        self.assertEqual(state["status"], "done")
        self.assertEqual(state["moved"], 2)
        self.assertEqual(state["total"], 2)
        mock_set.assert_called_once_with(new_path)

    def test_cross_device_fallback_full_success(self):
        """os.rename raises OSError (cross-device); item-by-item completes, root updated."""
        import os as _os

        with (
            tempfile.TemporaryDirectory() as parent,
            patch(self._SET_ROOT) as mock_set,
            patch(self._SAVE_ROOT),
            patch(self._INVALIDATE),
            patch("os.rename", side_effect=OSError("cross-device link")),
        ):
            old_root = _os.path.join(parent, "old")
            new_path = _os.path.join(parent, "new")
            _os.makedirs(_os.path.join(old_root, "sess_01"))
            _os.makedirs(_os.path.join(old_root, "sess_02"))

            self.api._do_move_session_root(old_root, new_path)

        state = dict(self.api._move_state)
        self.assertEqual(state["status"], "done")
        self.assertEqual(state["moved"], 2)
        mock_set.assert_called_once_with(new_path)

    def test_partial_move_still_updates_session_root(self):
        """Core bug fix: SESSION_ROOT updated to new_path even on mid-loop failure;
        error message reports the split state."""
        import os as _os
        import shutil as _shutil_module

        # Capture the real function BEFORE the patch context so that calling it
        # inside _fail_on_second doesn't re-enter the mock.
        _real_move = _shutil_module.move

        move_call_count = 0

        def _fail_on_second(src, dst):
            nonlocal move_call_count
            move_call_count += 1
            if move_call_count >= 2:
                raise OSError("disk full")
            # os.rename is patched to always fail, so _real_move falls back to
            # copytree for directories — the item still lands in new_path.
            _real_move(src, dst)

        with (
            tempfile.TemporaryDirectory() as parent,
            patch(self._SET_ROOT) as mock_set,
            patch(self._SAVE_ROOT),
            patch(self._INVALIDATE),
            patch("os.rename", side_effect=OSError("cross-device link")),
            patch("shutil.move", side_effect=_fail_on_second),
        ):
            old_root = _os.path.join(parent, "old")
            new_path = _os.path.join(parent, "new")
            _os.makedirs(_os.path.join(old_root, "sess_01"))
            _os.makedirs(_os.path.join(old_root, "sess_02"))
            _os.makedirs(_os.path.join(old_root, "sess_03"))

            self.api._do_move_session_root(old_root, new_path)

        state = dict(self.api._move_state)
        self.assertEqual(state["status"], "error")
        self.assertEqual(state["moved"], 1)
        self.assertEqual(state["total"], 3)
        mock_set.assert_called_once_with(new_path)
        self.assertIn("2 rimasta", state["error"])
        self.assertIn(old_root, state["error"])

    def test_non_empty_destination_aborts_without_touching_root(self):
        """Destination already contains files: returns error, SESSION_ROOT untouched."""
        import os as _os

        with (
            tempfile.TemporaryDirectory() as parent,
            patch(self._SET_ROOT) as mock_set,
            patch(self._SAVE_ROOT),
            patch(self._INVALIDATE),
        ):
            old_root = _os.path.join(parent, "old")
            new_path = _os.path.join(parent, "new")
            _os.makedirs(_os.path.join(old_root, "sess_01"))
            _os.makedirs(_os.path.join(new_path, "existing"))

            self.api._do_move_session_root(old_root, new_path)

        state = dict(self.api._move_state)
        self.assertEqual(state["status"], "error")
        self.assertIn("non vuota", state["error"])
        mock_set.assert_not_called()


class TestShowNotification(unittest.TestCase):
    """show_notification — Darwin osascript fallback and cross-platform error path."""

    def test_darwin_osascript_popen_called_when_plyer_fails(self):
        """On darwin, if plyer raises, subprocess.Popen(['osascript', ...]) must be called."""
        import sys
        from unittest.mock import MagicMock

        api = ElSbobinatorApi()
        popen_calls: list[list] = []

        def _fake_popen(cmd, **kwargs):
            popen_calls.append(list(cmd))

        with (
            patch.dict(
                sys.modules,
                {
                    "plyer": MagicMock(
                        notification=MagicMock(
                            notify=MagicMock(
                                side_effect=RuntimeError("plyer unavailable")
                            )
                        )
                    )
                },
            ),
            patch("sys.platform", "darwin"),
            patch("subprocess.Popen", side_effect=_fake_popen),
        ):
            result = api.show_notification("Titolo", "Messaggio di test")

        self.assertTrue(result["ok"])
        self.assertEqual(len(popen_calls), 1)
        self.assertEqual(popen_calls[0][0], "osascript")
        joined = " ".join(popen_calls[0])
        self.assertIn("Messaggio di test", joined)
        self.assertIn("Titolo", joined)

    def test_non_darwin_plyer_failure_returns_error_dict(self):
        """On non-darwin platforms, if plyer raises, return ok=False with error string."""
        import sys
        from unittest.mock import MagicMock

        api = ElSbobinatorApi()

        with (
            patch.dict(
                sys.modules,
                {
                    "plyer": MagicMock(
                        notification=MagicMock(
                            notify=MagicMock(side_effect=RuntimeError("no notifier"))
                        )
                    )
                },
            ),
            patch("sys.platform", "linux"),
        ):
            result = api.show_notification("Titolo", "Messaggio")

        self.assertFalse(result["ok"])
        self.assertIn("no notifier", result["error"])


class TestRetryFailedRevisionBlocksBridge(unittest.TestCase):
    def _make_done_session(
        self,
        root: str,
        *,
        user_edited: bool = False,
        omit_user_edited: bool = False,
        failed_blocks: list[int] | None = None,
        create_html: bool = True,
    ) -> tuple[str, str]:
        session_dir = os.path.join(root, "session-a")
        os.makedirs(os.path.join(session_dir, "phase2_revised"), exist_ok=True)
        html_path = os.path.join(session_dir, "out.html")
        if create_html:
            with open(html_path, "w", encoding="utf-8") as fh:
                fh.write("<html><body><p>Originale</p></body></html>")
        with open(
            os.path.join(session_dir, "phase2_revised", "rev_001.raw.md"),
            "w",
            encoding="utf-8",
        ) as fh:
            fh.write("Grezzo.\n")
        session: dict = {
            "stage": "done",
            "input": {"path": os.path.join(root, "audio.mp3")},
            "outputs": {"html": html_path},
            "settings": {"model": "gemini-test", "fallback_models": []},
            "phase2": {"macro_total": 1},
            "revision_failed_blocks": failed_blocks
            if failed_blocks is not None
            else [1],
        }
        if not omit_user_edited:
            session["user_edited"] = user_edited
        session_path = os.path.join(session_dir, "session.json")
        with open(session_path, "w", encoding="utf-8") as fh:
            json.dump(session, fh)
        return session_dir, session_path

    def test_retry_refuses_while_pipeline_is_running(self):
        api = ElSbobinatorApi()
        api._adapter.is_running = True

        result = api.retry_failed_revision_blocks("ignored")

        self.assertFalse(result["ok"])
        self.assertIn("Elaborazione in corso", result["error"])

    def test_retry_aborts_on_missing_user_edited_with_existing_html(self):
        """Legacy sessions without user_edited key must be treated as potentially
        edited when an HTML file is present — conservative guard."""
        api = ElSbobinatorApi()
        with tempfile.TemporaryDirectory() as tmpdir:
            session_dir, _session_path = self._make_done_session(
                tmpdir, omit_user_edited=True, create_html=True
            )
            with patch(
                "el_sbobinator.app_webview.get_session_root", return_value=tmpdir
            ):
                result = api.retry_failed_revision_blocks(session_dir)

        self.assertFalse(result["ok"])
        self.assertTrue(result["conflict"])

    def test_retry_aborts_on_missing_user_edited_with_stale_html_path(self):
        api = ElSbobinatorApi()
        with tempfile.TemporaryDirectory() as tmpdir:
            session_dir, session_path = self._make_done_session(
                tmpdir, omit_user_edited=True, create_html=True
            )
            with open(session_path, encoding="utf-8") as fh:
                session = json.load(fh)
            session["outputs"]["html"] = os.path.join(tmpdir, "missing", "out.html")
            with open(session_path, "w", encoding="utf-8") as fh:
                json.dump(session, fh)

            with patch(
                "el_sbobinator.app_webview.get_session_root", return_value=tmpdir
            ):
                result = api.retry_failed_revision_blocks(session_dir)

        self.assertFalse(result["ok"])
        self.assertTrue(result["conflict"])

    def test_retry_proceeds_on_missing_user_edited_without_html(self):
        """Legacy sessions without user_edited key but no HTML on disk are safe
        to retry (nothing to overwrite)."""
        api = ElSbobinatorApi()
        with tempfile.TemporaryDirectory() as tmpdir:
            session_dir, _session_path = self._make_done_session(
                tmpdir, omit_user_edited=True, create_html=False, failed_blocks=[]
            )
            with patch(
                "el_sbobinator.app_webview.get_session_root", return_value=tmpdir
            ):
                result = api.retry_failed_revision_blocks(session_dir)

        self.assertTrue(result["ok"])
        self.assertFalse(result.get("conflict", False))

    def test_retry_aborts_on_user_edited_flag(self):
        api = ElSbobinatorApi()
        with tempfile.TemporaryDirectory() as tmpdir:
            session_dir, _session_path = self._make_done_session(
                tmpdir, user_edited=True
            )
            with patch(
                "el_sbobinator.app_webview.get_session_root", return_value=tmpdir
            ):
                result = api.retry_failed_revision_blocks(session_dir)

        self.assertFalse(result["ok"])
        self.assertTrue(result["conflict"])

    def test_retry_skips_export_when_zero_blocks_retried(self):
        api = ElSbobinatorApi()
        with tempfile.TemporaryDirectory() as tmpdir:
            session_dir, _session_path = self._make_done_session(tmpdir)
            with (
                patch(
                    "el_sbobinator.app_webview.get_session_root", return_value=tmpdir
                ),
                patch(
                    "el_sbobinator.app_webview.load_config",
                    return_value={
                        "api_key": "key",
                        "preferred_model": "gemini-test",
                        "fallback_models": [],
                    },
                ),
                patch("google.genai.Client", return_value=object()),
                patch(
                    "el_sbobinator.services.revision_service.retry_failed_revision_blocks",
                    return_value=(
                        object(),
                        {
                            "retried_blocks": [],
                            "failed_blocks": [1],
                            "quota_exhausted": True,
                            "cancelled": False,
                        },
                    ),
                ),
                patch(
                    "el_sbobinator.services.export_service.export_final_html_document"
                ) as mock_export,
            ):
                result = api.retry_failed_revision_blocks(session_dir)

        self.assertFalse(result["ok"])
        self.assertTrue(result["quota_exhausted"])
        mock_export.assert_not_called()

    def test_retry_concurrent_same_session_rejected(self):
        api = ElSbobinatorApi()
        with tempfile.TemporaryDirectory() as tmpdir:
            session_dir, _session_path = self._make_done_session(tmpdir)
            lock_key = os.path.normcase(os.path.realpath(session_dir))
            lock = threading.Lock()
            lock.acquire()
            ElSbobinatorApi._retry_locks[lock_key] = lock
            try:
                with patch(
                    "el_sbobinator.app_webview.get_session_root", return_value=tmpdir
                ):
                    result = api.retry_failed_revision_blocks(session_dir)
            finally:
                lock.release()
                ElSbobinatorApi._retry_locks.pop(lock_key, None)

        self.assertFalse(result["ok"])
        self.assertIn("Retry gia", result["error"])

    def test_retry_concurrent_different_session_rejected_by_global_lock(self):
        api = ElSbobinatorApi()
        global_lock = threading.Lock()
        global_lock.acquire()
        old_global_lock = ElSbobinatorApi._retry_global_lock
        ElSbobinatorApi._retry_global_lock = global_lock
        try:
            with tempfile.TemporaryDirectory() as tmpdir:
                session_dir, _session_path = self._make_done_session(tmpdir)
                with patch(
                    "el_sbobinator.app_webview.get_session_root", return_value=tmpdir
                ):
                    result = api.retry_failed_revision_blocks(session_dir)
        finally:
            global_lock.release()
            ElSbobinatorApi._retry_global_lock = old_global_lock

        self.assertFalse(result["ok"])
        self.assertIn("Retry gia", result["error"])

    def test_save_html_content_marks_user_edited_only_when_body_save_writes(self):
        api = ElSbobinatorApi()
        with tempfile.TemporaryDirectory() as tmpdir:
            html_path = os.path.join(tmpdir, "out.html")
            session_path = os.path.join(tmpdir, "session.json")
            with open(html_path, "w", encoding="utf-8") as fh:
                fh.write("<html><body><p>Old</p></body></html>")
            with open(session_path, "w", encoding="utf-8") as fh:
                json.dump({"stage": "done", "user_edited": False}, fh)

            with patch(
                "el_sbobinator.app_webview.get_desktop_dir", return_value=tmpdir
            ):
                first = api.save_html_content(html_path, "<p>New</p>", generation=1)
            self.assertTrue(first["ok"])
            with open(session_path, encoding="utf-8") as fh:
                self.assertTrue(json.load(fh)["user_edited"])

            with open(session_path, "w", encoding="utf-8") as fh:
                json.dump({"stage": "done", "user_edited": False}, fh)
            with patch(
                "el_sbobinator.app_webview.get_desktop_dir", return_value=tmpdir
            ):
                stale = api.save_html_content(html_path, "<p>Stale</p>", generation=1)
            self.assertTrue(stale["ok"])
            with open(session_path, encoding="utf-8") as fh:
                self.assertFalse(json.load(fh)["user_edited"])


class TestOpenUrlAllowlistCoverage(unittest.TestCase):
    """Bidirectional contract between _ALLOWED_URL_PREFIXES and the React open_url() call-sites.

    Parses ``webui/src/branding.ts`` to resolve exported URL constants (template
    literals included), then scans every non-test ``.ts``/``.tsx`` file for
    ``open_url?.(<arg>)`` call-sites.  The two tests enforce:

    1. Every URL the React side may pass to ``open_url()`` is covered by at least
       one prefix in ``_ALLOWED_URL_PREFIXES``.
    2. Every prefix in ``_ALLOWED_URL_PREFIXES`` is exercised by at least one
       React call-site (no orphaned allowlist entries).

    If either invariant is violated the failing test message names the offending
    URL / prefix, making the fix obvious.
    """

    _WEBUI_SRC = Path(__file__).parents[1] / "webui" / "src"
    _BRANDING_TS = _WEBUI_SRC / "branding.ts"

    def _resolve_branding_urls(self) -> dict[str, str]:
        """Return {constant_name: resolved_url} for every https:// export in branding.ts."""
        text = self._BRANDING_TS.read_text(encoding="utf-8")
        resolved: dict[str, str] = {}
        for m in re.finditer(r"export const (\w+)(?::[^=]+)?\s*=\s*'([^']+)'", text):
            resolved[m.group(1)] = m.group(2)
        for m in re.finditer(r'export const (\w+)(?::[^=]+)?\s*=\s*"([^"]+)"', text):
            resolved[m.group(1)] = m.group(2)
        for _ in range(3):
            for m in re.finditer(
                r"export const (\w+)(?::[^=]+)?\s*=\s*`([^`]+)`", text
            ):
                name, tmpl = m.group(1), m.group(2)
                val = re.sub(
                    r"\$\{(\w+)\}",
                    lambda mm: resolved.get(mm.group(1), mm.group(0)),
                    tmpl,
                )
                if "${" not in val:
                    resolved[name] = val
        return {k: v for k, v in resolved.items() if v.startswith("https://")}

    def _collect_react_open_url_targets(
        self, branding_urls: dict[str, str]
    ) -> list[str]:
        """Return every unique URL string passed to open_url?. in non-test TS/TSX files."""
        urls: set[str] = set()
        ts_files = [
            f
            for ext in ("*.ts", "*.tsx")
            for f in self._WEBUI_SRC.rglob(ext)
            if ".test." not in f.name and ".spec." not in f.name
        ]
        for ts_file in ts_files:
            text = ts_file.read_text(encoding="utf-8", errors="replace")
            for m in re.finditer(r"open_url\?\.\(\s*['\"]([^'\"]+)['\"]", text):
                urls.add(m.group(1))
            # Pattern 2: constant identifier — intentionally restricted to ALL_CAPS
            # (e.g. GITHUB_URL).  camelCase constants (e.g. githubUrl) would be
            # silently missed; all current call-sites use ALL_CAPS or string literals.
            for m in re.finditer(r"open_url\?\.\(\s*([A-Z_][A-Z0-9_]*)\s*\)", text):
                const = m.group(1)
                if const in branding_urls:
                    urls.add(branding_urls[const])
        return sorted(urls)

    def test_every_react_open_url_target_is_in_allowlist(self):
        from el_sbobinator.app_webview import _ALLOWED_URL_PREFIXES

        branding_urls = self._resolve_branding_urls()
        react_urls = self._collect_react_open_url_targets(branding_urls)
        self.assertTrue(
            react_urls, "No open_url() call-sites found — scanner may be broken"
        )
        not_covered = [
            u
            for u in react_urls
            if not any(u.startswith(p) for p in _ALLOWED_URL_PREFIXES)
        ]
        self.assertFalse(
            not_covered,
            "React open_url() targets NOT in _ALLOWED_URL_PREFIXES:\n"
            + "\n".join(f"  {u}" for u in not_covered)
            + "\n\nAdd a matching prefix to _ALLOWED_URL_PREFIXES in app_webview.py.",
        )

    def test_no_allowlist_prefix_is_orphaned(self):
        from el_sbobinator.app_webview import _ALLOWED_URL_PREFIXES

        branding_urls = self._resolve_branding_urls()
        react_urls = self._collect_react_open_url_targets(branding_urls)
        self.assertTrue(
            react_urls, "No open_url() call-sites found — scanner may be broken"
        )
        orphaned = [
            p
            for p in _ALLOWED_URL_PREFIXES
            if not any(u.startswith(p) for u in react_urls)
        ]
        self.assertFalse(
            orphaned,
            "Allowlist prefixes with NO matching open_url() call-site in React source:\n"
            + "\n".join(f"  {p}" for p in orphaned)
            + "\n\nRemove orphaned entries from _ALLOWED_URL_PREFIXES or add a React call-site.",
        )


class TestRetryStartProcessingGuard(unittest.TestCase):
    """start_processing must be rejected while any retry is in flight."""

    def _make_file(self) -> str:
        with tempfile.NamedTemporaryFile("wb", suffix=".mp3", delete=False) as tmp:
            tmp.write(b"fake")
            return tmp.name

    def test_start_processing_blocked_while_retry_active(self):
        api = ElSbobinatorApi()
        with api._pipeline_lifecycle_lock:
            api._retry_active_count = 1

        result = api.start_processing(
            [{"id": "f1", "path": self._make_file(), "name": "x.mp3", "size": 4}],
            api_key="key",
        )

        self.assertFalse(result["ok"])
        self.assertIn("Retry", result["error"])

    def test_start_processing_allowed_when_retry_count_is_zero(self):
        api = ElSbobinatorApi()

        with (
            patch("el_sbobinator.pipeline.pipeline.esegui_sbobinatura") as mock_run,
            patch("el_sbobinator.app_webview.threading.Thread", _SyncThread),
        ):
            mock_run.return_value = None
            api._adapter.set_run_result("done", "")

            result = api.start_processing(
                [{"id": "f1", "path": self._make_file(), "name": "x.mp3", "size": 4}],
                api_key="key",
            )

        self.assertTrue(result["ok"])

    def test_retry_active_count_is_zero_after_retry_completes(self):
        api = ElSbobinatorApi()
        with api._pipeline_lifecycle_lock:
            api._retry_active_count += 1
        with api._pipeline_lifecycle_lock:
            api._retry_active_count -= 1

        with api._pipeline_lifecycle_lock:
            self.assertEqual(api._retry_active_count, 0)

    def test_start_processing_not_blocked_when_adapter_running_not_retry(self):
        api = ElSbobinatorApi()
        api._adapter.is_running = True

        result = api.start_processing(
            [{"id": "f1", "path": self._make_file(), "name": "x.mp3", "size": 4}],
            api_key="key",
        )

        self.assertFalse(result["ok"])
        self.assertIn("in corso", result["error"])
        self.assertNotIn("Retry", result["error"])


if __name__ == "__main__":
    unittest.main()
