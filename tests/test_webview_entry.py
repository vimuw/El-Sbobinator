import io
import unittest
from unittest.mock import MagicMock

from el_sbobinator.webview_entry import _MAX_CONSOLE_LINE_LEN, _ConsoleTee


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


if __name__ == "__main__":
    unittest.main()
