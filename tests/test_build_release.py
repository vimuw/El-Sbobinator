import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

_MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "build_release.py"
_SPEC = importlib.util.spec_from_file_location("build_release_module", _MODULE_PATH)
assert _SPEC is not None
build_release = importlib.util.module_from_spec(_SPEC)
assert _SPEC.loader is not None
_SPEC.loader.exec_module(build_release)


class BuildReleaseTests(unittest.TestCase):
    def test_postbuild_smoke_fails_when_artifact_is_missing(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch.object(build_release, "ROOT", Path(tmpdir)):
                with self.assertRaises(FileNotFoundError):
                    build_release.run_postbuild_smoke("windows")

    def test_postbuild_smoke_runs_smoke_script_when_artifact_exists(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            artifact_dir = root / "dist" / build_release.APP_NAME
            artifact_dir.mkdir(parents=True, exist_ok=True)
            inner_exe = artifact_dir / f"{build_release.APP_NAME}.exe"
            inner_exe.write_bytes(b"ok")

            with (
                patch.object(build_release, "ROOT", root),
                patch.object(build_release, "run") as mock_run,
            ):
                build_release.run_postbuild_smoke("windows")

            mock_run.assert_called_once()


class WriteSha256Tests(unittest.TestCase):
    def test_round_trip_digest_matches_known_bytes(self):
        import hashlib

        data = b"hello sha256"
        expected_digest = hashlib.sha256(data).hexdigest()
        with tempfile.TemporaryDirectory() as tmpdir:
            artifact = Path(tmpdir) / "release.exe"
            artifact.write_bytes(data)
            result = build_release.write_sha256(artifact)
            content = result.read_text(encoding="utf-8")
            digest_in_file = content.split()[0]
            self.assertEqual(digest_in_file, expected_digest)

    def test_output_path_has_sha256_suffix(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            artifact = Path(tmpdir) / "release.exe"
            artifact.write_bytes(b"x")
            result = build_release.write_sha256(artifact)
            self.assertEqual(result.name, "release.exe.sha256")

    def test_output_line_format_includes_filename(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            artifact = Path(tmpdir) / "mypkg.dmg"
            artifact.write_bytes(b"dmg content")
            result = build_release.write_sha256(artifact)
            content = result.read_text(encoding="utf-8")
            parts = content.rstrip("\n").split("  ", 1)
            self.assertEqual(len(parts), 2)
            self.assertEqual(parts[1], "mypkg.dmg")
            self.assertTrue(content.endswith("\n"))

    def test_returns_path_to_checksum_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            artifact = Path(tmpdir) / "setup.exe"
            artifact.write_bytes(b"data")
            result = build_release.write_sha256(artifact)
            self.assertIsInstance(result, Path)
            self.assertTrue(result.exists())

    def test_large_file_digest_correct(self):
        import hashlib

        data = b"A" * (65536 * 3 + 100)
        expected_digest = hashlib.sha256(data).hexdigest()
        with tempfile.TemporaryDirectory() as tmpdir:
            artifact = Path(tmpdir) / "big.exe"
            artifact.write_bytes(data)
            result = build_release.write_sha256(artifact)
            content = result.read_text(encoding="utf-8")
            self.assertEqual(content.split()[0], expected_digest)


if __name__ == "__main__":
    unittest.main()
