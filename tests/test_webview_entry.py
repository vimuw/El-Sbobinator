import io
import logging
import os
import tempfile
import threading
import time
import unittest
from unittest.mock import MagicMock, patch

from el_sbobinator.utils.logging_utils import LOGGER_NAME, get_logger
from el_sbobinator.webview_entry import (
    _MAX_CONSOLE_LINE_LEN,
    _ConsoleTee,
    build_close_handler,
    main,
)


class WindowlessStartupLoggingTests(unittest.TestCase):
    def test_main_keeps_logger_records_out_of_ui_console_without_native_console(self):
        logger = logging.getLogger(LOGGER_NAME)
        api = MagicMock()
        with (
            tempfile.TemporaryDirectory() as directory,
            patch.object(logger, "handlers", []),
            patch.dict(logger.__dict__, {"_el_sbobinator_configured": False}),
            patch("el_sbobinator.utils.logging_utils._STARTUP_PREPARED", False),
            patch("el_sbobinator.utils.logging_utils.install_exception_hooks"),
            patch(
                "el_sbobinator.services.config_service.get_config_dir",
                return_value=directory,
            ),
            patch("el_sbobinator.app_webview.ElSbobinatorApi", return_value=api),
            patch(
                "el_sbobinator.webview_entry.get_dist_path",
                side_effect=RuntimeError("stop before native window"),
            ),
            patch("sys.stdout", None),
            patch("sys.stderr", None),
            patch("sys.__stdout__", None),
            patch("sys.__stderr__", None),
        ):
            try:
                with self.assertRaisesRegex(RuntimeError, "stop before native window"):
                    main()
                with patch.object(logging.Handler, "handleError") as error:
                    get_logger().info("Elaborazione avviata.")
                    error.assert_not_called()
                lines = [call.args[0] for call in api._push_console.call_args_list]
                self.assertFalse(any("Elaborazione avviata." in line for line in lines))
                self.assertFalse(any("Logging error" in line for line in lines))
                with open(
                    os.path.join(directory, "el_sbobinator.log"), encoding="utf-8"
                ) as handle:
                    content = handle.read()
                self.assertIn("Avvio interfaccia:", content)
                self.assertIn("Elaborazione avviata.", content)
            finally:
                for handler in logger.handlers:
                    handler.close()

    def test_main_sends_logger_records_to_native_terminal_not_ui_console(self):
        logger = logging.getLogger(LOGGER_NAME)
        api = MagicMock()
        terminal = io.StringIO()
        with (
            tempfile.TemporaryDirectory() as directory,
            patch.object(logger, "handlers", []),
            patch.dict(logger.__dict__, {"_el_sbobinator_configured": False}),
            patch("el_sbobinator.utils.logging_utils._STARTUP_PREPARED", False),
            patch("el_sbobinator.utils.logging_utils.install_exception_hooks"),
            patch(
                "el_sbobinator.services.config_service.get_config_dir",
                return_value=directory,
            ),
            patch("el_sbobinator.app_webview.ElSbobinatorApi", return_value=api),
            patch(
                "el_sbobinator.webview_entry.get_dist_path",
                side_effect=RuntimeError("stop before native window"),
            ),
            patch("sys.stdout", terminal),
            patch("sys.stderr", io.StringIO()),
            patch("sys.__stdout__", terminal),
            patch("sys.__stderr__", io.StringIO()),
        ):
            try:
                with self.assertRaisesRegex(RuntimeError, "stop before native window"):
                    main()
                get_logger().info("Elaborazione avviata.")
                print("[*] Riga di avanzamento")
                lines = [call.args[0] for call in api._push_console.call_args_list]
                self.assertIn("[*] Riga di avanzamento", lines)
                self.assertFalse(any("Elaborazione avviata." in line for line in lines))
                self.assertEqual(terminal.getvalue().count("Elaborazione avviata."), 1)
            finally:
                for handler in logger.handlers:
                    handler.close()


class StartupWindowTests(unittest.TestCase):
    def test_missing_window_stops_startup_and_closes_any_startup_server(self):
        for runtime_available in (True, False):
            with self.subTest(runtime_available=runtime_available):
                api = MagicMock()
                server = MagicMock()
                monitor = MagicMock()
                with (
                    patch.multiple(
                        "el_sbobinator.webview_entry",
                        prepare_startup=MagicMock(),
                        configure_logging=MagicMock(),
                        get_dist_path=MagicMock(return_value="dist"),
                        has_webview2_runtime=MagicMock(return_value=runtime_available),
                        _clear_webview2_cache=MagicMock(),
                        _get_window_position=MagicMock(return_value={}),
                        _boot_bg_color=MagicMock(return_value="#191919"),
                        build_missing_webview2_html=MagicMock(return_value="recovery"),
                        DesktopStartupServer=MagicMock(return_value=server),
                        _start_webview2_monitor=monitor,
                    ),
                    patch(
                        "el_sbobinator.app_webview.ElSbobinatorApi", return_value=api
                    ),
                    patch("sys.stdout", io.StringIO()),
                    patch("sys.stderr", io.StringIO()),
                    patch("sys.__stdout__", io.StringIO()),
                    patch("sys.__stderr__", io.StringIO()),
                    patch("el_sbobinator.webview_entry.os.makedirs"),
                    patch(
                        "el_sbobinator.webview_entry.webview.create_window",
                        return_value=None,
                    ),
                    patch("el_sbobinator.webview_entry.webview.start") as start,
                ):
                    with self.assertRaisesRegex(
                        RuntimeError, "Impossibile creare la finestra"
                    ):
                        main()
                api.set_window.assert_not_called()
                start.assert_not_called()
                monitor.assert_not_called()
                if runtime_available:
                    server.close.assert_called_once()
                else:
                    server.close.assert_not_called()


class ConsoleTeeTests(unittest.TestCase):
    def test_console_tee_writes_to_original(self):
        original = io.StringIO()
        api = MagicMock()
        tee = _ConsoleTee(original, api)

        tee.write("Hello World\n")

        self.assertEqual(original.getvalue(), "Hello World\n")
        api._push_console.assert_called_once_with("Hello World")

    def test_console_tee_ignores_empty_or_whitespace_only(self):
        original = io.StringIO()
        api = MagicMock()
        tee = _ConsoleTee(original, api)

        tee.write("   \n")

        self.assertEqual(original.getvalue(), "   \n")
        api._push_console.assert_not_called()

    def test_console_tee_redacts_api_key(self):
        original = io.StringIO()
        api = MagicMock()
        tee = _ConsoleTee(original, api)

        # Gemini API Key (starts with AIzaSy)
        key = "AIzaSyFakeKey1234567890123"
        tee.write(f"Error: invalid key: {key}\n")

        self.assertEqual(original.getvalue(), f"Error: invalid key: {key}\n")
        api._push_console.assert_called_once_with(
            "Error: invalid key: [API_KEY_REDACTED]"
        )

    def test_console_tee_redacts_before_truncating(self):
        original = io.StringIO()
        api = MagicMock()
        tee = _ConsoleTee(original, api)

        # Create a line that is longer than _MAX_CONSOLE_LINE_LEN.
        # Place an API key well before the truncation limit, but extend the line
        # with extra text so that it gets truncated.
        prefix = "x" * 1000 + " "
        key = "AIzaSyFakeKey1234567890123"
        suffix = " " + "y" * 1100
        long_line = prefix + key + suffix

        tee.write(long_line + "\n")

        # Get the argument passed to _push_console
        api._push_console.assert_called_once()
        pushed_text = api._push_console.call_args[0][0]

        # Verify that the API key was redacted, NOT truncated/leaked
        self.assertNotIn("AIzaSy", pushed_text)
        self.assertIn("[API_KEY_REDACTED]", pushed_text)
        self.assertTrue(pushed_text.endswith("\u2026 [troncato]"))


class CloseHandlerTests(unittest.TestCase):
    def test_runtime_recovery_closes_without_javascript_and_stops_monitor(self):
        api = MagicMock()
        window = MagicMock()
        window.evaluate_js.side_effect = RuntimeError("MSHTML cannot run async JS")
        stop_event = MagicMock()
        handler = build_close_handler(
            api, window, stop_event, require_editor_save=False
        )
        with (
            patch("el_sbobinator.webview_entry.threading.Thread") as worker,
            patch(
                "el_sbobinator.webview_entry.LocalMediaServer.shutdown_all"
            ) as shutdown,
        ):
            self.assertIsNone(handler())
            stop_event.set.assert_called_once()
            api._audio_cancel_event.set.assert_called_once()
            shutdown.assert_called_once()
            worker.assert_not_called()
            window.evaluate_js.assert_not_called()
            api.is_busy.assert_not_called()

    def test_native_close_waits_for_editor_save_without_blocking_ui(self):
        api = MagicMock()
        api.is_busy.return_value = False
        api._force_close = False
        window = MagicMock()
        stop_event = MagicMock()
        window.create_confirmation_dialog.return_value = False
        handler = build_close_handler(api, window, stop_event)
        window.evaluate_js.side_effect = lambda script, callback: callback(False)
        with patch("el_sbobinator.webview_entry.threading.Thread") as worker:
            self.assertIs(handler(), False)
            stop_event.set.assert_not_called()
            window.destroy.assert_not_called()
            worker.call_args.kwargs["target"]()
            self.assertIn(
                "__elSbobinatorFlushPendingAutosave",
                window.evaluate_js.call_args.args[0],
            )
            window.destroy.assert_not_called()
            api._audio_cancel_event.set.assert_not_called()
            window.evaluate_js.side_effect = lambda script, callback: callback(True)
            self.assertIs(handler(), False)
            worker.call_args.kwargs["target"]()
            window.destroy.assert_called_once()
            with patch("el_sbobinator.webview_entry.LocalMediaServer.shutdown_all"):
                self.assertIsNone(handler())
                stop_event.set.assert_called_once()

    def test_repeated_native_close_does_not_start_overlapping_flushes(self):
        api = MagicMock()
        api.is_busy.return_value = False
        api._force_close = False
        window = MagicMock()
        handler = build_close_handler(api, window)
        with patch("el_sbobinator.webview_entry.threading.Thread") as worker:
            self.assertIs(handler(), False)
            self.assertIs(handler(), False)
            worker.assert_called_once()

    def test_native_close_keeps_window_when_bridge_evaluation_fails(self):
        api = MagicMock()
        api.is_busy.return_value = False
        api._force_close = False
        window = MagicMock()
        window.evaluate_js.side_effect = RuntimeError("Bridge unavailable")
        window.create_confirmation_dialog.return_value = False
        handler = build_close_handler(api, window)
        with patch("el_sbobinator.webview_entry.threading.Thread") as worker:
            self.assertIs(handler(), False)
            worker.call_args.kwargs["target"]()
            window.destroy.assert_not_called()
            self.assertIs(handler(), False)
            self.assertEqual(worker.call_count, 2)

    def test_failed_save_lets_the_user_close_anyway_after_confirmation(self):
        api = MagicMock()
        api.is_busy.return_value = False
        api._force_close = False
        window = MagicMock()
        stop_event = MagicMock()
        handler = build_close_handler(api, window, stop_event)
        window.evaluate_js.side_effect = lambda script, callback: callback(False)
        window.create_confirmation_dialog.side_effect = RuntimeError("Dialog failed")
        with patch("el_sbobinator.webview_entry.threading.Thread") as worker:
            self.assertIs(handler(), False)
            worker.call_args.kwargs["target"]()
            window.destroy.assert_not_called()

            window.create_confirmation_dialog.side_effect = None
            window.create_confirmation_dialog.return_value = True
            self.assertIs(handler(), False)
            worker.call_args.kwargs["target"]()
            self.assertIn(
                "modifiche non salvate andranno perse",
                window.create_confirmation_dialog.call_args.args[1],
            )
            window.destroy.assert_called_once()
            with patch("el_sbobinator.webview_entry.LocalMediaServer.shutdown_all"):
                self.assertIsNone(handler())
                stop_event.set.assert_called_once()

    def test_unconfirmed_close_does_not_start_a_flush_while_asking(self):
        api = MagicMock()
        api.is_busy.return_value = False
        api._force_close = False
        window = MagicMock()
        handler = build_close_handler(api, window)
        window.evaluate_js.side_effect = lambda script, callback: callback(False)

        def ask_while_user_clicks_close_again(*_args):
            self.assertIs(handler(), False)
            return False

        window.create_confirmation_dialog.side_effect = (
            ask_while_user_clicks_close_again
        )
        with patch("el_sbobinator.webview_entry.threading.Thread") as worker:
            self.assertIs(handler(), False)
            worker.call_args.kwargs["target"]()
            worker.assert_called_once()
            window.destroy.assert_not_called()
            self.assertIs(handler(), False)
            self.assertEqual(worker.call_count, 2)

    def test_hung_renderer_times_out_and_still_lets_the_user_close(self):
        api = MagicMock()
        api.is_busy.return_value = False
        api._force_close = False
        window = MagicMock()
        stop_event = MagicMock()
        release = threading.Event()
        window.evaluate_js.side_effect = lambda script, callback: release.wait(5)
        window.create_confirmation_dialog.return_value = True
        handler = build_close_handler(api, window, stop_event)
        waits: list[float] = []
        real_wait = threading.Event.wait

        def short_wait(event, timeout=None):
            if timeout == 10:
                waits.append(timeout)
                timeout = 0.05
            return real_wait(event, timeout)

        try:
            with (
                patch("el_sbobinator.webview_entry.threading.Thread") as worker,
                patch.object(threading.Event, "wait", short_wait),
                patch(
                    "el_sbobinator.webview_entry.LocalMediaServer.shutdown_all"
                ) as shutdown,
            ):
                self.assertIs(handler(), False)
                started = time.monotonic()
                worker.call_args.kwargs["target"]()
                self.assertLess(time.monotonic() - started, 2)
                self.assertEqual(waits, [10])
                window.evaluate_js.assert_called_once()
                window.create_confirmation_dialog.assert_called_once()
                window.destroy.assert_called_once()
                stop_event.set.assert_called_once()
                shutdown.assert_called_once()
        finally:
            release.set()

    def test_close_before_bridge_loads_skips_save_warning(self):
        api = MagicMock()
        api.is_busy.return_value = False
        api._force_close = False
        window = MagicMock()
        window.events._pywebviewready.is_set.return_value = False
        handler = build_close_handler(api, window)
        with (
            patch("el_sbobinator.webview_entry.threading.Thread") as worker,
            patch("el_sbobinator.webview_entry.LocalMediaServer.shutdown_all"),
        ):
            self.assertIs(handler(), False)
            worker.call_args.kwargs["target"]()
            window.evaluate_js.assert_not_called()
            window.create_confirmation_dialog.assert_not_called()
            window.destroy.assert_called_once()

    def test_saved_close_stops_runtime_without_a_second_closing_event(self):
        api = MagicMock()
        api.is_busy.return_value = False
        api._force_close = False
        window = MagicMock()
        stop_event = MagicMock()
        handler = build_close_handler(api, window, stop_event)
        window.evaluate_js.side_effect = lambda script, callback: callback(True)
        order: list[str] = []
        stop_event.set.side_effect = lambda: order.append("stop")
        window.destroy.side_effect = lambda: order.append("destroy")
        with (
            patch("el_sbobinator.webview_entry.threading.Thread") as worker,
            patch(
                "el_sbobinator.webview_entry.LocalMediaServer.shutdown_all"
            ) as shutdown,
        ):
            self.assertIs(handler(), False)
            worker.call_args.kwargs["target"]()
            self.assertEqual(order, ["stop", "destroy"])
            api._audio_cancel_event.set.assert_called_once()
            shutdown.assert_called_once()
            self.assertIsNone(handler())
            stop_event.set.assert_called_once()
            shutdown.assert_called_once()

    def test_close_when_not_busy(self):
        api = MagicMock()
        api.is_busy.return_value = False
        api._force_close = False
        window = MagicMock()
        stop_event = MagicMock()

        handler = build_close_handler(api, window, stop_event)

        with (
            patch("el_sbobinator.webview_entry.threading.Thread") as worker,
            patch(
                "el_sbobinator.webview_entry.LocalMediaServer.shutdown_all"
            ) as mock_shutdown,
        ):
            result = handler()
            self.assertIs(result, False)
            window.evaluate_js.side_effect = lambda script, callback: callback(True)
            worker.call_args.kwargs["target"]()
            self.assertIsNone(handler())
            window.create_confirmation_dialog.assert_not_called()
            stop_event.set.assert_called_once()
            mock_shutdown.assert_called_once()

    def test_close_when_force_close_true(self):
        api = MagicMock()
        api.is_busy.return_value = True
        api._force_close = True
        window = MagicMock()
        stop_event = MagicMock()

        handler = build_close_handler(api, window, stop_event)

        with (
            patch("el_sbobinator.webview_entry.threading.Thread") as worker,
            patch(
                "el_sbobinator.webview_entry.LocalMediaServer.shutdown_all"
            ) as mock_shutdown,
        ):
            result = handler()
            self.assertIs(result, False)
            window.evaluate_js.side_effect = lambda script, callback: callback(True)
            worker.call_args.kwargs["target"]()
            self.assertIsNone(handler())
            window.create_confirmation_dialog.assert_not_called()
            stop_event.set.assert_called_once()
            mock_shutdown.assert_called_once()

    def test_close_when_busy_emits_request_quit_confirmation(self):
        api = MagicMock()
        api.is_busy.return_value = True
        api._force_close = False
        window = MagicMock()
        api._adapter = MagicMock()
        api._adapter.window = window
        stop_event = MagicMock()

        handler = build_close_handler(api, window, stop_event)

        with patch(
            "el_sbobinator.webview_entry.LocalMediaServer.shutdown_all"
        ) as mock_shutdown:
            result = handler()
            self.assertFalse(result)
            api._adapter.emit.assert_called_once_with(
                "requestQuitConfirmation", {}, batched=False
            )
            window.create_confirmation_dialog.assert_not_called()
            api.request_shutdown.assert_not_called()
            stop_event.set.assert_not_called()
            mock_shutdown.assert_not_called()

    def test_close_when_busy_fallback_to_dialog_cancel(self):
        api = MagicMock()
        api.is_busy.return_value = True
        api._force_close = False
        api._adapter = None
        window = MagicMock()
        window.create_confirmation_dialog.return_value = False
        stop_event = MagicMock()

        handler = build_close_handler(api, window, stop_event)

        with patch(
            "el_sbobinator.webview_entry.LocalMediaServer.shutdown_all"
        ) as mock_shutdown:
            result = handler()
            self.assertFalse(result)
            window.create_confirmation_dialog.assert_called_once()
            api.request_shutdown.assert_not_called()
            stop_event.set.assert_not_called()
            mock_shutdown.assert_not_called()

    def test_close_when_busy_fallback_to_dialog_confirm(self):
        api = MagicMock()
        api.is_busy.return_value = True
        api._force_close = False
        api._adapter = None
        window = MagicMock()
        window.create_confirmation_dialog.return_value = True
        stop_event = MagicMock()

        handler = build_close_handler(api, window, stop_event)

        with (
            patch("el_sbobinator.webview_entry.threading.Thread") as worker,
            patch(
                "el_sbobinator.webview_entry.LocalMediaServer.shutdown_all"
            ) as mock_shutdown,
        ):
            result = handler()
            self.assertIs(result, False)
            window.evaluate_js.side_effect = lambda script, callback: callback(True)
            worker.call_args.kwargs["target"]()
            self.assertIsNone(handler())
            window.create_confirmation_dialog.assert_called_once()
            api.request_shutdown.assert_called_once_with(timeout=1.5)
            stop_event.set.assert_called_once()
            mock_shutdown.assert_called_once()

    def test_close_when_busy_dialog_exception_fallback(self):
        api = MagicMock()
        api.is_busy.return_value = True
        api._force_close = False
        api._adapter = None
        window = MagicMock()
        window.create_confirmation_dialog.side_effect = RuntimeError("Dialog failed")
        stop_event = MagicMock()

        handler = build_close_handler(api, window, stop_event)

        with (
            patch("el_sbobinator.webview_entry.threading.Thread") as worker,
            patch(
                "el_sbobinator.webview_entry.LocalMediaServer.shutdown_all"
            ) as mock_shutdown,
        ):
            result = handler()
            self.assertIs(result, False)
            window.evaluate_js.side_effect = lambda script, callback: callback(True)
            worker.call_args.kwargs["target"]()
            self.assertIsNone(handler())
            api.request_shutdown.assert_called_once_with(timeout=1.5)
            stop_event.set.assert_called_once()
            mock_shutdown.assert_called_once()


class WebuiCspTests(unittest.TestCase):
    def test_webui_csp_allows_pywebview_bridge(self):
        """Verify webui/index.html CSP permits pywebview's dynamic API bridge construction on macOS/WebKit."""
        from pathlib import Path

        root = Path(__file__).resolve().parent.parent
        index_html = root / "webui" / "index.html"
        self.assertTrue(index_html.exists(), "webui/index.html must exist")
        content = index_html.read_text(encoding="utf-8")

        self.assertIn("Content-Security-Policy", content)
        # pywebview uses new Function(...) in api.js to expose Python bridge methods to React.
        # Without 'unsafe-eval', WebKit (macOS) raises an EvalError and completely breaks the bridge.
        self.assertIn("'unsafe-eval'", content)
        self.assertIn("'unsafe-inline'", content)


if __name__ == "__main__":
    unittest.main()
