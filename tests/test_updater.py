import hashlib
import io
import os
import ssl
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, call, mock_open, patch

from el_sbobinator.core.updater import _verify_sha256, download_and_install_update


class UpdaterTests(unittest.TestCase):
    # ------------------------------------------------------------------
    # Input validation
    # ------------------------------------------------------------------

    def test_empty_string_version_returns_error(self):
        result = download_and_install_update("")
        self.assertFalse(result["ok"])
        self.assertIn("Versione", result["error"])

    def test_none_version_returns_error(self):
        result = download_and_install_update(None)  # type: ignore[arg-type]
        self.assertFalse(result["ok"])

    def test_malformed_version_returns_error(self):
        for bad in ("../../etc/passwd", "1.2", "1.2.3.4", "v1.2.x", " 1.2.3"):
            with self.subTest(version=bad):
                result = download_and_install_update(bad)
                self.assertFalse(result["ok"])
                self.assertIn("Versione", result["error"])

    def test_version_v_prefix_stripped_in_filename(self):
        """Both 'v1.2.3' and '1.2.3' must produce filename 'Setup-v1.2.3.exe'."""

        class _FakeResp:
            def read(self, n):
                return b""

            def __enter__(self):
                return self

            def __exit__(self, *a):
                pass

        for version in ("v1.2.3", "1.2.3"):
            with self.subTest(version=version):
                with (
                    patch.object(sys, "platform", "win32"),
                    patch(
                        "urllib.request.urlopen", return_value=_FakeResp()
                    ) as mock_urlopen,
                    patch("builtins.open", mock_open()),
                    patch(
                        "el_sbobinator.core.updater._verify_sha256", return_value=None
                    ),
                    patch("os.startfile", create=True),
                    patch("threading.Thread"),
                    patch("tempfile.NamedTemporaryFile") as mock_tmp,
                ):
                    mock_tmp.return_value.__enter__.return_value.name = "/tmp/setup.exe"
                    mock_tmp.return_value.__exit__.return_value = False
                    download_and_install_update(version)
                    url = mock_urlopen.call_args[0][0]

                self.assertIn("1.2.3", url)
                self.assertNotIn("vv", url)
                self.assertIn("Setup-v1.2.3.exe", url)

    # ------------------------------------------------------------------
    # Unsupported platform
    # ------------------------------------------------------------------

    def test_unsupported_platform_returns_error(self):
        with patch.object(sys, "platform", "linux"):
            result = download_and_install_update("1.0.0")
        self.assertFalse(result["ok"])
        self.assertIn("linux", result["error"])

    # ------------------------------------------------------------------
    # Download failure
    # ------------------------------------------------------------------

    def test_download_failure_returns_error(self):
        with (
            patch.object(sys, "platform", "win32"),
            patch("urllib.request.urlopen", side_effect=OSError("network error")),
            patch("tempfile.NamedTemporaryFile") as mock_tmp,
        ):
            mock_tmp.return_value.__enter__.return_value.name = "/tmp/setup.exe"
            mock_tmp.return_value.__exit__.return_value = False
            result = download_and_install_update("1.0.0")

        self.assertFalse(result["ok"])
        self.assertIn("Download", result["error"])

    # ------------------------------------------------------------------
    # Windows happy path
    # ------------------------------------------------------------------

    def test_windows_calls_startfile_with_exe(self):
        class _FakeResp:
            def read(self, n):
                return b""

            def __enter__(self):
                return self

            def __exit__(self, *a):
                pass

        with (
            patch.object(sys, "platform", "win32"),
            patch("urllib.request.urlopen", return_value=_FakeResp()),
            patch("builtins.open", mock_open()),
            patch("el_sbobinator.core.updater._verify_sha256", return_value=None),
            patch("os.startfile", create=True) as mock_start,
            patch("threading.Thread") as mock_thread,
            patch("tempfile.NamedTemporaryFile") as mock_tmp,
        ):
            mock_tmp.return_value.__enter__.return_value.name = "/tmp/setup.exe"
            mock_tmp.return_value.__exit__.return_value = False
            mock_thread.return_value.start.return_value = None
            result = download_and_install_update("2.0.0")

        self.assertTrue(result["ok"])
        mock_start.assert_called_once()
        called_path = mock_start.call_args[0][0]
        self.assertTrue(called_path.endswith(".exe"))

    # ------------------------------------------------------------------
    # macOS happy path
    # ------------------------------------------------------------------

    def test_macos_happy_path_calls_subprocess_sequence(self):
        import plistlib

        fake_plist = plistlib.dumps(
            {"system-entities": [{"mount-point": "/Volumes/ElSbobinator"}]}
        )

        class _FakeResp:
            def read(self, n):
                return b""

            def __enter__(self):
                return self

            def __exit__(self, *a):
                pass

        fake_proc = MagicMock()
        fake_proc.stdout = fake_plist
        fake_proc.returncode = 0

        call_names: list[str] = []

        def _fake_run(cmd, **kwargs):
            call_names.append(cmd[0])
            return fake_proc

        with (
            patch.object(sys, "platform", "darwin"),
            patch("urllib.request.urlopen", return_value=_FakeResp()),
            patch("builtins.open", mock_open()),
            patch("el_sbobinator.core.updater._verify_sha256", return_value=None),
            patch("subprocess.run", side_effect=_fake_run),
            patch("subprocess.Popen"),
            patch("threading.Thread") as mock_thread,
            patch("tempfile.NamedTemporaryFile") as mock_tmp,
            patch("os.unlink"),
        ):
            mock_tmp.return_value.__enter__.return_value.name = "/tmp/app.dmg"
            mock_tmp.return_value.__exit__.return_value = False
            mock_thread.return_value.start.return_value = None
            result = download_and_install_update("1.5.0")

        self.assertTrue(result["ok"])
        self.assertIn("hdiutil", call_names)
        self.assertIn("cp", call_names)
        self.assertIn("hdiutil", call_names)

    # ------------------------------------------------------------------
    # macOS — no mount point
    # ------------------------------------------------------------------

    # ------------------------------------------------------------------
    # macOS — cp -R permission denied
    # ------------------------------------------------------------------

    def test_macos_cp_permission_denied_returns_permission_denied_key(self):
        import plistlib

        fake_plist = plistlib.dumps(
            {"system-entities": [{"mount-point": "/Volumes/ElSbobinator"}]}
        )

        class _FakeResp:
            def read(self, n):
                return b""

            def __enter__(self):
                return self

            def __exit__(self, *a):
                pass

        attach_proc = MagicMock()
        attach_proc.stdout = fake_plist
        attach_proc.returncode = 0

        def _fake_run(cmd, **kwargs):
            if cmd[0] == "cp":
                err = subprocess.CalledProcessError(1, cmd)
                err.stderr = b"cp: /Applications/El Sbobinator.app: Permission denied"
                raise err
            return attach_proc

        with (
            patch.object(sys, "platform", "darwin"),
            patch("urllib.request.urlopen", return_value=_FakeResp()),
            patch("builtins.open", mock_open()),
            patch("el_sbobinator.core.updater._verify_sha256", return_value=None),
            patch("subprocess.run", side_effect=_fake_run),
            patch("subprocess.Popen"),
            patch("tempfile.NamedTemporaryFile") as mock_tmp,
            patch("os.unlink"),
        ):
            mock_tmp.return_value.__enter__.return_value.name = "/tmp/app.dmg"
            mock_tmp.return_value.__exit__.return_value = False
            result = download_and_install_update("1.5.0")

        self.assertFalse(result["ok"])
        self.assertEqual(result["error"], "permission_denied")

    # ------------------------------------------------------------------
    # macOS — no mount point
    # ------------------------------------------------------------------

    def test_macos_no_mount_point_returns_error(self):
        import plistlib

        fake_plist = plistlib.dumps({"system-entities": []})

        class _FakeResp:
            def read(self, n):
                return b""

            def __enter__(self):
                return self

            def __exit__(self, *a):
                pass

        fake_proc = MagicMock()
        fake_proc.stdout = fake_plist
        fake_proc.returncode = 0

        with (
            patch.object(sys, "platform", "darwin"),
            patch("urllib.request.urlopen", return_value=_FakeResp()),
            patch("builtins.open", mock_open()),
            patch("el_sbobinator.core.updater._verify_sha256", return_value=None),
            patch("subprocess.run", return_value=fake_proc),
            patch("tempfile.NamedTemporaryFile") as mock_tmp,
            patch("os.unlink"),
        ):
            mock_tmp.return_value.__enter__.return_value.name = "/tmp/app.dmg"
            mock_tmp.return_value.__exit__.return_value = False
            result = download_and_install_update("1.5.0")

        self.assertFalse(result["ok"])
        self.assertIn("DMG", result["error"])


class TestChecksumVerification(unittest.TestCase):
    def _make_resp(self, content: bytes):
        class _R:
            def read(self, n=None):
                return content

            def __enter__(self):
                return self

            def __exit__(self, *a):
                pass

        return _R()

    def _write_tmp(self, data: bytes) -> str:
        fd, path = tempfile.mkstemp()
        try:
            os.write(fd, data)
        finally:
            os.close(fd)
        return path

    def test_valid_checksum_returns_none(self):
        data = b"fake installer bytes"
        digest = hashlib.sha256(data).hexdigest()
        checksum_content = f"{digest}  El-Sbobinator-Setup-v1.0.0.exe\n".encode()
        tmp = self._write_tmp(data)
        try:
            with patch(
                "urllib.request.urlopen", return_value=self._make_resp(checksum_content)
            ):
                result = _verify_sha256(
                    tmp, "https://example.com/x.sha256", ssl.create_default_context()
                )
        finally:
            os.unlink(tmp)
        self.assertIsNone(result)

    def test_mismatched_checksum_returns_error(self):
        wrong_digest = "a" * 64
        checksum_content = f"{wrong_digest}  installer.exe\n".encode()
        tmp = self._write_tmp(b"real installer")
        try:
            with patch(
                "urllib.request.urlopen", return_value=self._make_resp(checksum_content)
            ):
                result = _verify_sha256(
                    tmp, "https://example.com/x.sha256", ssl.create_default_context()
                )
        finally:
            os.unlink(tmp)
        self.assertIsNotNone(result)
        self.assertIn("integrit", result or "")  # type: ignore[operator]

    def test_empty_checksum_content_returns_error(self):
        tmp = self._write_tmp(b"data")
        try:
            with patch("urllib.request.urlopen", return_value=self._make_resp(b"")):
                result = _verify_sha256(
                    tmp, "https://example.com/x.sha256", ssl.create_default_context()
                )
        finally:
            os.unlink(tmp)
        self.assertIsNotNone(result)
        self.assertIn("vuoto", result or "")  # type: ignore[operator]

    def test_malformed_hash_returns_error(self):
        checksum_content = b"not-a-hash  installer.exe\n"
        tmp = self._write_tmp(b"data")
        try:
            with patch(
                "urllib.request.urlopen", return_value=self._make_resp(checksum_content)
            ):
                result = _verify_sha256(
                    tmp, "https://example.com/x.sha256", ssl.create_default_context()
                )
        finally:
            os.unlink(tmp)
        self.assertIsNotNone(result)
        self.assertIn("valido", result or "")  # type: ignore[operator]

    def test_checksum_download_error_returns_error(self):
        tmp = self._write_tmp(b"data")
        try:
            with patch("urllib.request.urlopen", side_effect=OSError("timeout")):
                result = _verify_sha256(
                    tmp, "https://example.com/x.sha256", ssl.create_default_context()
                )
        finally:
            os.unlink(tmp)
        self.assertIsNotNone(result)
        self.assertIn("checksum", result or "")  # type: ignore[operator]

    def test_checksum_404_returns_none(self):
        """A 404 on the .sha256 file means the release predates checksum support — skip verification."""
        import urllib.error

        tmp = self._write_tmp(b"data")
        try:
            http_err = urllib.error.HTTPError(
                url="https://example.com/x.sha256",
                code=404,
                msg="Not Found",
                hdrs=None,  # type: ignore[arg-type]
                fp=None,
            )
            with patch("urllib.request.urlopen", side_effect=http_err):
                result = _verify_sha256(
                    tmp, "https://example.com/x.sha256", ssl.create_default_context()
                )
        finally:
            os.unlink(tmp)
        self.assertIsNone(result)

    def test_checksum_non_404_http_error_returns_error(self):
        """Non-404 HTTP errors (e.g. 503) should still block the update."""
        import urllib.error

        tmp = self._write_tmp(b"data")
        try:
            http_err = urllib.error.HTTPError(
                url="https://example.com/x.sha256",
                code=503,
                msg="Service Unavailable",
                hdrs=None,  # type: ignore[arg-type]
                fp=None,
            )
            with patch("urllib.request.urlopen", side_effect=http_err):
                result = _verify_sha256(
                    tmp, "https://example.com/x.sha256", ssl.create_default_context()
                )
        finally:
            os.unlink(tmp)
        self.assertIsNotNone(result)
        self.assertIn("checksum", result or "")  # type: ignore[operator]

    def test_oserror_reading_tmp_file_returns_error(self):
        """OSError when open(tmp_path, 'rb') fails after a successful checksum download."""
        data = b"fake installer bytes"
        digest = hashlib.sha256(data).hexdigest()
        checksum_content = f"{digest}  El-Sbobinator-Setup-v1.0.0.exe\n".encode()
        tmp = self._write_tmp(data)
        os.unlink(
            tmp
        )  # FileNotFoundError (OSError subclass) when _verify_sha256 tries to read it
        with patch(
            "urllib.request.urlopen", return_value=self._make_resp(checksum_content)
        ):
            result = _verify_sha256(
                tmp, "https://example.com/x.sha256", ssl.create_default_context()
            )
        self.assertIsNotNone(result)
        self.assertIn("Lettura file temporaneo fallita", result or "")  # type: ignore[operator]


class TestChecksumIntegration(unittest.TestCase):
    def test_checksum_failure_blocks_install_and_deletes_tmp(self):
        class _FakeResp:
            def read(self, n=None):
                return b""

            def __enter__(self):
                return self

            def __exit__(self, *a):
                pass

        with (
            patch.object(sys, "platform", "win32"),
            patch("urllib.request.urlopen", return_value=_FakeResp()),
            patch("builtins.open", mock_open()),
            patch("os.unlink") as mock_unlink,
            patch("os.startfile", create=True) as mock_start,
            patch("tempfile.NamedTemporaryFile") as mock_tmp,
        ):
            mock_tmp.return_value.__enter__.return_value.name = "/tmp/setup.exe"
            mock_tmp.return_value.__exit__.return_value = False
            result = download_and_install_update("1.0.0")

        self.assertFalse(result["ok"])
        self.assertIn("vuoto", result["error"])
        mock_start.assert_not_called()
        mock_unlink.assert_called_with("/tmp/setup.exe")


if __name__ == "__main__":
    unittest.main()
