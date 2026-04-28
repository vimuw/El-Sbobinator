"""Tests for el_sbobinator.services.folders_service."""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from unittest.mock import patch


class TestFoldersService(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()
        self.folders_file = os.path.join(self.tmp_dir, "folders.json")
        self._patcher = patch(
            "el_sbobinator.services.folders_service.FOLDERS_FILE",
            self.folders_file,
        )
        self._patcher.start()

    def tearDown(self):
        self._patcher.stop()
        import shutil

        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    # ------------------------------------------------------------------
    # get_folders
    # ------------------------------------------------------------------

    def test_get_folders_returns_empty_when_file_absent(self):
        from el_sbobinator.services.folders_service import get_folders

        self.assertEqual(get_folders(), [])

    def test_get_folders_round_trip(self):
        from el_sbobinator.services.folders_service import get_folders, save_folders

        folders = [
            {
                "id": "abc",
                "name": "Anatomia",
                "color": "#FF6B6B",
                "session_dirs": ["/a", "/b"],
            },
        ]
        save_folders(folders)
        result = get_folders()
        self.assertEqual(result, folders)

    def test_get_folders_returns_empty_on_corrupt_json(self):
        from el_sbobinator.services.folders_service import get_folders

        with open(self.folders_file, "w", encoding="utf-8") as fh:
            fh.write("not valid json {{")
        self.assertEqual(get_folders(), [])

    def test_get_folders_returns_empty_when_top_level_not_dict(self):
        from el_sbobinator.services.folders_service import get_folders

        with open(self.folders_file, "w", encoding="utf-8") as fh:
            json.dump([1, 2, 3], fh)
        self.assertEqual(get_folders(), [])

    def test_get_folders_returns_empty_when_folders_not_list(self):
        from el_sbobinator.services.folders_service import get_folders

        with open(self.folders_file, "w", encoding="utf-8") as fh:
            json.dump({"folders": "bad"}, fh)
        self.assertEqual(get_folders(), [])

    def test_get_folders_skips_non_dict_entries(self):
        from el_sbobinator.services.folders_service import get_folders

        with open(self.folders_file, "w", encoding="utf-8") as fh:
            json.dump({"folders": [{"id": "x"}, "oops", None]}, fh)
        result = get_folders()
        self.assertEqual(result, [{"id": "x"}])

    # ------------------------------------------------------------------
    # save_folders
    # ------------------------------------------------------------------

    def test_save_folders_creates_file(self):
        from el_sbobinator.services.folders_service import save_folders

        self.assertFalse(os.path.exists(self.folders_file))
        save_folders([])
        self.assertTrue(os.path.exists(self.folders_file))

    def test_save_folders_multiple_items(self):
        from el_sbobinator.services.folders_service import get_folders, save_folders

        folders = [
            {"id": "1", "name": "A", "color": "#fff", "session_dirs": []},
            {"id": "2", "name": "B", "color": "#000", "session_dirs": ["/x"]},
        ]
        save_folders(folders)
        self.assertEqual(get_folders(), folders)

    def test_save_folders_raises_on_non_list(self):
        from el_sbobinator.services.folders_service import save_folders

        with self.assertRaises(TypeError):
            save_folders("not a list")  # type: ignore[arg-type]

    def test_save_folders_overwrites_existing(self):
        from el_sbobinator.services.folders_service import get_folders, save_folders

        save_folders([{"id": "old"}])
        save_folders([{"id": "new"}])
        self.assertEqual(get_folders(), [{"id": "new"}])


if __name__ == "__main__":
    unittest.main()
