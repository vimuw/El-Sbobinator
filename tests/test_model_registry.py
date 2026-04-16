import unittest

from el_sbobinator.model_registry import (
    SUPPORTED_MODELS,
    build_model_state,
    sanitize_fallback_models,
)


class ResumeModelStateTests(unittest.TestCase):
    def test_resume_without_effective_starts_from_primary(self):
        """Resume with no effective_model → current = primary."""
        ms = build_model_state("gemini-2.5-flash", ["gemini-2.5-flash-lite"])
        self.assertEqual(ms.current, "gemini-2.5-flash")

    def test_resume_ignores_stale_effective_model(self):
        """Pipeline no longer passes effective_model at resume; chain and primary are correct."""
        ms = build_model_state("gemini-2.5-flash", ["gemini-2.5-flash-lite"])
        self.assertEqual(ms.current, "gemini-2.5-flash")
        self.assertEqual(ms.chain, ("gemini-2.5-flash", "gemini-2.5-flash-lite"))

    def test_chain_preserved_for_fallback_on_503(self):
        """Fallback chain is still intact so retry_with_quota can degrade if needed."""
        ms = build_model_state("gemini-2.5-flash", ["gemini-2.5-flash-lite"])
        self.assertIn("gemini-2.5-flash-lite", ms.chain)


class SupportedModelsTests(unittest.TestCase):
    def test_gemini_25_flash_in_supported_models(self):
        self.assertIn("gemini-2.5-flash", SUPPORTED_MODELS)

    def test_gemini_25_flash_lite_in_supported_models(self):
        self.assertIn("gemini-2.5-flash-lite", SUPPORTED_MODELS)

    def test_removed_models_not_in_supported_models(self):
        for removed in ("gemini-2.5-pro", "gemini-2.0-flash", "gemini-2.0-flash-lite"):
            self.assertNotIn(
                removed, SUPPORTED_MODELS, f"{removed} should have been removed"
            )

    def test_gemini_31_flash_lite_preview_in_supported_models(self):
        self.assertIn("gemini-3.1-flash-lite-preview", SUPPORTED_MODELS)

    def test_gemini_15_flash_not_in_supported_models(self):
        self.assertNotIn("gemini-1.5-flash", SUPPORTED_MODELS)

    def test_current_fallbacks_accepted_by_sanitize_fallback_models(self):
        result = sanitize_fallback_models(
            ["gemini-2.5-flash-lite", "gemini-3.1-flash-lite-preview"],
            primary_model="gemini-2.5-flash",
        )
        self.assertEqual(
            result,
            ["gemini-2.5-flash-lite", "gemini-3.1-flash-lite-preview"],
        )

    def test_removed_models_filtered_by_sanitize_fallback_models(self):
        result = sanitize_fallback_models(
            ["gemini-2.0-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro"],
            primary_model="gemini-2.5-flash",
        )
        self.assertEqual(result, ["gemini-2.5-flash-lite"])

    def test_chain_with_current_default_fallbacks(self):
        ms = build_model_state(
            "gemini-2.5-flash",
            ["gemini-2.5-flash-lite", "gemini-3.1-flash-lite-preview"],
        )
        self.assertEqual(
            ms.chain,
            (
                "gemini-2.5-flash",
                "gemini-2.5-flash-lite",
                "gemini-3.1-flash-lite-preview",
            ),
        )
        self.assertEqual(ms.current, "gemini-2.5-flash")

    def test_unsupported_primary_falls_back_to_default(self):
        ms = build_model_state("gemini-2.5-pro", ["gemini-2.5-flash"])
        self.assertEqual(ms.current, "gemini-2.5-flash")
        self.assertIn("gemini-2.5-flash", ms.chain)


if __name__ == "__main__":
    unittest.main()
