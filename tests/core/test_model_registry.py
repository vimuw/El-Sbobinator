import unittest
from unittest.mock import patch

from el_sbobinator.core.model_registry import (
    DEFAULT_MODEL,
    MODEL_OPTIONS,
    SUPPORTED_MODELS,
    default_chunk_minutes_for_model,
    default_macro_char_limit_for_model,
    model_label,
    sanitize_model_name,
)
from el_sbobinator.pipeline.pipeline_settings import load_and_sanitize_settings


class SupportedModelsTests(unittest.TestCase):
    def test_gemini_25_flash_in_supported_models(self):
        self.assertIn("gemini-2.5-flash", SUPPORTED_MODELS)

    def test_removed_models_not_in_supported_models(self):
        for removed in (
            "gemini-2.5-pro",
            "gemini-2.0-flash",
            "gemini-2.0-flash-lite",
            "gemini-3.1-flash-lite-preview",
            "gemini-3.5-flash-lite",
            "gemini-2.5-flash-lite",
            "gemini-3-flash-preview",
        ):
            self.assertNotIn(
                removed, SUPPORTED_MODELS, f"{removed} should have been removed"
            )

    def test_only_current_flash_models_are_available(self):
        self.assertEqual(
            SUPPORTED_MODELS,
            ("gemini-2.5-flash", "gemini-3.6-flash", "gemini-3.8-flash"),
        )
        self.assertEqual(tuple(opt["id"] for opt in MODEL_OPTIONS), SUPPORTED_MODELS)
        self.assertEqual(DEFAULT_MODEL, "gemini-3.6-flash")
        self.assertEqual(
            [opt["id"] for opt in MODEL_OPTIONS if opt.get("is_default")],
            [DEFAULT_MODEL],
        )

    def test_gemini_38_flash_in_supported_models(self):
        self.assertIn("gemini-3.8-flash", SUPPORTED_MODELS)

    def test_gemini_36_flash_in_supported_models(self):
        self.assertIn("gemini-3.6-flash", SUPPORTED_MODELS)

    def test_gemini_15_flash_not_in_supported_models(self):
        self.assertNotIn("gemini-1.5-flash", SUPPORTED_MODELS)

    def test_removed_models_migrate_to_default_and_are_dropped_from_fallbacks(self):
        removed_models = (
            "gemini-2.5-flash-lite",
            "gemini-3.5-flash-lite",
            "gemini-3-flash-preview",
            "gemini-3.1-flash-lite-preview",
        )
        for removed in removed_models:
            with self.subTest(model=removed):
                session = {
                    "settings": {
                        "model": removed,
                        "effective_model": removed,
                        "fallback_models": [removed, "gemini-3.6-flash"],
                        "audio": {"bitrate": "48k"},
                    }
                }

                settings, changed = load_and_sanitize_settings(session)

                self.assertTrue(changed)
                self.assertEqual(settings.model, DEFAULT_MODEL)
                self.assertEqual(settings.effective_model, DEFAULT_MODEL)


class LegacyModelMigrationTests(unittest.TestCase):
    def test_legacy_choices_resolve_to_successors(self):
        self.assertEqual(sanitize_model_name(" gemini-3.5-flash "), "gemini-3.6-flash")
        self.assertEqual(sanitize_model_name("gemini-3.7-flash"), "gemini-3.8-flash")
        self.assertEqual(
            sanitize_model_name(None, "gemini-3.7-flash"), "gemini-3.8-flash"
        )
        for model in SUPPORTED_MODELS:
            with self.subTest(model=model):
                self.assertEqual(sanitize_model_name(model), model)

    def test_session_migration_preserves_parameters_and_is_idempotent(self):
        for legacy, successor in (
            ("gemini-3.5-flash", "gemini-3.6-flash"),
            ("gemini-3.7-flash", "gemini-3.8-flash"),
        ):
            with self.subTest(model=legacy):
                session = {
                    "settings": {
                        "model": legacy,
                        "effective_model": "gemini-3.7-flash",
                        "fallback_models": [
                            legacy,
                            "gemini-3.7-flash",
                            "gemini-3.8-flash",
                        ],
                        "chunk_minutes": 7,
                        "overlap_seconds": 45,
                        "macro_char_limit": 10000,
                        "audio": {"bitrate": "64k"},
                    }
                }
                settings, changed = load_and_sanitize_settings(session)
                self.assertTrue(changed)
                self.assertEqual(settings.model, successor)
                self.assertEqual(settings.effective_model, successor)
                self.assertEqual(session["settings"]["model"], successor)
                self.assertEqual(session["settings"]["effective_model"], successor)
                self.assertEqual(settings.chunk_minutes, 7)
                self.assertEqual(settings.overlap_seconds, 45)
                self.assertEqual(settings.macro_char_limit, 10000)
                self.assertEqual(session["settings"]["audio"]["bitrate"], "64k")
                _, changed_again = load_and_sanitize_settings(session)
                self.assertFalse(changed_again)


class DefaultChunkMinutesTests(unittest.TestCase):
    def test_known_models_match_model_options(self):
        for opt in MODEL_OPTIONS:
            expected = int(opt["default_chunk_minutes"])
            got = default_chunk_minutes_for_model(opt["id"])
            self.assertEqual(
                got,
                expected,
                msg=f"model {opt['id']!r}: expected {expected}, got {got}",
            )

    def test_unknown_model_falls_back_to_15(self):
        result = default_chunk_minutes_for_model("gemini-unknown-model")
        self.assertEqual(result, 15)

    def test_derives_from_model_options_not_hardcoded(self):
        patched = tuple(
            {**opt, "default_chunk_minutes": 42}
            if opt["id"] == "gemini-3.6-flash"
            else opt
            for opt in MODEL_OPTIONS
        )
        with patch("el_sbobinator.core.model_registry.MODEL_OPTIONS", patched):
            result = default_chunk_minutes_for_model("gemini-3.6-flash")
        self.assertEqual(result, 42)


class DefaultMacroCharLimitTests(unittest.TestCase):
    def test_known_models_match_model_options(self):
        for opt in MODEL_OPTIONS:
            expected = int(opt["default_macro_char_limit"])
            got = default_macro_char_limit_for_model(opt["id"])
            self.assertEqual(
                got,
                expected,
                msg=f"model {opt['id']!r}: expected {expected}, got {got}",
            )

    def test_flash_36_returns_22000(self):
        result = default_macro_char_limit_for_model("gemini-3.6-flash")
        self.assertEqual(result, 22000)

    def test_unknown_model_falls_back_to_22000(self):
        result = default_macro_char_limit_for_model("gemini-unknown-model")
        self.assertEqual(result, 22000)

    def test_load_and_sanitize_defaults_macro_from_model_when_missing(self):
        session = {
            "settings": {
                "model": "gemini-3.6-flash",
                "effective_model": "gemini-3.6-flash",
                "audio": {"bitrate": "48k"},
            }
        }
        settings, changed = load_and_sanitize_settings(session)
        self.assertEqual(settings.macro_char_limit, 22000)
        self.assertEqual(session["settings"]["macro_char_limit"], 22000)
        self.assertTrue(changed)

    def test_load_and_sanitize_uses_model_macro_char_limit(self):
        patched = tuple(
            {**opt, "default_macro_char_limit": 7500}
            if opt["id"] == "gemini-3.6-flash"
            else opt
            for opt in MODEL_OPTIONS
        )
        session = {
            "settings": {
                "model": "gemini-3.6-flash",
                "effective_model": "gemini-3.6-flash",
                "chunk_minutes": 5,
                "overlap_seconds": 30,
                "macro_char_limit": 22000,
                "preconvert_audio": True,
                "prefetch_next_chunk": True,
                "inline_audio_max_mb": 6.0,
                "audio": {"bitrate": "48k"},
            }
        }
        with patch("el_sbobinator.core.model_registry.MODEL_OPTIONS", patched):
            settings, changed = load_and_sanitize_settings(session)
            self.assertEqual(settings.macro_char_limit, 7500)
            self.assertEqual(session["settings"]["macro_char_limit"], 7500)
            self.assertTrue(changed)

    def test_load_and_sanitize_preserves_explicit_non_default_macro_char_limit(self):
        session = {
            "settings": {
                "model": "gemini-3.6-flash",
                "effective_model": "gemini-3.6-flash",
                "chunk_minutes": 5,
                "overlap_seconds": 30,
                "macro_char_limit": 10000,
                "preconvert_audio": True,
                "prefetch_next_chunk": True,
                "inline_audio_max_mb": 6.0,
                "audio": {"bitrate": "48k"},
            }
        }
        settings, _changed = load_and_sanitize_settings(session)
        self.assertEqual(settings.macro_char_limit, 10000)


class ModelLabelTests(unittest.TestCase):
    def test_known_models_use_their_display_name(self):
        for option in MODEL_OPTIONS:
            self.assertEqual(model_label(option["id"]), option["label"])

    def test_unknown_model_is_shown_as_it_is(self):
        self.assertEqual(model_label("gemini-sperimentale"), "gemini-sperimentale")


if __name__ == "__main__":
    unittest.main()
