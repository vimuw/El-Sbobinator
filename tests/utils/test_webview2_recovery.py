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

            with patch.dict(sys.modules, {"winreg": mock_winreg}):
                self.assertTrue(has_webview2_runtime())

    def test_has_webview2_runtime_windows_not_found(self):
        with patch.object(sys, "platform", "win32"):
            mock_winreg = MagicMock()
            mock_winreg.OpenKey.side_effect = OSError("Key not found")

            with patch.dict(sys.modules, {"winreg": mock_winreg}):
                self.assertFalse(has_webview2_runtime())

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


if __name__ == "__main__":
    unittest.main()
