import unittest
from unittest.mock import patch

from el_sbobinator.session_store import (
    clone_session_settings,
    new_session,
    resolve_session_paths,
)


class SessionStoreTests(unittest.TestCase):
    def test_new_session_has_expected_defaults(self):
        with patch(
            "el_sbobinator.session_store.build_default_pipeline_settings",
            return_value={
                "model": "gemini-2.5-flash",
                "fallback_models": ["gemini-2.5-flash-lite"],
                "effective_model": "gemini-2.5-flash",
                "chunk_minutes": 15,
                "overlap_seconds": 30,
                "macro_char_limit": 22000,
                "preconvert_audio": True,
                "prefetch_next_chunk": True,
                "inline_audio_max_mb": 6.0,
                "audio": {"bitrate": "48k"},
            },
        ):
            session = new_session("lesson.mp3")
        self.assertEqual(session["stage"], "phase1")
        self.assertIn("phase1", session)
        self.assertIn("outputs", session)
        self.assertEqual(session["settings"]["model"], "gemini-2.5-flash")
        self.assertEqual(session["settings"]["effective_model"], "gemini-2.5-flash")
        self.assertEqual(
            session["settings"]["fallback_models"], ["gemini-2.5-flash-lite"]
        )
        self.assertEqual(session["settings"]["audio"]["bitrate"], "48k")

    def test_clone_session_settings_is_deep_copy(self):
        session = {"settings": {"audio": {"bitrate": "48k"}}}
        cloned = clone_session_settings(session)
        cloned["audio"]["bitrate"] = "64k"
        self.assertEqual(session["settings"]["audio"]["bitrate"], "48k")

    def test_resolve_session_paths_builds_consistent_layout(self):
        paths = resolve_session_paths("lesson.mp3")
        self.assertTrue(paths.session_path.endswith("session.json"))
        self.assertTrue(paths.phase1_chunks_dir.endswith("phase1_chunks"))
        self.assertTrue(paths.phase2_revised_dir.endswith("phase2_revised"))


if __name__ == "__main__":
    unittest.main()
