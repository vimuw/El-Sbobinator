import os
import tempfile
import threading
import unittest
from unittest.mock import MagicMock, patch

from el_sbobinator.bridge.controllers.export_controller import ExportControllerMixin
from el_sbobinator.bridge.controllers.html_controller import HtmlControllerMixin
from el_sbobinator.bridge.controllers.media_controller import MediaControllerMixin
from el_sbobinator.bridge.controllers.settings_controller import SettingsControllerMixin
from el_sbobinator.bridge.controllers.system_controller import SystemControllerMixin


class DummyExportHost(ExportControllerMixin):
    def __init__(self, window=None, session_root=""):
        self._window = window
        self._session_root = session_root
        self.invalidated = False

    def _get_session_root(self) -> str:
        return self._session_root

    def _invalidate_sessions_cache(self) -> None:
        self.invalidated = True


class DummySystemHost(SystemControllerMixin):
    def __init__(self, session_root=""):
        self._session_root = session_root
        self._logger = MagicMock()
        self._adapter = MagicMock()

    def _get_session_root(self) -> str:
        return self._session_root


class DummySettingsHost(SettingsControllerMixin):
    def __init__(self, window=None):
        self._window = window
        self._logger = MagicMock()
        self._processing_thread = None
        self._move_lock = threading.Lock()
        self._move_state = {
            "status": "idle",
            "moved": 0,
            "total": 0,
            "error": None,
        }
        self._sessions_cache = None
        self._sessions_cache_gen = 0
        self._sessions_cache_lock = threading.Lock()


class DummyMediaHost(MediaControllerMixin):
    def __init__(self, window=None):
        self._window = window
        self._adapter = MagicMock()
        self.console_messages: list[str] = []

    def _push_console(self, msg: str) -> None:
        self.console_messages.append(msg)


class DummyHtmlHost(HtmlControllerMixin):
    def __init__(self, session_root=""):
        self._session_root = session_root
        self._logger = MagicMock()
        self._resolved_cache_lock = threading.Lock()
        self._resolved_path_cache: dict[str, str] = {}
        self._html_shell_cache: dict[str, tuple[str, str]] = {}
        self._sessions_cache_lock = threading.Lock()
        self._sessions_cache = None
        self._sessions_cache_gen = 0

    def _get_session_root(self) -> str:
        return self._session_root


class TestExportController(unittest.TestCase):
    def test_export_sbobina_package_no_target_path_cancelled(self):
        win = MagicMock()
        win.create_file_dialog.return_value = None
        host = DummyExportHost(window=win)
        res = host.export_sbobina_package("/fake/session")
        self.assertFalse(res.get("ok"))
        self.assertTrue(res.get("cancelled"))

    def test_export_sbobina_package_dialog_fallback(self):
        win = MagicMock()
        win.create_file_dialog.side_effect = [
            Exception("dialog fail"),
            ["/out/file.sbobina"],
        ]
        host = DummyExportHost(window=win)
        with patch(
            "el_sbobinator.bridge.controllers.export_controller.create_sbobina_package"
        ) as mock_create:
            mock_create.return_value = {"ok": True, "package_path": "/out/file.sbobina"}
            res = host.export_sbobina_package("/fake/session")
            self.assertTrue(res.get("ok"))
            mock_create.assert_called_once_with(
                "/fake/session",
                "/out/file.sbobina",
                include_mode="full",
            )

    def test_export_sbobina_package_explicit_target_path(self):
        host = DummyExportHost(window=None)
        with patch(
            "el_sbobinator.bridge.controllers.export_controller.create_sbobina_package"
        ) as mock_create:
            mock_create.return_value = {"ok": True}
            res = host.export_sbobina_package(
                "/fake/session",
                export_type="media_only",
                target_path="/out/pkg.sbobina",
            )
            self.assertTrue(res.get("ok"))
            mock_create.assert_called_once_with(
                "/fake/session",
                "/out/pkg.sbobina",
                include_mode="media_only",
            )

    def test_export_sbobina_package_no_window_no_target(self):
        host = DummyExportHost(window=None)
        res = host.export_sbobina_package("/fake/session")
        self.assertFalse(res.get("ok"))
        self.assertIn("non specificato", res.get("error", ""))

    def test_import_sbobina_package_cancelled(self):
        win = MagicMock()
        win.create_file_dialog.return_value = None
        host = DummyExportHost(window=win)
        res = host.import_sbobina_package()
        self.assertFalse(res.get("ok"))
        self.assertTrue(res.get("cancelled"))

    def test_import_sbobina_package_dialog_fallback(self):
        win = MagicMock()
        win.create_file_dialog.side_effect = [Exception("error"), "/in/pkg.sbobina"]
        host = DummyExportHost(window=win, session_root="/sessions")
        with patch(
            "el_sbobinator.bridge.controllers.export_controller.unpack_and_import_package"
        ) as mock_import:
            mock_import.return_value = {"ok": True, "session_id": "123"}
            res = host.import_sbobina_package()
            self.assertTrue(res.get("ok"))
            self.assertTrue(host.invalidated)
            mock_import.assert_called_once_with("/in/pkg.sbobina", "/sessions")

    def test_import_sbobina_package_no_path(self):
        host = DummyExportHost(window=None)
        res = host.import_sbobina_package()
        self.assertFalse(res.get("ok"))
        self.assertIn("Nessun pacchetto", res.get("error", ""))

    def test_share_sbobina_via_email(self):
        host = DummyExportHost()
        with patch(
            "el_sbobinator.bridge.controllers.export_controller.prepare_email_share"
        ) as mock_email:
            mock_email.return_value = {
                "ok": True,
                "mailto_url": "mailto:test@example.com",
            }
            res = host.share_sbobina_via_email(
                "/fake/session", recipient="test@example.com", mail_provider="gmail"
            )
            self.assertTrue(res.get("ok"))
            mock_email.assert_called_once_with(
                session_dir="/fake/session",
                include_mode="full",
                recipient="test@example.com",
                mail_provider="gmail",
            )


class TestSystemController(unittest.TestCase):
    def test_validate_environment(self):
        host = DummySystemHost()
        with patch(
            "el_sbobinator.services.validation_service.validate_environment"
        ) as mock_val:
            mock_val.return_value = {"valid": True}
            res = host.validate_environment(api_key="key123", check_api_key=True)
            self.assertTrue(res.get("ok"))
            self.assertEqual(res.get("result"), {"valid": True})

    def test_validate_environment_exception(self):
        host = DummySystemHost()
        with patch(
            "el_sbobinator.services.validation_service.validate_environment",
            side_effect=ValueError("boom"),
        ):
            res = host.validate_environment()
            self.assertFalse(res.get("ok"))
            self.assertIn("boom", res.get("error", ""))

    def test_open_file_invalid_inputs(self):
        host = DummySystemHost()
        self.assertFalse(host.open_file(123).get("ok"))  # type: ignore[arg-type]
        self.assertFalse(host.open_file("https://google.com").get("ok"))

    def test_open_file_outside_allowed_roots(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            host = DummySystemHost(session_root=os.path.join(temp_dir, "sessions"))
            res = host.open_file(os.path.join(temp_dir, "other", "secret.txt"))
            self.assertFalse(res.get("ok"))
            self.assertIn("Accesso negato", res.get("error", ""))

    def test_open_file_allowed(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            session_root = os.path.join(temp_dir, "sessions")
            os.makedirs(session_root, exist_ok=True)
            target = os.path.join(session_root, "doc.txt")
            with open(target, "w") as f:
                f.write("hello")
            host = DummySystemHost(session_root=session_root)
            with patch(
                "el_sbobinator.utils.file_ops.open_path_with_default_app"
            ) as mock_open_app:
                res = host.open_file(target)
                self.assertTrue(res.get("ok"))
                mock_open_app.assert_called_once_with(os.path.realpath(target))

    def test_open_url_allowed_and_blocked(self):
        host = DummySystemHost()
        # Invalid
        self.assertFalse(host.open_url("ftp://malicious.com").get("ok"))
        self.assertFalse(host.open_url(123).get("ok"))  # type: ignore[arg-type]

        # Allowed
        with patch(
            "el_sbobinator.utils.file_ops.open_path_with_default_app"
        ) as mock_open_app:
            res = host.open_url("https://aistudio.google.com/apikey")
            self.assertTrue(res.get("ok"))
            mock_open_app.assert_called_once_with("https://aistudio.google.com/apikey")

    def test_show_notification(self):
        host = DummySystemHost()
        with patch("plyer.notification.notify") as mock_notify:
            res = host.show_notification("Title", "Message")
            self.assertTrue(res.get("ok"))
            mock_notify.assert_called_once_with(
                title="Title", message="Message", app_name="El Sbobinator", timeout=5
            )

    def test_download_and_install_update(self):
        host = DummySystemHost()
        with patch(
            "el_sbobinator.core.updater.download_and_install_update"
        ) as mock_upd:
            mock_upd.return_value = {"ok": True}
            res = host.download_and_install_update("2.0.0")
            self.assertTrue(res.get("ok"))
            mock_upd.assert_called_once_with("2.0.0", emit_fn=host._adapter.emit)

    def test_send_collaboration_signal(self):
        host = DummySystemHost()
        self.assertFalse(host.send_collaboration_signal("", "data").get("ok"))
        self.assertFalse(host.send_collaboration_signal("room", "").get("ok"))

        mock_win = MagicMock()
        with patch("webview.windows", [mock_win]):
            res = host.send_collaboration_signal("ROOM1", "payload_data")
            self.assertTrue(res.get("ok"))
            mock_win.evaluate_js.assert_called_once()
            self.assertIn("room1", mock_win.evaluate_js.call_args[0][0])


class TestSettingsController(unittest.TestCase):
    def test_load_settings(self):
        host = DummySettingsHost()
        with patch(
            "el_sbobinator.bridge.controllers.settings_controller.load_config"
        ) as mock_cfg:
            mock_cfg.return_value = {
                "api_key": "k",
                "fallback_keys": ["k2"],
                "preferred_model": "model-1",
                "fallback_models": ["model-2"],
                "has_protected_key": True,
                "api_key_insecure": False,
                "config_recovered_from": "backup.json",
            }
            res = host.load_settings()
            self.assertEqual(res["api_key"], "k")
            self.assertEqual(res["config_recovered_from"], "backup.json")
            self.assertTrue(res["has_protected_key"])

    def test_load_settings_fallback_on_exception(self):
        host = DummySettingsHost()
        with patch(
            "el_sbobinator.bridge.controllers.settings_controller.load_config",
            side_effect=Exception("bad file"),
        ):
            res = host.load_settings()
            self.assertEqual(res["api_key"], "")
            self.assertFalse(res["has_protected_key"])

    def test_save_settings(self):
        host = DummySettingsHost()
        with patch(
            "el_sbobinator.bridge.controllers.settings_controller.save_config"
        ) as mock_save:
            res = host.save_settings("k", ["k2"], "m1", ["m2"])
            self.assertTrue(res.get("ok"))
            mock_save.assert_called_once_with(
                "k", fallback_keys=["k2"], preferred_model="m1", fallback_models=["m2"]
            )

    def test_save_theme_preference(self):
        host = DummySettingsHost()
        with tempfile.TemporaryDirectory() as td:
            pref_file = os.path.join(td, "theme.txt")
            with patch(
                "el_sbobinator.bridge.controllers.settings_controller.THEME_PREF_FILE",
                pref_file,
            ):
                host.save_theme_preference("dark")
                with open(pref_file) as f:
                    self.assertEqual(f.read(), "dark")

                host.save_theme_preference("invalid")
                with open(pref_file) as f:
                    self.assertEqual(f.read(), "dark")

    def test_ask_session_folder(self):
        win = MagicMock()
        win.create_file_dialog.return_value = ["/path/to/folder"]
        host = DummySettingsHost(window=win)
        res = host.ask_session_folder()
        self.assertTrue(res.get("ok"))
        self.assertEqual(res.get("path"), "/path/to/folder")

        # Cancelled
        win.create_file_dialog.return_value = None
        res2 = host.ask_session_folder()
        self.assertFalse(res2.get("ok"))
        self.assertTrue(res2.get("cancelled"))

        # No window
        host_no_win = DummySettingsHost(window=None)
        res3 = host_no_win.ask_session_folder()
        self.assertFalse(res3.get("ok"))

    def test_move_session_root_validation(self):
        with tempfile.TemporaryDirectory() as td:
            old_root = os.path.join(td, "old_sessions")
            os.makedirs(old_root, exist_ok=True)
            with patch(
                "el_sbobinator.bridge.controllers.settings_controller.get_session_root",
                return_value=old_root,
            ):
                host = DummySettingsHost()
                self.assertFalse(host.move_session_root("").get("ok"))
                self.assertFalse(host.move_session_root("relative/path").get("ok"))
                self.assertFalse(host.move_session_root(old_root).get("ok"))
                nested = os.path.join(old_root, "nested")
                self.assertFalse(host.move_session_root(nested).get("ok"))

                # Processing thread busy
                busy_thread = MagicMock()
                busy_thread.is_alive.return_value = True
                host._processing_thread = busy_thread
                new_root = os.path.join(td, "new_sessions")
                self.assertFalse(host.move_session_root(new_root).get("ok"))
                host._processing_thread = None

                # Already moving
                host._move_state["status"] = "moving"
                self.assertFalse(host.move_session_root(new_root).get("ok"))

    def test_do_move_session_root_success(self):
        with tempfile.TemporaryDirectory() as td:
            old_root = os.path.join(td, "old_sessions")
            new_root = os.path.join(td, "new_sessions")
            os.makedirs(old_root, exist_ok=True)
            with open(os.path.join(old_root, "sess1.txt"), "w") as f:
                f.write("content")

            host = DummySettingsHost()
            host._do_move_session_root(old_root, new_root)
            status = host.get_session_move_status()
            self.assertEqual(status["status"], "done")
            self.assertTrue(os.path.isdir(new_root))
            self.assertTrue(os.path.exists(os.path.join(new_root, "sess1.txt")))


class TestMediaController(unittest.TestCase):
    def test_validate_media_path(self):
        with tempfile.TemporaryDirectory() as td:
            valid_mp3 = os.path.join(td, "test.mp3")
            with open(valid_mp3, "wb") as f:
                f.write(b"fake mp3 data")

            valid_txt = os.path.join(td, "test.txt")
            with open(valid_txt, "w") as f:
                f.write("text")

            # Nonexistent
            ok, _err, _dur = MediaControllerMixin._validate_media_path(
                os.path.join(td, "nonexistent.mp3")
            )
            self.assertFalse(ok)

            # Unsupported ext
            ok, _err, _dur = MediaControllerMixin._validate_media_path(valid_txt)
            self.assertFalse(ok)

            # Valid media without duration check
            ok, _err, _dur = MediaControllerMixin._validate_media_path(
                valid_mp3, require_duration=False
            )
            self.assertTrue(ok)

            # Valid media with duration check
            with patch(
                "el_sbobinator.services.audio_service.probe_media_duration",
                return_value=(42.0, None),
            ):
                ok, _err, dur = MediaControllerMixin._validate_media_path(
                    valid_mp3, require_duration=True
                )
                self.assertTrue(ok)
                self.assertEqual(dur, 42.0)

    def test_ask_files_no_window(self):
        host = DummyMediaHost(window=None)
        self.assertEqual(host.ask_files(), [])
        self.assertIsNone(host.ask_media_file())

    def test_ask_files_with_dialog(self):
        with tempfile.TemporaryDirectory() as td:
            f1 = os.path.join(td, "a.mp3")
            with open(f1, "w") as f:
                f.write("test")

            win = MagicMock()
            win.create_file_dialog.return_value = [f1]
            host = DummyMediaHost(window=win)

            with patch(
                "el_sbobinator.services.audio_service.probe_media_duration",
                return_value=(10.0, None),
            ):
                res = host.ask_files()
                self.assertEqual(len(res), 1)
                self.assertEqual(res[0]["path"], f1)

                single = host.ask_media_file()
                self.assertIsNotNone(single)
                assert single is not None
                self.assertEqual(single["path"], f1)

    def test_check_path_exists(self):
        host = DummyMediaHost()
        self.assertFalse(host.check_path_exists("/nonexistent/file")["exists"])


class TestHtmlController(unittest.TestCase):
    def test_read_html_content_invalid_extension(self):
        host = DummyHtmlHost()
        res = host.read_html_content("document.pdf")
        self.assertFalse(res.get("ok"))
        self.assertIn(".html", res.get("error", ""))

    def test_read_html_content_valid(self):
        with tempfile.TemporaryDirectory() as td:
            session_root = os.path.join(td, "sessions")
            os.makedirs(session_root, exist_ok=True)
            html_file = os.path.join(session_root, "test.html")
            with open(html_file, "w", encoding="utf-8") as f:
                f.write("<html><body><h1>Hello</h1></body></html>")

            host = DummyHtmlHost(session_root=session_root)
            res = host.read_html_content(html_file)
            self.assertTrue(res.get("ok"))
            self.assertIn("Hello", res.get("content", ""))


if __name__ == "__main__":
    unittest.main()
