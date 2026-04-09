import unittest

from el_sbobinator.model_registry import build_model_state


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


if __name__ == "__main__":
    unittest.main()
