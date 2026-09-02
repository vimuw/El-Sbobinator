import os
import tempfile
import unittest
from datetime import UTC, datetime, timedelta, timezone
from unittest.mock import patch

from el_sbobinator.services import usage_service


class UsageServiceTests(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.config_dir_patch = patch(
            "el_sbobinator.services.usage_service.get_config_dir",
            return_value=self.tmp_dir.name,
        )
        self.config_dir_patch.start()
        usage_service.reset_daily_usage_for_tests()

    def tearDown(self):
        self.config_dir_patch.stop()
        self.tmp_dir.cleanup()

    def test_record_request_increments_for_specific_model(self):
        key = "AIzaSyTest1234567890abcdef"
        usage_service.record_request(key, "gemini-2.5-flash", 1)
        usage_service.record_request(key, "gemini-2.5-flash", 2)

        data = usage_service.get_daily_usage(
            primary_key=key,
            primary_model="gemini-2.5-flash",
            fallback_models=["gemini-3.1-flash-lite-preview"],
        )

        key_entry = data["keys"][0]
        self.assertEqual(key_entry["models"]["gemini-2.5-flash"]["used_today"], 3)
        self.assertEqual(key_entry["models"]["gemini-2.5-flash"]["remaining"], 17)
        self.assertFalse(key_entry["models"]["gemini-2.5-flash"]["is_exhausted"])

        # Model isolation: Flash Lite quota should be completely untouched
        self.assertEqual(
            key_entry["models"]["gemini-3.1-flash-lite-preview"]["used_today"], 0
        )
        self.assertEqual(
            key_entry["models"]["gemini-3.1-flash-lite-preview"]["remaining"], 500
        )

    def test_mark_model_exhausted_only_affects_targeted_model(self):
        key = "AIzaSyTest1234567890abcdef"
        usage_service.record_request(key, "gemini-2.5-flash", 5)
        usage_service.mark_model_exhausted(key, "gemini-2.5-flash")

        data = usage_service.get_daily_usage(
            primary_key=key,
            primary_model="gemini-2.5-flash",
            fallback_models=["gemini-3.1-flash-lite-preview"],
        )

        key_entry = data["keys"][0]
        self.assertTrue(key_entry["models"]["gemini-2.5-flash"]["is_exhausted"])
        self.assertEqual(key_entry["models"]["gemini-2.5-flash"]["remaining"], 0)

        # Fallback model remains fully available
        self.assertFalse(
            key_entry["models"]["gemini-3.1-flash-lite-preview"]["is_exhausted"]
        )
        self.assertEqual(
            key_entry["models"]["gemini-3.1-flash-lite-preview"]["remaining"], 500
        )

    def test_multi_key_isolation(self):
        key1 = "AIzaSyKey111111111111111111"
        key2 = "AIzaSyKey222222222222222222"

        usage_service.record_request(key1, "gemini-2.5-flash", 10)
        usage_service.record_request(key2, "gemini-2.5-flash", 2)

        data = usage_service.get_daily_usage(
            primary_key=key1,
            fallback_keys=[key2],
            primary_model="gemini-2.5-flash",
        )

        self.assertEqual(len(data["keys"]), 2)
        k1 = next(k for k in data["keys"] if k["is_primary"])
        k2 = next(k for k in data["keys"] if not k["is_primary"])

        self.assertEqual(k1["models"]["gemini-2.5-flash"]["used_today"], 10)
        self.assertEqual(k1["models"]["gemini-2.5-flash"]["remaining"], 10)
        self.assertEqual(k2["models"]["gemini-2.5-flash"]["used_today"], 2)
        self.assertEqual(k2["models"]["gemini-2.5-flash"]["remaining"], 18)

    def test_pacific_date_reset(self):
        key = "AIzaSyKey111111111111111111"
        usage_service.record_request(key, "gemini-2.5-flash", 10)

        # Simulate next day in Pacific time
        fake_next_day = "2099-01-01"
        with patch(
            "el_sbobinator.services.usage_service.get_pacific_date_string",
            return_value=fake_next_day,
        ):
            data = usage_service.get_daily_usage(
                primary_key=key,
                primary_model="gemini-2.5-flash",
            )
            k1 = data["keys"][0]
            self.assertEqual(k1["models"]["gemini-2.5-flash"]["used_today"], 0)
            self.assertEqual(k1["models"]["gemini-2.5-flash"]["remaining"], 20)
            self.assertEqual(data["quota_date"], fake_next_day)

    def test_degraded_mode_sbobine_calculation(self):
        key = "AIzaSyKey111111111111111111"
        # Exhaust 20 Flash Standard requests
        usage_service.mark_model_exhausted(key, "gemini-2.5-flash")
        # Record 50 requests on Flash Lite (out of 500) -> 450 remaining
        usage_service.record_request(key, "gemini-3.1-flash-lite-preview", 50)

        data = usage_service.get_daily_usage(
            primary_key=key,
            primary_model="gemini-2.5-flash",
            fallback_models=["gemini-3.1-flash-lite-preview"],
        )

        self.assertTrue(data["is_degraded_mode"])
        # 450 / 19 = 23 complete 3-hour sbobine
        self.assertEqual(data["estimated_sbobine_remaining"], 23)
        self.assertEqual(data["total_requests_remaining"], 450)

    def test_fallback_timezone_date_calculation(self):
        fallback_tz = timezone(timedelta(hours=-7))
        with patch("el_sbobinator.services.usage_service.PACIFIC_TZ", fallback_tz):
            dt_utc = datetime(2026, 9, 2, 12, 0, 0, tzinfo=UTC)
            date_str = usage_service.get_pacific_date_string(dt_utc)
            self.assertEqual(date_str, "2026-09-02")

    def test_fallback_keys_deduplication(self):
        key1 = "AIzaSyKey111111111111111111"
        key2 = "AIzaSyKey222222222222222222"

        data = usage_service.get_daily_usage(
            primary_key=key1,
            fallback_keys=[key1, key2, key2, key1],
            primary_model="gemini-2.5-flash",
        )
        self.assertEqual(len(data["keys"]), 2)


if __name__ == "__main__":
    unittest.main()
