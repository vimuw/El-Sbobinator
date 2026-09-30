from __future__ import annotations

import os
import shutil
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import MagicMock, patch

from el_sbobinator.utils.webview2_recovery import (
    _check_webview2_filesystem,
    _check_webview2_native,
    _check_webview2_registry,
    build_missing_webview2_html,
    clear_webview2_cache,
    get_boot_bg_color,
    has_webview2_runtime,
    start_webview2_monitor,
)


class Webview2RecoveryTests(unittest.TestCase):
    def test_has_webview2_runtime_non_windows(self):
        with patch.object(sys, "platform", "linux"):
            self.assertTrue(has_webview2_runtime())

    def test_has_webview2_runtime_windows_found(self):
        with patch.object(sys, "platform", "win32"):
            mock_winreg = MagicMock()
            mock_key = MagicMock()
            mock_winreg.OpenKey.return_value.__enter__.return_value = mock_key
            mock_winreg.QueryValueEx.return_value = ("120.0.2210.144", 1)

            with (
                patch.dict(sys.modules, {"winreg": mock_winreg}),
                patch(
                    "el_sbobinator.utils.webview2_recovery._check_webview2_native",
                    return_value=False,
                ),
            ):
                self.assertTrue(has_webview2_runtime())

    def test_has_webview2_runtime_windows_not_found(self):
        with patch.object(sys, "platform", "win32"):
            mock_winreg = MagicMock()
            mock_winreg.OpenKey.side_effect = OSError("Key not found")

            with (
                patch.dict(sys.modules, {"winreg": mock_winreg}),
                patch(
                    "el_sbobinator.utils.webview2_recovery._check_webview2_native",
                    return_value=False,
                ),
                patch(
                    "el_sbobinator.utils.webview2_recovery._check_webview2_filesystem",
                    return_value=False,
                ),
            ):
                self.assertFalse(has_webview2_runtime())

    def test_has_webview2_runtime_native_detected(self):
        with (
            patch.object(sys, "platform", "win32"),
            patch(
                "el_sbobinator.utils.webview2_recovery._check_webview2_native",
                return_value=True,
            ),
        ):
            self.assertTrue(has_webview2_runtime())

    def test_check_webview2_native_when_already_chromium(self):
        mock_platforms = MagicMock()
        mock_wf = MagicMock()
        mock_wf.is_chromium = True
        mock_platforms.winforms = mock_wf
        with patch.dict(
            sys.modules,
            {
                "webview.platforms": mock_platforms,
                "webview.platforms.winforms": mock_wf,
            },
        ):
            self.assertTrue(_check_webview2_native())

    def test_check_webview2_native_activates_edgechromium_fallback(self):
        mock_platforms = MagicMock()
        mock_wf = MagicMock()
        mock_wf.is_chromium = False
        mock_chromium = MagicMock()
        mock_chromium.CoreWebView2Environment.GetAvailableBrowserVersionString.return_value = "120.0.2210.144"
        mock_platforms.winforms = mock_wf
        mock_platforms.edgechromium = mock_chromium
        with (
            patch.dict(
                sys.modules,
                {
                    "webview.platforms": mock_platforms,
                    "webview.platforms.winforms": mock_wf,
                    "webview.platforms.edgechromium": mock_chromium,
                },
            ),
        ):
            self.assertTrue(_check_webview2_native())
            self.assertTrue(mock_wf.is_chromium)
            self.assertEqual(mock_wf.Chromium, mock_chromium)

    def test_check_webview2_native_handles_import_error(self):
        with patch.dict(sys.modules, {"webview.platforms.winforms": None}):
            self.assertFalse(_check_webview2_native())

    def test_check_webview2_filesystem_scans_and_finds_dll(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            dll_dir = os.path.join(tmpdir, "154.0.4258.37", "EBWebView", "x64")
            os.makedirs(dll_dir, exist_ok=True)
            dll_file = os.path.join(dll_dir, "EmbeddedBrowserWebView.dll")
            with open(dll_file, "wb") as f:
                f.write(b"MZfakebinary")
            self.assertTrue(_check_webview2_filesystem(extra_dirs=(tmpdir,)))

    def test_check_webview2_registry_uninstall_key_detected(self):
        mock_winreg = MagicMock()

        # EdgeUpdate open fails, Uninstall open succeeds
        def fake_open_key(root, branch, reserved, flag):
            if "Uninstall" in branch:
                key = MagicMock()
                return key.__enter__.return_value
            raise OSError("Key not found")

        mock_winreg.OpenKey.side_effect = fake_open_key
        mock_winreg.QueryValueEx.return_value = ("120.0.2210.144", 1)

        with patch.dict(sys.modules, {"winreg": mock_winreg}):
            self.assertTrue(_check_webview2_registry())

    def test_check_webview2_registry_import_error(self):
        with patch.dict(sys.modules, {"winreg": None}):
            self.assertFalse(_check_webview2_registry())

    def test_check_webview2_filesystem_default_env_vars(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            app_dir = os.path.join(
                tmpdir, "Microsoft", "EdgeWebView", "Application", "154.0.4258.37"
            )
            os.makedirs(app_dir, exist_ok=True)
            exe_file = os.path.join(app_dir, "msedgewebview2.exe")
            with open(exe_file, "wb") as f:
                f.write(b"fake")

            with patch.dict(
                os.environ,
                {"LOCALAPPDATA": tmpdir, "ProgramFiles": "", "ProgramFiles(x86)": ""},
            ):
                self.assertTrue(_check_webview2_filesystem())

    def test_check_webview2_filesystem_scandir_exception(self):
        with (
            patch("os.path.isdir", return_value=True),
            patch("os.scandir", side_effect=OSError("Boom")),
        ):
            self.assertFalse(_check_webview2_filesystem(extra_dirs=("/fake/dir",)))

    def test_has_webview2_runtime_filesystem_fallback_detected(self):
        with (
            patch.object(sys, "platform", "win32"),
            patch(
                "el_sbobinator.utils.webview2_recovery._check_webview2_native",
                return_value=False,
            ),
            patch(
                "el_sbobinator.utils.webview2_recovery._check_webview2_registry",
                return_value=False,
            ),
            patch(
                "el_sbobinator.utils.webview2_recovery._check_webview2_filesystem",
                return_value=True,
            ),
        ):
            self.assertTrue(has_webview2_runtime())

    def test_check_webview2_filesystem_scans_and_finds_exe(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            ver_dir = os.path.join(tmpdir, "154.0.4258.37")
            os.makedirs(ver_dir, exist_ok=True)
            exe_file = os.path.join(ver_dir, "msedgewebview2.exe")
            with open(exe_file, "wb") as f:
                f.write(b"MZfakebinary")

            self.assertTrue(_check_webview2_filesystem(extra_dirs=(tmpdir,)))

    def test_check_webview2_filesystem_empty_dir_returns_false(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            self.assertFalse(_check_webview2_filesystem(extra_dirs=(tmpdir,)))

    def test_build_missing_webview2_html(self):
        html = build_missing_webview2_html()
        self.assertIn("<!doctype html>", html)
        self.assertIn("Serve WebView2", html)
        self.assertIn("status-box", html)
        self.assertIn("status-dot", html)
        self.assertIn("Scarica WebView2 Runtime", html)
        self.assertIn('target="_blank"', html)
        self.assertIn('rel="noopener noreferrer"', html)

    def test_get_boot_bg_color_from_theme_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            theme_file = os.path.join(tmpdir, "theme.txt")
            with patch(
                "el_sbobinator.services.config_service.THEME_PREF_FILE", theme_file
            ):
                with open(theme_file, "w", encoding="utf-8") as f:
                    f.write("dark")
                self.assertEqual(get_boot_bg_color(), "#191919")

                with open(theme_file, "w", encoding="utf-8") as f:
                    f.write("light")
                self.assertEqual(get_boot_bg_color(), "#f7f6f3")

    def test_get_boot_bg_color_windows_os_theme(self):
        with patch.object(sys, "platform", "win32"):
            with patch(
                "el_sbobinator.services.config_service.THEME_PREF_FILE",
                "/nonexistent/theme.txt",
            ):
                mock_winreg = MagicMock()
                mock_key = MagicMock()
                mock_winreg.OpenKey.return_value.__enter__.return_value = mock_key
                mock_winreg.QueryValueEx.return_value = (0, 4)  # Dark mode

                with patch.dict(sys.modules, {"winreg": mock_winreg}):
                    self.assertEqual(get_boot_bg_color(), "#191919")

                mock_winreg.QueryValueEx.return_value = (1, 4)  # Light mode
                with patch.dict(sys.modules, {"winreg": mock_winreg}):
                    self.assertEqual(get_boot_bg_color(), "#f7f6f3")

    def test_get_boot_bg_color_darwin_os_theme(self):
        with patch.object(sys, "platform", "darwin"):
            with patch(
                "el_sbobinator.services.config_service.THEME_PREF_FILE",
                "/nonexistent/theme.txt",
            ):
                mock_res = MagicMock()
                mock_res.stdout = "Dark\n"
                with patch("subprocess.run", return_value=mock_res):
                    self.assertEqual(get_boot_bg_color(), "#191919")

    def test_clear_webview2_cache(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            storage_dir = os.path.join(tmpdir, "storage")
            os.makedirs(storage_dir, exist_ok=True)
            dist_file = os.path.join(tmpdir, "dist", "index.html")
            os.makedirs(os.path.dirname(dist_file), exist_ok=True)
            with open(dist_file, "w", encoding="utf-8") as f:
                f.write("<html></html>")

            cache_dir = os.path.join(storage_dir, "EBWebView", "Default", "Cache")
            os.makedirs(cache_dir, exist_ok=True)
            test_cached_file = os.path.join(cache_dir, "cached.data")
            with open(test_cached_file, "w") as f:
                f.write("cached data")

            # First run: should clear cache because .build_mtime did not exist
            clear_webview2_cache(storage_dir, dist_file)
            self.assertFalse(os.path.exists(cache_dir))
            self.assertTrue(os.path.exists(os.path.join(storage_dir, ".build_mtime")))

            # Recreate cache and run again: mtime unchanged, so should NOT clear
            os.makedirs(cache_dir, exist_ok=True)
            with open(test_cached_file, "w") as f:
                f.write("cached data 2")
            clear_webview2_cache(storage_dir, dist_file)
            self.assertTrue(os.path.exists(cache_dir))

    def test_clear_webview2_cache_failure_handled(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            storage_dir = os.path.join(tmpdir, "storage")
            cache_dir = os.path.join(storage_dir, "EBWebView", "Default", "Cache")
            os.makedirs(cache_dir, exist_ok=True)
            dist_file = os.path.join(tmpdir, "dist", "index.html")
            os.makedirs(os.path.dirname(dist_file), exist_ok=True)
            with open(dist_file, "w") as f:
                f.write("test")

            with patch("shutil.rmtree", side_effect=OSError("Access denied")):
                # Should not raise
                clear_webview2_cache(storage_dir, dist_file)

    def test_start_webview2_monitor_stops_on_event(self):
        stop_event = threading.Event()
        mock_window = MagicMock()
        with patch(
            "el_sbobinator.utils.webview2_recovery.has_webview2_runtime",
            return_value=False,
        ):
            start_webview2_monitor(mock_window, stop_event)
            time.sleep(0.05)
            stop_event.set()
            time.sleep(0.05)
            # Thread should terminate cleanly without raising

    def test_start_webview2_monitor_triggers_restart_when_runtime_detected(self):
        stop_event = threading.Event()
        mock_window = MagicMock()

        with (
            patch.object(stop_event, "wait", return_value=False),
            patch(
                "el_sbobinator.utils.webview2_recovery.has_webview2_runtime",
                return_value=True,
            ),
            patch("subprocess.Popen") as mock_popen,
            patch("os._exit", side_effect=lambda code: stop_event.set()) as mock_exit,
        ):
            start_webview2_monitor(mock_window, stop_event)
            time.sleep(0.08)
            mock_window.evaluate_js.assert_called_once()
            mock_popen.assert_called_once()
            mock_window.destroy.assert_called_once()
            mock_exit.assert_called_once_with(0)


if __name__ == "__main__":
    unittest.main()
