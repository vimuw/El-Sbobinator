import threading
import unittest
from typing import Any, ClassVar, cast
from unittest.mock import patch

from el_sbobinator.core.model_registry import build_model_state
from el_sbobinator.services.generation_service import (
    AllModelsUnavailableError,
    DegenerateOutputError,
    QuotaDailyLimitError,
    _is_model_unavailable,
    detect_degenerate_output,
    retry_with_quota,
    try_rotate_key,
)


class _FakeRuntime:
    def __init__(self):
        self.rotated_keys = []
        self.phase_calls: list[str] = []

    def phase(self, text):
        self.phase_calls.append(text)

    def set_effective_api_key(self, key):
        self.rotated_keys.append(key)


class _Structured503QuotaError(RuntimeError):
    def __init__(self):
        super().__init__("503 Service Unavailable")
        self.code = 503
        self.status = "RESOURCE_EXHAUSTED"
        self.message = "Token balance exhausted for this API key"
        self.details = {
            "error": {
                "code": 503,
                "status": "RESOURCE_EXHAUSTED",
                "message": "Token balance exhausted for this API key",
            }
        }


class TryRotateKeyTests(unittest.TestCase):
    def test_invalid_key_is_discarded(self):
        class _InvalidModels:
            def get(self, model=None, **kwargs):
                err = RuntimeError("API key not valid")
                err.code = 401  # type: ignore[attr-defined]
                raise err

        class _InvalidClient:
            def __init__(self, api_key=None, **kwargs):
                self.api_key = api_key
                self.models = _InvalidModels()

        keys = ["bad-key"]
        with patch(
            "el_sbobinator.services.generation_service.genai.Client", _InvalidClient
        ):
            client, rotated, key = try_rotate_key(object(), keys, "test-model")

        self.assertFalse(rotated)
        self.assertIsNone(key)
        self.assertEqual(keys, [])
        self.assertIsNotNone(client)

    def test_transient_key_moves_to_back_and_valid_second_key_succeeds(self):
        class _Models:
            def __init__(self, api_key):
                self.api_key = api_key

            def get(self, model=None, **kwargs):
                if self.api_key == "transient-key":
                    err = RuntimeError("503 Service Unavailable")
                    err.code = 503  # type: ignore[attr-defined]
                    raise err
                return {"model": model}

        class _Client:
            def __init__(self, api_key=None, **kwargs):
                self.api_key = api_key
                self.models = _Models(api_key)

        keys = ["transient-key", "valid-key"]
        with patch("el_sbobinator.services.generation_service.genai.Client", _Client):
            client, rotated, key = try_rotate_key(object(), keys, "test-model")

        self.assertTrue(rotated)
        self.assertEqual(key, "valid-key")
        self.assertEqual(keys, ["transient-key"])
        self.assertEqual(cast(Any, client).api_key, "valid-key")

    def test_all_transient_keys_stop_after_one_pass_without_consuming(self):
        calls = []

        class _TransientModels:
            def __init__(self, api_key):
                self.api_key = api_key

            def get(self, model=None, **kwargs):
                calls.append(self.api_key)
                raise TimeoutError("timed out")

        class _TransientClient:
            def __init__(self, api_key=None, **kwargs):
                self.api_key = api_key
                self.models = _TransientModels(api_key)

        original = object()
        keys = ["k1", "k2"]
        with patch(
            "el_sbobinator.services.generation_service.genai.Client", _TransientClient
        ):
            client, rotated, key = try_rotate_key(original, keys, "test-model")

        self.assertIs(client, original)
        self.assertFalse(rotated)
        self.assertIsNone(key)
        self.assertEqual(calls, ["k1", "k2"])
        self.assertEqual(keys, ["k1", "k2"])

    def test_transient_validation_print_redacts_key(self):
        secret = "AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ012345"
        printed = []

        class _TransientModels:
            def get(self, model=None, **kwargs):
                err = RuntimeError(f"503 temporary key={secret}")
                err.code = 503  # type: ignore[attr-defined]
                raise err

        class _TransientClient:
            def __init__(self, api_key=None, **kwargs):
                self.models = _TransientModels()

        with (
            patch(
                "el_sbobinator.services.generation_service.genai.Client",
                _TransientClient,
            ),
            patch("builtins.print", side_effect=printed.append),
        ):
            try_rotate_key(object(), ["transient-key"], "test-model")

        joined = "\n".join(printed)
        self.assertNotIn(secret, joined)
        self.assertIn("[API_KEY_REDACTED]", joined)


class RetryWithQuotaTests(unittest.TestCase):
    def _run(self, fn, *, max_attempts=2):
        return retry_with_quota(
            fn,
            client=object(),
            fallback_keys=[],
            model_name="test-model",
            cancelled=lambda: False,
            runtime=_FakeRuntime(),
            request_fallback_key=lambda: None,
            max_attempts=max_attempts,
            retry_sleep_seconds=0.0,
            rate_limit_sleep_seconds=0.0,
        )

    def test_plain_503_switches_to_next_model_after_quick_retry(self):
        primary_client = object()
        model_state = build_model_state(
            "gemini-2.5-flash",
            ["gemini-3.1-flash-lite-preview"],
            "gemini-2.5-flash",
        )
        switched = []

        def fn(current_client):
            if (
                current_client is primary_client
                and model_state.current == "gemini-3.1-flash-lite-preview"
            ):
                return "ok"
            err = RuntimeError("503 Service Unavailable")
            err.code = 503  # type: ignore[attr-defined]
            raise err

        client, result = retry_with_quota(
            fn,
            client=primary_client,
            fallback_keys=[],
            model_name="gemini-2.5-flash",
            model_state=model_state,
            cancelled=lambda: False,
            runtime=_FakeRuntime(),
            request_fallback_key=lambda: None,
            max_attempts=2,
            retry_sleep_seconds=0.0,
            model_unavailable_retry_delays=(0.0, 0.0),
            rate_limit_sleep_seconds=0.0,
            on_model_switched=lambda old, new: switched.append((old, new)),
        )

        self.assertIs(client, primary_client)
        self.assertEqual(result, "ok")
        self.assertEqual(model_state.current, "gemini-3.1-flash-lite-preview")
        self.assertEqual(
            switched, [("gemini-2.5-flash", "gemini-3.1-flash-lite-preview")]
        )

    def test_model_404_switches_immediately_without_sleep(self):
        model_state = build_model_state(
            "gemini-2.5-flash",
            ["gemini-3.1-flash-lite-preview"],
            "gemini-2.5-flash",
        )
        switched = []
        call_models = []

        def fn(_client):
            call_models.append(model_state.current)
            if model_state.current == "gemini-3.1-flash-lite-preview":
                return "ok"
            err = RuntimeError("404 NOT_FOUND model unsupported for generateContent")
            err.code = 404  # type: ignore[attr-defined]
            raise err

        with patch(
            "el_sbobinator.services.generation_service.sleep_with_cancel",
            side_effect=AssertionError("404 must not sleep before switching model"),
        ):
            client, result = retry_with_quota(
                fn,
                client=object(),
                fallback_keys=[],
                model_name="gemini-2.5-flash",
                model_state=model_state,
                cancelled=lambda: False,
                runtime=_FakeRuntime(),
                request_fallback_key=lambda: None,
                max_attempts=1,
                retry_sleep_seconds=0.0,
                model_unavailable_retry_delays=(0.0, 0.0),
                rate_limit_sleep_seconds=0.0,
                on_model_switched=lambda old, new: switched.append((old, new)),
            )

        self.assertEqual(result, "ok")
        self.assertEqual(
            call_models, ["gemini-2.5-flash", "gemini-3.1-flash-lite-preview"]
        )
        self.assertEqual(
            switched, [("gemini-2.5-flash", "gemini-3.1-flash-lite-preview")]
        )

    def test_degenerate_output_switches_model_without_consuming_attempts(self):
        model_state = build_model_state(
            "gemini-2.5-flash",
            ["gemini-3.1-flash-lite-preview"],
            "gemini-2.5-flash",
        )
        switched = []
        call_models = []

        def fn(_client):
            call_models.append(model_state.current)
            if model_state.current == "gemini-3.1-flash-lite-preview":
                return "ok"
            raise DegenerateOutputError("frase ripetuta 8 volte")

        client, result = retry_with_quota(
            fn,
            client=object(),
            fallback_keys=[],
            model_name="gemini-2.5-flash",
            model_state=model_state,
            cancelled=lambda: False,
            runtime=_FakeRuntime(),
            request_fallback_key=lambda: None,
            max_attempts=1,
            retry_sleep_seconds=0.0,
            model_unavailable_retry_delays=(0.0, 0.0),
            rate_limit_sleep_seconds=0.0,
            on_model_switched=lambda old, new: switched.append((old, new)),
        )

        self.assertEqual(result, "ok")
        self.assertEqual(
            call_models, ["gemini-2.5-flash", "gemini-3.1-flash-lite-preview"]
        )
        self.assertEqual(
            switched, [("gemini-2.5-flash", "gemini-3.1-flash-lite-preview")]
        )

    def test_degenerate_output_exhausted_chain_re_raises_degenerate_error(self):
        model_state = build_model_state(
            "gemini-2.5-flash",
            ["gemini-3.1-flash-lite-preview"],
            "gemini-2.5-flash",
        )

        def fn(_client):
            raise DegenerateOutputError("frase ripetuta 8 volte")

        with self.assertRaises(DegenerateOutputError) as ctx:
            retry_with_quota(
                fn,
                client=object(),
                fallback_keys=[],
                model_name="gemini-2.5-flash",
                model_state=model_state,
                cancelled=lambda: False,
                runtime=_FakeRuntime(),
                request_fallback_key=lambda: None,
                max_attempts=1,
                retry_sleep_seconds=0.0,
                model_unavailable_retry_delays=(0.0, 0.0),
                rate_limit_sleep_seconds=0.0,
            )

        self.assertIn("output degenerato", str(ctx.exception).lower())

    def test_plain_503_exhausted_chain_raises_clear_error(self):
        model_state = build_model_state(
            "gemini-2.5-flash",
            ["gemini-3.1-flash-lite-preview"],
            "gemini-2.5-flash",
        )

        def fn(_client):
            err = RuntimeError("503 Service Unavailable")
            err.code = 503  # type: ignore[attr-defined]
            raise err

        with self.assertRaises(RuntimeError) as ctx:
            retry_with_quota(
                fn,
                client=object(),
                fallback_keys=[],
                model_name="gemini-2.5-flash",
                model_state=model_state,
                cancelled=lambda: False,
                runtime=_FakeRuntime(),
                request_fallback_key=lambda: None,
                max_attempts=2,
                retry_sleep_seconds=0.0,
                model_unavailable_retry_delays=(0.0, 0.0),
                rate_limit_sleep_seconds=0.0,
            )
        self.assertIn("fallback configurati", str(ctx.exception))

    def test_plain_503_retry_that_becomes_429_does_not_switch_model(self):
        model_state = build_model_state(
            "gemini-2.5-flash",
            ["gemini-3.1-flash-lite-preview"],
            "gemini-2.5-flash",
        )
        call_count = 0

        def fn(_client):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                err = RuntimeError("503 Service Unavailable")
                err.code = 503  # type: ignore[attr-defined]
                raise err
            raise RuntimeError("429 resource_exhausted per minute")

        with self.assertRaises(RuntimeError):
            retry_with_quota(
                fn,
                client=object(),
                fallback_keys=[],
                model_name="gemini-2.5-flash",
                model_state=model_state,
                cancelled=lambda: False,
                runtime=_FakeRuntime(),
                request_fallback_key=lambda: None,
                max_attempts=2,
                retry_sleep_seconds=0.0,
                model_unavailable_retry_delays=(0.0, 0.0),
                rate_limit_sleep_seconds=0.0,
            )

        self.assertEqual(model_state.current, "gemini-2.5-flash")

    def test_rate_limit_exhausted_raises_original_not_quota_daily(self):
        """Persistent per-minute 429s must NOT raise QuotaDailyLimitError
        and must not trigger fallback-key acquisition."""
        fallback_key_calls = []

        def fn(_client):
            raise RuntimeError("429 resource_exhausted per minute threshold")

        with self.assertRaises(RuntimeError) as ctx:
            retry_with_quota(
                fn,
                client=object(),
                fallback_keys=[],
                model_name="test-model",
                cancelled=lambda: False,
                runtime=_FakeRuntime(),
                request_fallback_key=lambda: fallback_key_calls.append(1) or None,
                max_attempts=2,
                retry_sleep_seconds=0.0,
                rate_limit_sleep_seconds=0.0,
            )
        self.assertNotIsInstance(ctx.exception, QuotaDailyLimitError)
        self.assertEqual(
            fallback_key_calls,
            [],
            "request_fallback_key must not be called for minute-scoped rate limits",
        )

    def test_daily_quota_still_raises_quota_daily_limit_error(self):
        """True daily-quota errors must still raise QuotaDailyLimitError."""

        def fn(_client):
            raise RuntimeError("429 quota exceeded daily limit per day")

        with self.assertRaises(QuotaDailyLimitError):
            self._run(fn)

    def test_rate_limit_retries_before_giving_up(self):
        """Rate-limit path must exhaust all attempts before raising."""
        call_count = 0

        def fn(_client):
            nonlocal call_count
            call_count += 1
            raise RuntimeError("429 resource_exhausted per minute")

        with self.assertRaises(RuntimeError):
            self._run(fn, max_attempts=3)
        self.assertEqual(call_count, 3)

    def test_structured_503_exhausted_key_rotates_to_fallback_without_sleep_retry(self):
        runtime = _FakeRuntime()
        rotated_client = object()
        call_clients = []

        def fn(current_client):
            call_clients.append(current_client)
            if current_client is rotated_client:
                return "ok"
            raise _Structured503QuotaError()

        with (
            patch(
                "el_sbobinator.services.generation_service.try_rotate_key",
                return_value=(rotated_client, True, "fallback-key"),
            ) as mock_rotate,
            patch(
                "el_sbobinator.services.generation_service.sleep_with_cancel",
                side_effect=AssertionError(
                    "503 exhausted-key path must rotate immediately, not sleep-retry"
                ),
            ),
        ):
            client, result = retry_with_quota(
                fn,
                client=object(),
                fallback_keys=["fallback-key"],
                model_name="test-model",
                cancelled=lambda: False,
                runtime=runtime,
                request_fallback_key=lambda: None,
                max_attempts=2,
                retry_sleep_seconds=0.0,
                rate_limit_sleep_seconds=0.0,
            )

        self.assertIs(client, rotated_client)
        self.assertEqual(result, "ok")
        self.assertEqual(runtime.rotated_keys, ["fallback-key"])
        self.assertEqual(len(call_clients), 2)
        mock_rotate.assert_called_once()

    def test_structured_503_exhausted_key_without_fallback_raises_quota_error(self):
        with self.assertRaises(QuotaDailyLimitError):
            retry_with_quota(
                lambda _client: (_ for _ in ()).throw(_Structured503QuotaError()),
                client=object(),
                fallback_keys=[],
                model_name="test-model",
                cancelled=lambda: False,
                runtime=_FakeRuntime(),
                request_fallback_key=lambda: None,
                max_attempts=2,
                retry_sleep_seconds=0.0,
                rate_limit_sleep_seconds=0.0,
            )

    def test_plain_503_without_quota_signal_uses_generic_retry(self):
        call_count = 0

        def fn(_client):
            nonlocal call_count
            call_count += 1
            err = RuntimeError("503 Service Unavailable")
            err.code = 503  # type: ignore[attr-defined]
            raise err

        with patch(
            "el_sbobinator.services.generation_service.try_rotate_key"
        ) as mock_rotate:
            with self.assertRaises(RuntimeError):
                self._run(fn, max_attempts=2)

        self.assertEqual(call_count, 2)
        mock_rotate.assert_not_called()

    def test_cancelled_quota_error_does_not_rotate_or_request_new_key(self):
        runtime = _FakeRuntime()
        client = object()
        cancel_event = __import__("threading").Event()
        fallback_keys = ["fallback-key-1", "fallback-key-2"]
        fallback_key_calls = []

        def fn(_client):
            cancel_event.set()
            raise RuntimeError("429 quota exceeded daily limit per day")

        with patch(
            "el_sbobinator.services.generation_service.try_rotate_key",
            side_effect=AssertionError(
                "La rotazione non deve partire dopo l'annullamento"
            ),
        ):
            returned_client, result = retry_with_quota(
                fn,
                client=client,
                fallback_keys=fallback_keys,
                model_name="test-model",
                cancelled=cancel_event.is_set,
                runtime=runtime,
                request_fallback_key=lambda: fallback_key_calls.append(1) or None,
                max_attempts=2,
                retry_sleep_seconds=0.0,
                rate_limit_sleep_seconds=0.0,
            )

        self.assertIs(returned_client, client)
        self.assertIsNone(result)
        self.assertEqual(runtime.rotated_keys, [])
        self.assertEqual(fallback_key_calls, [])
        self.assertEqual(fallback_keys, ["fallback-key-1", "fallback-key-2"])

    def test_cancel_during_fallback_validation_keeps_key_available(self):
        runtime = _FakeRuntime()
        client = object()
        cancel_event = threading.Event()
        fallback_keys = ["fallback-key-1"]

        class _ValidModels:
            def get(self, model=None, **kwargs):
                cancel_event.set()
                return {"model": model}

        class _ValidClient:
            def __init__(self, api_key=None, **kwargs):
                self.api_key = api_key
                self.models = _ValidModels()

        def fn(_client):
            raise RuntimeError("429 quota exceeded daily limit per day")

        with patch(
            "el_sbobinator.services.generation_service.genai.Client", _ValidClient
        ):
            returned_client, result = retry_with_quota(
                fn,
                client=client,
                fallback_keys=fallback_keys,
                model_name="test-model",
                cancelled=cancel_event.is_set,
                runtime=runtime,
                request_fallback_key=lambda: None,
                max_attempts=2,
                retry_sleep_seconds=0.0,
                rate_limit_sleep_seconds=0.0,
            )

        self.assertIs(returned_client, client)
        self.assertIsNone(result)
        self.assertEqual(runtime.rotated_keys, [])
        self.assertEqual(fallback_keys, ["fallback-key-1"])

    def test_detect_degenerate_output_flags_repeated_paragraphs(self):
        paragraph = "La ventilazione alveolare regola gli scambi gassosi in modo continuo durante tutta la respirazione."
        text = "\n\n".join([paragraph] * 4)
        self.assertIn("paragrafo ripetuto", detect_degenerate_output(text) or "")

    def test_detect_degenerate_output_flags_repeated_sentences(self):
        sentence = "E allora l'emoglobina cede piu facilmente l'ossigeno."
        text = " ".join([sentence] * 8)
        self.assertIn("frase ripetuta", detect_degenerate_output(text) or "")

    def test_503_phase_restored_after_switch_to_fallback(self):
        """503 retry 1/2 then retry 2/2 → switch model: each wait is followed by phase restore."""
        model_state = build_model_state(
            "gemini-2.5-flash", ["gemini-3.1-flash-lite-preview"], "gemini-2.5-flash"
        )
        rt = _FakeRuntime()

        def fn(current_client):
            err = RuntimeError("503 Service Unavailable")
            err.code = 503  # type: ignore[attr-defined]
            raise err

        with self.assertRaises(RuntimeError):
            retry_with_quota(
                fn,
                client=object(),
                fallback_keys=[],
                model_name="gemini-2.5-flash",
                model_state=model_state,
                cancelled=lambda: False,
                runtime=rt,
                request_fallback_key=lambda: None,
                max_attempts=2,
                retry_sleep_seconds=0.0,
                model_unavailable_retry_delays=(0.0, 0.0),
                resume_phase_text="Fase 1/3: trascrizione (chunk 1/5)",
            )

        resume_text = "Fase 1/3: trascrizione (chunk 1/5)"
        wait_msg = "Server Gemini occupato — ritento tra 0s"
        self.assertIn(wait_msg, rt.phase_calls)
        self.assertIn(resume_text, rt.phase_calls)
        first_wait = rt.phase_calls.index(wait_msg)
        first_resume = rt.phase_calls.index(resume_text)
        self.assertGreater(
            first_resume,
            first_wait,
            "resume phase must appear after first wait message",
        )
        second_wait = rt.phase_calls.index(wait_msg, first_resume)
        second_resume = rt.phase_calls.index(resume_text, second_wait)
        self.assertGreater(
            second_resume,
            second_wait,
            "resume phase must appear after second wait message",
        )

    def test_rate_limit_phase_restored_after_wait(self):
        """After rate-limit sleep, runtime.phase() receives the resume text
        before the next callable_fn() attempt."""
        rt = _FakeRuntime()
        call_count = [0]

        def fn(current_client):
            call_count[0] += 1
            if call_count[0] == 1:
                err = RuntimeError("429 Too Many Requests per minute")
                err.code = 429  # type: ignore[attr-defined]
                raise err
            return "ok"

        _, result = retry_with_quota(
            fn,
            client=object(),
            fallback_keys=[],
            model_name="test-model",
            cancelled=lambda: False,
            runtime=rt,
            request_fallback_key=lambda: None,
            max_attempts=3,
            retry_sleep_seconds=0.0,
            rate_limit_sleep_seconds=0.0,
            resume_phase_text="Fase 2/3: revisione (1/4)",
        )

        self.assertEqual(result, "ok")
        self.assertIn("⏳ Rate limit: attesa 65s...", rt.phase_calls)
        self.assertIn("Fase 2/3: revisione (1/4)", rt.phase_calls)
        wait_idx = rt.phase_calls.index("⏳ Rate limit: attesa 65s...")
        resume_idx = rt.phase_calls.index("Fase 2/3: revisione (1/4)")
        self.assertGreater(resume_idx, wait_idx)

    def test_503_third_attempt_succeeds_without_model_switch(self):
        """503x2 (original + retry 1) -> success on retry 2: no model switch, 3 total calls."""
        model_state = build_model_state(
            "gemini-2.5-flash", ["gemini-3.1-flash-lite-preview"], "gemini-2.5-flash"
        )
        switched = []
        call_count = [0]

        def fn(_client):
            call_count[0] += 1
            if call_count[0] <= 2:
                err = RuntimeError("503 Service Unavailable")
                err.code = 503  # type: ignore
                raise err
            return "ok"

        client, result = retry_with_quota(
            fn,
            client=object(),
            fallback_keys=[],
            model_name="gemini-2.5-flash",
            model_state=model_state,
            cancelled=lambda: False,
            runtime=_FakeRuntime(),
            request_fallback_key=lambda: None,
            max_attempts=2,
            retry_sleep_seconds=0.0,
            model_unavailable_retry_delays=(0.0, 0.0),
            rate_limit_sleep_seconds=0.0,
            on_model_switched=lambda old, new: switched.append((old, new)),
        )

        self.assertEqual(result, "ok")
        self.assertEqual(call_count[0], 3)
        self.assertEqual(model_state.current, "gemini-2.5-flash")
        self.assertEqual(
            switched,
            [],
            "no model switch must occur when success before retry budget exhausted",
        )

    def test_503_all_retries_exhausted_then_switches_model(self):
        """503x3 (original + retry 1 + retry 2) -> switch to fallback, which succeeds."""
        model_state = build_model_state(
            "gemini-2.5-flash", ["gemini-3.1-flash-lite-preview"], "gemini-2.5-flash"
        )
        switched = []
        call_count = [0]

        def fn(_client):
            call_count[0] += 1
            if model_state.current == "gemini-2.5-flash":
                err = RuntimeError("503 Service Unavailable")
                err.code = 503  # type: ignore[attr-defined]
                raise err
            return "ok"

        client, result = retry_with_quota(
            fn,
            client=object(),
            fallback_keys=[],
            model_name="gemini-2.5-flash",
            model_state=model_state,
            cancelled=lambda: False,
            runtime=_FakeRuntime(),
            request_fallback_key=lambda: None,
            max_attempts=2,
            retry_sleep_seconds=0.0,
            model_unavailable_retry_delays=(0.0, 0.0),
            rate_limit_sleep_seconds=0.0,
            on_model_switched=lambda old, new: switched.append((old, new)),
        )

        self.assertEqual(result, "ok")
        self.assertEqual(call_count[0], 4, "3 calls with flash + 1 with flash-lite")
        self.assertEqual(model_state.current, "gemini-3.1-flash-lite-preview")
        self.assertEqual(
            switched, [("gemini-2.5-flash", "gemini-3.1-flash-lite-preview")]
        )

    def test_503_two_waits_phase_restore_interleaved(self):
        """With two retry delays the phase sequence must be:
        wait1 → restore → wait2 → restore (→ switch or success)."""
        model_state = build_model_state(
            "gemini-2.5-flash", ["gemini-3.1-flash-lite-preview"], "gemini-2.5-flash"
        )
        rt = _FakeRuntime()
        call_count = [0]

        def fn(_client):
            call_count[0] += 1
            if call_count[0] <= 2:
                err = RuntimeError("503 Service Unavailable")
                err.code = 503  # type: ignore[attr-defined]
                raise err
            return "ok"

        retry_with_quota(
            fn,
            client=object(),
            fallback_keys=[],
            model_name="gemini-2.5-flash",
            model_state=model_state,
            cancelled=lambda: False,
            runtime=rt,
            request_fallback_key=lambda: None,
            max_attempts=2,
            retry_sleep_seconds=0.0,
            model_unavailable_retry_delays=(0.0, 0.0),
            rate_limit_sleep_seconds=0.0,
            resume_phase_text="Fase 1/3: trascrizione (chunk 3/10)",
        )

        wait_msg = "Server Gemini occupato — ritento tra 0s"
        restore = "Fase 1/3: trascrizione (chunk 3/10)"
        self.assertIn(wait_msg, rt.phase_calls)
        self.assertIn(restore, rt.phase_calls)
        idx_w1 = rt.phase_calls.index(wait_msg)
        idx_r1 = rt.phase_calls.index(restore)
        idx_w2 = rt.phase_calls.index(wait_msg, idx_r1)
        idx_r2 = rt.phase_calls.index(restore, idx_w2)
        self.assertLess(idx_w1, idx_r1)
        self.assertLess(idx_r1, idx_w2)
        self.assertLess(idx_w2, idx_r2)

    def test_503_cancel_during_second_retry_sleep_returns_none_no_switch(self):
        """If cancel fires during the second 503 sleep, returns (client, None) without switching model."""
        model_state = build_model_state(
            "gemini-2.5-flash", ["gemini-3.1-flash-lite-preview"], "gemini-2.5-flash"
        )
        switched = []
        sleep_call = [0]
        original_client = object()

        def fn(_client):
            err = RuntimeError("503 Service Unavailable")
            err.code = 503  # type: ignore[attr-defined]
            raise err

        def mock_sleep(cancelled_fn, seconds):
            sleep_call[0] += 1
            if sleep_call[0] >= 2:
                return False
            return True

        with patch(
            "el_sbobinator.services.generation_service.sleep_with_cancel",
            side_effect=mock_sleep,
        ):
            returned_client, result = retry_with_quota(
                fn,
                client=original_client,
                fallback_keys=[],
                model_name="gemini-2.5-flash",
                model_state=model_state,
                cancelled=lambda: False,
                runtime=_FakeRuntime(),
                request_fallback_key=lambda: None,
                max_attempts=2,
                retry_sleep_seconds=0.0,
                model_unavailable_retry_delays=(0.0, 0.0),
                rate_limit_sleep_seconds=0.0,
                on_model_switched=lambda old, new: switched.append((old, new)),
            )

        self.assertIsNone(result)
        self.assertIs(returned_client, original_client)
        self.assertEqual(
            switched, [], "model must not switch when cancel fires during sleep"
        )
        self.assertEqual(model_state.current, "gemini-2.5-flash")

    def test_503_inner_retry_raises_429_reraises_429_not_503(self):
        """Regression: when the inner 503-model-unavailable retry loop encounters a
        minute-scoped 429 and breaks, the terminal `raise exc` must surface the 429,
        not the original outer 503 that `sys.exc_info()` still holds."""
        model_state = build_model_state(
            "gemini-2.5-flash",
            ["gemini-3.1-flash-lite-preview"],
            "gemini-2.5-flash",
        )
        call_count = [0]

        def fn(_client):
            call_count[0] += 1
            if call_count[0] <= 3:
                err = RuntimeError("429 Too Many Requests per minute")
                err.code = 429  # type: ignore[attr-defined]
                raise err
            if call_count[0] == 4:
                err = RuntimeError("503 Service Unavailable")
                err.code = 503  # type: ignore[attr-defined]
                raise err
            err = RuntimeError("429 Too Many Requests per minute")
            err.code = 429  # type: ignore[attr-defined]
            raise err

        with self.assertRaises(RuntimeError) as ctx:
            retry_with_quota(
                fn,
                client=object(),
                fallback_keys=[],
                model_name="gemini-2.5-flash",
                model_state=model_state,
                cancelled=lambda: False,
                runtime=_FakeRuntime(),
                request_fallback_key=lambda: None,
                max_attempts=4,
                retry_sleep_seconds=0.0,
                model_unavailable_retry_delays=(0.0,),
                rate_limit_sleep_seconds=0.0,
            )

        self.assertNotIsInstance(ctx.exception, QuotaDailyLimitError)
        self.assertIn("429", str(ctx.exception))
        self.assertEqual(getattr(ctx.exception, "code", None), 429)
        self.assertNotIn("503", str(ctx.exception))
        self.assertEqual(model_state.current, "gemini-2.5-flash")

    def test_degenerate_output_switch_resets_attempts_for_fallback(self):
        """Bug B1: attempts not reset after DegenerateOutputError model-switch.
        Primary drains one attempt via a generic error, then raises DegenerateOutputError
        → model switch.  Without the fix, fallback only gets one try (attempts=1 < 2);
        with the fix, fallback gets a fresh budget and can retry once before succeeding."""
        model_state = build_model_state(
            "gemini-2.5-flash",
            ["gemini-3.1-flash-lite-preview"],
            "gemini-2.5-flash",
        )
        primary_calls = [0]
        fallback_calls = [0]

        def fn(_client):
            if model_state.current == "gemini-2.5-flash":
                primary_calls[0] += 1
                if primary_calls[0] == 1:
                    raise RuntimeError("generic transient error")
                raise DegenerateOutputError("frase ripetuta")
            fallback_calls[0] += 1
            if fallback_calls[0] == 1:
                raise RuntimeError("transient error on fallback")
            return "ok"

        _, result = retry_with_quota(
            fn,
            client=object(),
            fallback_keys=[],
            model_name="gemini-2.5-flash",
            model_state=model_state,
            cancelled=lambda: False,
            runtime=_FakeRuntime(),
            request_fallback_key=lambda: None,
            max_attempts=2,
            retry_sleep_seconds=0.0,
            model_unavailable_retry_delays=(0.0,),
            rate_limit_sleep_seconds=0.0,
        )

        self.assertEqual(result, "ok")
        self.assertEqual(
            fallback_calls[0],
            2,
            "fallback must get full retry budget after degenerate-output switch",
        )

    def test_model_not_found_switch_resets_attempts_for_fallback(self):
        """Bug B2: attempts not reset after model-not-found (404) switch.
        Primary drains one attempt via a generic error, then raises 404 → model switch.
        Fallback must get a fresh budget and be able to retry before succeeding."""
        model_state = build_model_state(
            "gemini-2.5-flash",
            ["gemini-3.1-flash-lite-preview"],
            "gemini-2.5-flash",
        )
        primary_calls = [0]
        fallback_calls = [0]

        def fn(_client):
            if model_state.current == "gemini-2.5-flash":
                primary_calls[0] += 1
                if primary_calls[0] == 1:
                    raise RuntimeError("generic transient error")
                err = RuntimeError(
                    "404 NOT_FOUND model unsupported for generateContent"
                )
                err.code = 404  # type: ignore[attr-defined]
                raise err
            fallback_calls[0] += 1
            if fallback_calls[0] == 1:
                raise RuntimeError("transient error on fallback")
            return "ok"

        _, result = retry_with_quota(
            fn,
            client=object(),
            fallback_keys=[],
            model_name="gemini-2.5-flash",
            model_state=model_state,
            cancelled=lambda: False,
            runtime=_FakeRuntime(),
            request_fallback_key=lambda: None,
            max_attempts=2,
            retry_sleep_seconds=0.0,
            model_unavailable_retry_delays=(0.0,),
            rate_limit_sleep_seconds=0.0,
        )

        self.assertEqual(result, "ok")
        self.assertEqual(
            fallback_calls[0], 2, "fallback must get full retry budget after 404 switch"
        )

    def test_503_model_switch_resets_attempts_for_fallback(self):
        """Bug B3: attempts not reset after 503-exhausted-retries model-switch.
        Primary drains one attempt via a generic error, then 503s through all retries
        → model switch.  Fallback must get a fresh budget and be able to retry."""
        model_state = build_model_state(
            "gemini-2.5-flash",
            ["gemini-3.1-flash-lite-preview"],
            "gemini-2.5-flash",
        )
        primary_calls = [0]
        fallback_calls = [0]

        def fn(_client):
            if model_state.current == "gemini-2.5-flash":
                primary_calls[0] += 1
                if primary_calls[0] == 1:
                    raise RuntimeError("generic transient error")
                err = RuntimeError("503 Service Unavailable")
                err.code = 503  # type: ignore[attr-defined]
                raise err
            fallback_calls[0] += 1
            if fallback_calls[0] == 1:
                raise RuntimeError("transient error on fallback")
            return "ok"

        _, result = retry_with_quota(
            fn,
            client=object(),
            fallback_keys=[],
            model_name="gemini-2.5-flash",
            model_state=model_state,
            cancelled=lambda: False,
            runtime=_FakeRuntime(),
            request_fallback_key=lambda: None,
            max_attempts=2,
            retry_sleep_seconds=0.0,
            model_unavailable_retry_delays=(0.0,),
            rate_limit_sleep_seconds=0.0,
        )

        self.assertEqual(result, "ok")
        self.assertEqual(
            fallback_calls[0], 2, "fallback must get full retry budget after 503 switch"
        )


class QuotaModelFallbackTests(unittest.TestCase):
    """When all API keys are exhausted, retry_with_quota should cascade to the
    next model in the chain instead of immediately raising QuotaDailyLimitError."""

    def test_all_keys_exhausted_switches_to_fallback_model(self):
        """After all keys drained, cascade to fallback model and succeed."""
        model_state = build_model_state(
            "gemini-2.5-flash", ["gemini-3.1-flash-lite-preview"]
        )
        switched = []

        def fn(_client):
            if model_state.current == "gemini-2.5-flash":
                raise RuntimeError("429 quota exceeded daily limit per day")
            return "ok"

        _, result = self._run(
            fn,
            model_state=model_state,
            on_model_switched=lambda old, new: switched.append((old, new)),
        )
        self.assertEqual(result, "ok")
        self.assertEqual(model_state.current, "gemini-3.1-flash-lite-preview")
        self.assertEqual(
            switched, [("gemini-2.5-flash", "gemini-3.1-flash-lite-preview")]
        )

    def test_all_keys_exhausted_no_fallback_raises_quota_error(self):
        """No fallback model in chain → QuotaDailyLimitError (regression guard)."""
        model_state = build_model_state("gemini-2.5-flash", [])

        def fn(_client):
            raise RuntimeError("429 quota exceeded daily limit per day")

        with self.assertRaises(QuotaDailyLimitError):
            self._run(fn, model_state=model_state)

    def test_all_keys_exhausted_no_model_state_raises_quota_error(self):
        """model_state=None → QuotaDailyLimitError (no chain to cascade through)."""

        def fn(_client):
            raise RuntimeError("429 quota exceeded daily limit per day")

        with self.assertRaises(QuotaDailyLimitError):
            self._run(fn, model_state=None)

    def _run(
        self,
        fn,
        model_state=None,
        fallback_keys=None,
        max_attempts=2,
        on_model_switched=None,
    ):
        return retry_with_quota(
            fn,
            client=object(),
            fallback_keys=fallback_keys if fallback_keys is not None else [],
            model_name="gemini-2.5-flash",
            model_state=model_state,
            cancelled=lambda: False,
            runtime=_FakeRuntime(),
            request_fallback_key=lambda: None,
            max_attempts=max_attempts,
            retry_sleep_seconds=0.0,
            rate_limit_sleep_seconds=0.0,
            on_model_switched=on_model_switched,
        )


class AllModelsUnavailableErrorTests(unittest.TestCase):
    """503 chain-exhaustion path raises AllModelsUnavailableError."""

    def _make_503(self):
        err = RuntimeError("503 Service Unavailable")
        err.code = 503  # type: ignore[attr-defined]
        return err

    def test_all_models_503_raises_all_models_unavailable_error(self):
        """When every model in the chain exhausts its 503 retries, retry_with_quota
        must raise AllModelsUnavailableError (not plain RuntimeError)."""
        model_state = build_model_state(
            "gemini-2.5-flash",
            ["gemini-3.1-flash-lite-preview"],
            "gemini-2.5-flash",
        )

        def fn(_client):
            raise self._make_503()

        with self.assertRaises(AllModelsUnavailableError):
            retry_with_quota(
                fn,
                client=object(),
                fallback_keys=[],
                model_name="gemini-2.5-flash",
                model_state=model_state,
                cancelled=lambda: False,
                runtime=_FakeRuntime(),
                request_fallback_key=lambda: None,
                max_attempts=2,
                retry_sleep_seconds=0.0,
                model_unavailable_retry_delays=(0.0,),
                rate_limit_sleep_seconds=0.0,
            )

    def test_first_model_503_switches_to_fallback_success(self):
        """Primary exhausts 503 retries → switches to fallback → fallback succeeds.
        Must NOT raise AllModelsUnavailableError."""
        model_state = build_model_state(
            "gemini-2.5-flash",
            ["gemini-3.1-flash-lite-preview"],
            "gemini-2.5-flash",
        )

        def fn(_client):
            if model_state.current == "gemini-2.5-flash":
                raise self._make_503()
            return "ok"

        _, result = retry_with_quota(
            fn,
            client=object(),
            fallback_keys=[],
            model_name="gemini-2.5-flash",
            model_state=model_state,
            cancelled=lambda: False,
            runtime=_FakeRuntime(),
            request_fallback_key=lambda: None,
            max_attempts=2,
            retry_sleep_seconds=0.0,
            model_unavailable_retry_delays=(0.0,),
            rate_limit_sleep_seconds=0.0,
        )

        self.assertEqual(result, "ok")
        self.assertEqual(model_state.current, "gemini-3.1-flash-lite-preview")


class IsModelUnavailableTests(unittest.TestCase):
    def _yes(self, text):
        self.assertTrue(
            _is_model_unavailable(text, 503),
            f"expected True for: {text!r}",
        )

    def _no(self, text, code=503):
        self.assertFalse(
            _is_model_unavailable(text, code),
            f"expected False for: {text!r} (code={code})",
        )

    def test_service_unavailable_matches(self):
        self._yes("503 service unavailable")

    def test_temporarily_unavailable_matches(self):
        self._yes("the model is temporarily unavailable, please retry")

    def test_backend_error_matches(self):
        self._yes("backend error encountered")

    def test_model_is_overloaded_matches(self):
        self._yes("model is overloaded")

    def test_overloaded_matches(self):
        self._yes("overloaded")

    def test_token_unavailable_does_not_match(self):
        """Regression: bare 'unavailable' was removed; 'token unavailable' must not trigger model switch."""
        self._no("token unavailable")

    def test_feature_unavailable_does_not_match(self):
        """Regression: bare 'unavailable' was removed; 'feature unavailable' must not trigger model switch."""
        self._no("feature unavailable")

    def test_non_503_code_never_matches(self):
        self._no("service unavailable", code=500)
        self._no("overloaded", code=429)


class Phase1TemperatureTests(unittest.TestCase):
    def setUp(self):
        from el_sbobinator.services.generation_service import _phase1_temperature

        self._t = _phase1_temperature

    def test_lite_models_temperature(self):
        self.assertEqual(self._t("gemini-3.1-flash-lite-preview"), 0.35)

    def test_non_lite_models_return_035(self):
        self.assertEqual(self._t("gemini-2.5-flash"), 0.35)
        self.assertEqual(self._t("gemini-3-flash-preview"), 0.35)

    def test_unknown_model_falls_back_to_035(self):
        self.assertEqual(self._t("gemini-unknown-model"), 0.35)

    def test_derives_from_model_options(self):
        from unittest.mock import patch

        from el_sbobinator.core.model_registry import MODEL_OPTIONS

        patched = tuple(
            {**opt, "phase1_temperature": 0.99}
            if opt["id"] == "gemini-2.5-flash"
            else opt
            for opt in MODEL_OPTIONS
        )
        with patch("el_sbobinator.services.generation_service.MODEL_OPTIONS", patched):
            self.assertEqual(self._t("gemini-2.5-flash"), 0.99)


if __name__ == "__main__":
    unittest.main()


# ============================================================
# Helper-function unit tests
# ============================================================


class ErrorHelperTests(unittest.TestCase):
    """_error_text, _error_code, _is_daily_or_key_exhausted"""

    def test_error_text_details_typeerror_fallback(self):
        from el_sbobinator.services.generation_service import _error_text

        exc = RuntimeError("boom")
        exc.details = {"bad": {1, 2, 3}}  # type: ignore[attr-defined]
        result = _error_text(exc)
        self.assertIn("boom", result)
        self.assertIn("bad", result)

    def test_error_text_includes_response_text(self):
        from el_sbobinator.services.generation_service import _error_text

        class _FakeResponse:
            text = "too many requests"

        exc = RuntimeError("err")
        exc.response = _FakeResponse()  # type: ignore[attr-defined]
        result = _error_text(exc)
        self.assertIn("too many requests", result)

    def test_error_code_non_numeric_returns_none(self):
        from el_sbobinator.services.generation_service import _error_code

        exc = RuntimeError("err")
        exc.code = "NOT_A_NUMBER"  # type: ignore[attr-defined]
        self.assertIsNone(_error_code(exc))

    def test_is_daily_exhausted_token_markers(self):
        from el_sbobinator.services.generation_service import _is_daily_or_key_exhausted

        self.assertTrue(_is_daily_or_key_exhausted("token balance exhausted", None))
        self.assertTrue(_is_daily_or_key_exhausted("tokens exceeded", None))

    def test_is_daily_exhausted_503_resource_exhausted(self):
        from el_sbobinator.services.generation_service import _is_daily_or_key_exhausted

        self.assertTrue(_is_daily_or_key_exhausted("resource_exhausted", 503))

    def test_is_daily_not_exhausted_for_minute_rate_limit(self):
        from el_sbobinator.services.generation_service import _is_daily_or_key_exhausted

        self.assertFalse(_is_daily_or_key_exhausted("rate limit per minute", 429))


class ExtractClientApiKeyTests(unittest.TestCase):
    def test_nested_api_client_path(self):
        from el_sbobinator.services.generation_service import extract_client_api_key

        class _Inner:
            api_key = "inner-key-xyz"

        class _Outer:
            api_key = None
            _api_client = _Inner()

        self.assertEqual(extract_client_api_key(_Outer()), "inner-key-xyz")

    def test_exception_returns_none(self):
        from el_sbobinator.services.generation_service import extract_client_api_key

        class _BadClient:
            @property
            def api_key(self):
                raise RuntimeError("no attr")

            @property
            def _api_client(self):
                raise RuntimeError("no attr")

        self.assertIsNone(extract_client_api_key(_BadClient()))


class LoadFallbackKeysTests(unittest.TestCase):
    def test_returns_keys_from_config(self):
        from el_sbobinator.services.generation_service import load_fallback_keys

        with patch(
            "el_sbobinator.services.generation_service.load_config",
            return_value={"fallback_keys": ["key1", "key2", ""]},
        ):
            self.assertEqual(load_fallback_keys(), ["key1", "key2"])

    def test_returns_empty_on_exception(self):
        from el_sbobinator.services.generation_service import load_fallback_keys

        with patch(
            "el_sbobinator.services.generation_service.load_config",
            side_effect=RuntimeError("no config"),
        ):
            self.assertEqual(load_fallback_keys(), [])


class TryRotateKeyEdgeCaseTests(unittest.TestCase):
    def test_empty_key_skipped_then_valid_key_rotated(self):
        from el_sbobinator.services.generation_service import try_rotate_key

        keys = ["", "valid-key"]

        class _FakeModels:
            def get(self, model=None, **_):
                return True

        class _FakeClient:
            def __init__(self, api_key=None, **_):
                self.models = _FakeModels()

        with patch(
            "el_sbobinator.services.generation_service.genai.Client", _FakeClient
        ):
            _, rotated, key = try_rotate_key(object(), keys, "test-model")

        self.assertTrue(rotated)
        self.assertEqual(key, "valid-key")
        self.assertEqual(keys, [])

    def test_cancel_at_loop_start_returns_original(self):
        from el_sbobinator.services.generation_service import try_rotate_key

        cancel = threading.Event()
        cancel.set()
        original = object()
        returned, rotated, key = try_rotate_key(
            original, ["some-key"], "test-model", cancelled=cancel.is_set
        )
        self.assertIs(returned, original)
        self.assertFalse(rotated)
        self.assertIsNone(key)

    def test_cancel_after_validation_returns_original(self):
        from el_sbobinator.services.generation_service import try_rotate_key

        cancel = threading.Event()

        class _FakeModels:
            def get(self, model=None, **_):
                cancel.set()
                return True

        class _FakeClient:
            def __init__(self, api_key=None, **_):
                self.models = _FakeModels()

        with patch(
            "el_sbobinator.services.generation_service.genai.Client", _FakeClient
        ):
            returned, rotated, key = try_rotate_key(
                object(), ["valid-key"], "test-model", cancelled=cancel.is_set
            )
        self.assertFalse(rotated)
        self.assertIsNone(key)


class WaitForFileReadyTests(unittest.TestCase):
    def test_timeout_raises_timeout_error(self):
        from el_sbobinator.services.generation_service import wait_for_file_ready

        class _PendingFile:
            state = "PENDING"
            name = "files/x"

        from unittest.mock import MagicMock

        client = MagicMock()
        client.files.get.return_value = _PendingFile()
        with patch(
            "el_sbobinator.services.generation_service.sleep_with_cancel",
            return_value=True,
        ):
            with self.assertRaises(TimeoutError):
                wait_for_file_ready(
                    client,
                    _PendingFile(),
                    lambda: False,
                    max_wait_seconds=0,
                    poll_seconds=1,
                )

    def test_failed_state_raises_runtime_error(self):
        from el_sbobinator.services.generation_service import wait_for_file_ready

        class _FailedFile:
            state = "FAILED"
            name = "files/x"

        with self.assertRaises(RuntimeError) as ctx:
            wait_for_file_ready(
                object(),
                _FailedFile(),
                lambda: False,
            )
        self.assertIn("FAILED", str(ctx.exception))

    def test_cancel_during_poll_returns_none(self):
        from el_sbobinator.services.generation_service import wait_for_file_ready

        class _PendingFile:
            state = "PENDING"
            name = "files/x"

        with patch(
            "el_sbobinator.services.generation_service.sleep_with_cancel",
            return_value=False,
        ):
            result = wait_for_file_ready(
                object(),
                _PendingFile(),
                lambda: True,
                max_wait_seconds=9999,
                poll_seconds=1,
            )
        self.assertIsNone(result)


class UploadMakeInlineTests(unittest.TestCase):
    def test_upload_audio_path_typeerror_fallback(self):
        from unittest.mock import MagicMock

        from el_sbobinator.services.generation_service import upload_audio_path

        client = MagicMock()
        client.files.upload.side_effect = [TypeError("no path kwarg"), "uploaded"]
        result = upload_audio_path(client, "/fake/path.mp3")
        self.assertEqual(result, "uploaded")
        self.assertEqual(client.files.upload.call_count, 2)

    def test_make_inline_audio_part_size_exceeded_returns_none(self):
        from el_sbobinator.services.generation_service import make_inline_audio_part

        with patch("os.path.getsize", return_value=10_000_000):
            result = make_inline_audio_part("/fake/file.mp3", max_bytes=5_000_000)
        self.assertIsNone(result)

    def test_make_inline_audio_part_open_exception_returns_none(self):
        from el_sbobinator.services.generation_service import make_inline_audio_part

        with patch("builtins.open", side_effect=FileNotFoundError("no file")):
            result = make_inline_audio_part("/nonexistent.mp3")
        self.assertIsNone(result)


class RequestNewApiKeyTests(unittest.TestCase):
    def test_returns_key_when_provided(self):
        from el_sbobinator.services.generation_service import request_new_api_key

        class _FakeRuntime:
            def ask_new_api_key(self, callback):
                callback({"key": "new-key-123"})
                return True

        result = request_new_api_key(_FakeRuntime(), lambda: False)
        self.assertEqual(result, "new-key-123")

    def test_returns_none_when_ask_returns_false(self):
        from el_sbobinator.services.generation_service import request_new_api_key

        class _FakeRuntime:
            def ask_new_api_key(self, callback):
                return False

        self.assertIsNone(request_new_api_key(_FakeRuntime(), lambda: False))

    def test_returns_none_when_cancelled_before_event(self):
        from el_sbobinator.services.generation_service import request_new_api_key

        cancel = threading.Event()
        cancel.set()

        class _FakeRuntime:
            def ask_new_api_key(self, callback):
                return True

        self.assertIsNone(request_new_api_key(_FakeRuntime(), cancel.is_set))

    def test_returns_none_and_marks_timeout(self):
        from el_sbobinator.services.generation_service import request_new_api_key

        timeout_called = threading.Event()

        class _FakeRuntime:
            dismissed = False

            def ask_new_api_key(self, callback):
                return True

            def dismiss_new_api_key_prompt(self):
                self.dismissed = True

        runtime = _FakeRuntime()
        result = request_new_api_key(
            runtime,
            lambda: False,
            timeout_seconds=0.01,
            on_timeout=timeout_called.set,
        )

        self.assertIsNone(result)
        self.assertTrue(timeout_called.is_set())
        self.assertTrue(runtime.dismissed)


class ExtractResponseTextMoreTests(unittest.TestCase):
    def test_text_none_returns_empty(self):
        from el_sbobinator.services.generation_service import extract_response_text

        class _Resp:
            text = None

        self.assertEqual(extract_response_text(_Resp()), "")

    def test_text_non_string_coerced(self):
        from el_sbobinator.services.generation_service import extract_response_text

        class _Resp:
            text = 42

        self.assertEqual(extract_response_text(_Resp()), "42")

    def test_candidates_fallback_when_text_empty(self):
        from el_sbobinator.services.generation_service import extract_response_text

        class _Part:
            text = "Candidate text content"

        class _Content:
            parts: ClassVar = [_Part()]

        class _Candidate:
            content = _Content()

        class _Resp:
            text = ""
            candidates: ClassVar = [_Candidate()]

        self.assertEqual(extract_response_text(_Resp()), "Candidate text content")


class BuildChunkPromptTests(unittest.TestCase):
    def test_with_previous_tail_includes_continuation(self):
        from el_sbobinator.services.generation_service import build_chunk_prompt

        prompt = build_chunk_prompt("...ultimi chars del blocco precedente")
        self.assertIn("ATTENZIONE", prompt)
        self.assertIn("continuando", prompt)
        self.assertIn("ultimi chars del blocco precedente", prompt)

    def test_without_previous_tail_no_continuation(self):
        from el_sbobinator.services.generation_service import build_chunk_prompt

        prompt = build_chunk_prompt("")
        self.assertNotIn("ATTENZIONE", prompt)
        self.assertIn("Trascrivi", prompt)


class DetectDegenerateMoreTests(unittest.TestCase):
    def test_whitespace_only_returns_none(self):
        self.assertIsNone(detect_degenerate_output("   \n\n  "))

    def test_empty_string_returns_none(self):
        self.assertIsNone(detect_degenerate_output(""))

    def test_long_paragraph_flagged(self):
        long_para = "parola " * 2000
        result = detect_degenerate_output(long_para)
        self.assertIsNotNone(result)
        assert result is not None
        self.assertIn("troppo lungo", result)

    def test_duplicate_paragraph_ratio_threshold(self):
        para = "A " * 50
        other = "B " * 50
        text = "\n\n".join([para.strip()] * 9 + [other.strip()])
        result = detect_degenerate_output(text)
        self.assertIsNotNone(result)

    def test_eccessivo_output_flagged(self):
        one_big = "A " * 25000
        text = "\n\n".join([one_big.strip()] * 5)
        result = detect_degenerate_output(text)
        self.assertIsNotNone(result)


class RetryWithQuotaEdgeTests(unittest.TestCase):
    def test_cancelled_at_start_skips_fn(self):
        called = []

        def fn(c):
            called.append(1)

        _, result = retry_with_quota(
            fn,
            client=object(),
            fallback_keys=[],
            model_name="test",
            cancelled=lambda: True,
            runtime=_FakeRuntime(),
            request_fallback_key=lambda: None,
            max_attempts=3,
            retry_sleep_seconds=0.0,
        )
        self.assertIsNone(result)
        self.assertEqual(called, [])

    def test_zero_max_attempts_returns_none(self):
        called = []

        def fn(c):
            called.append(1)

        _, result = retry_with_quota(
            fn,
            client=object(),
            fallback_keys=[],
            model_name="test",
            cancelled=lambda: False,
            runtime=_FakeRuntime(),
            request_fallback_key=lambda: None,
            max_attempts=0,
            retry_sleep_seconds=0.0,
        )
        self.assertIsNone(result)
        self.assertEqual(called, [])

    def test_permanent_error_propagates_immediately(self):
        from el_sbobinator.services.generation_service import PermanentError

        def fn(_c):
            raise PermanentError("400 INVALID_ARGUMENT")

        with self.assertRaises(PermanentError):
            retry_with_quota(
                fn,
                client=object(),
                fallback_keys=[],
                model_name="test",
                cancelled=lambda: False,
                runtime=_FakeRuntime(),
                request_fallback_key=lambda: None,
                max_attempts=3,
                retry_sleep_seconds=0.0,
            )

    def test_cancel_before_key_rotation_returns_none(self):
        calls = [0]

        def cancel_fn():
            calls[0] += 1
            return calls[0] >= 3

        def fn(_c):
            raise RuntimeError("429 quota exceeded daily limit per day")

        _, result = retry_with_quota(
            fn,
            client=object(),
            fallback_keys=[],
            model_name="test",
            cancelled=cancel_fn,
            runtime=_FakeRuntime(),
            request_fallback_key=lambda: None,
            max_attempts=2,
            retry_sleep_seconds=0.0,
            rate_limit_sleep_seconds=0.0,
        )
        self.assertIsNone(result)

    def test_on_key_rotated_called_after_successful_rotation(self):
        rotated = []

        class _FakeModels:
            def get(self, model=None, **_):
                return True

        class _FakeClient:
            def __init__(self, api_key=None, **_):
                self.models = _FakeModels()

        call_count = [0]

        def fn(_c):
            call_count[0] += 1
            if call_count[0] == 1:
                raise RuntimeError("quota exceeded daily limit per day")
            return "ok"

        with patch(
            "el_sbobinator.services.generation_service.try_rotate_key",
            return_value=(_FakeClient(), True, "rotated-key"),
        ):
            _, result = retry_with_quota(
                fn,
                client=object(),
                fallback_keys=["rotated-key"],
                model_name="test",
                cancelled=lambda: False,
                runtime=_FakeRuntime(),
                request_fallback_key=lambda: None,
                max_attempts=2,
                retry_sleep_seconds=0.0,
                rate_limit_sleep_seconds=0.0,
                on_key_rotated=lambda c: rotated.append(c),
            )

        self.assertEqual(result, "ok")
        self.assertEqual(len(rotated), 1)

    def test_new_api_key_valid_continues(self):
        from unittest.mock import MagicMock

        key_provided = ["new-valid-key"]
        call_count = [0]

        def fn(_c):
            call_count[0] += 1
            if call_count[0] == 1:
                raise RuntimeError("429 quota exceeded daily limit per day")
            return "ok"

        class _FakeModels:
            def get(self, model=None, **_):
                return True

        class _FakeClient:
            def __init__(self, api_key=None, **_):
                self.models = _FakeModels()

        def request_key():
            return key_provided.pop(0) if key_provided else None

        with patch(
            "el_sbobinator.services.generation_service.genai.Client", _FakeClient
        ):
            _, result = retry_with_quota(
                fn,
                client=object(),
                fallback_keys=[],
                model_name="test",
                cancelled=lambda: False,
                runtime=_FakeRuntime(),
                request_fallback_key=request_key,
                max_attempts=2,
                retry_sleep_seconds=0.0,
                rate_limit_sleep_seconds=0.0,
            )

        self.assertEqual(result, "ok")

    def test_new_api_key_invalid_falls_through_to_quota_error(self):
        def fn(_c):
            raise RuntimeError("429 quota exceeded daily limit per day")

        class _BadModels:
            def get(self, model=None, **_):
                raise RuntimeError("invalid key")

        class _BadClient:
            def __init__(self, api_key=None, **_):
                self.models = _BadModels()

        with patch(
            "el_sbobinator.services.generation_service.genai.Client", _BadClient
        ):
            with self.assertRaises(QuotaDailyLimitError):
                retry_with_quota(
                    fn,
                    client=object(),
                    fallback_keys=[],
                    model_name="test",
                    cancelled=lambda: False,
                    runtime=_FakeRuntime(),
                    request_fallback_key=lambda: "bad-key",
                    max_attempts=2,
                    retry_sleep_seconds=0.0,
                    rate_limit_sleep_seconds=0.0,
                )

    def test_cancel_during_rate_limit_sleep_returns_none(self):
        def fn(_c):
            err = RuntimeError("429 Too Many Requests per minute")
            err.code = 429  # type: ignore[attr-defined]
            raise err

        with patch(
            "el_sbobinator.services.generation_service.sleep_with_cancel",
            return_value=False,
        ):
            _, result = retry_with_quota(
                fn,
                client=object(),
                fallback_keys=[],
                model_name="test",
                cancelled=lambda: False,
                runtime=_FakeRuntime(),
                request_fallback_key=lambda: None,
                max_attempts=3,
                retry_sleep_seconds=0.0,
                rate_limit_sleep_seconds=0.0,
            )
        self.assertIsNone(result)

    def test_cancel_during_generic_retry_sleep_returns_none(self):
        call_count = [0]

        def fn(_c):
            call_count[0] += 1
            raise RuntimeError("transient network error")

        with patch(
            "el_sbobinator.services.generation_service.sleep_with_cancel",
            return_value=False,
        ):
            _, result = retry_with_quota(
                fn,
                client=object(),
                fallback_keys=[],
                model_name="test",
                cancelled=lambda: False,
                runtime=_FakeRuntime(),
                request_fallback_key=lambda: None,
                max_attempts=3,
                retry_sleep_seconds=0.0,
            )

        self.assertIsNone(result)
        self.assertEqual(call_count[0], 1)

    def test_cancel_during_503_inner_retry_attempt(self):
        """Cancel fires inside the inner-retry callable (line 561 path), not just the outer catch."""
        model_state = build_model_state(
            "gemini-2.5-flash", ["gemini-3.1-flash-lite-preview"], "gemini-2.5-flash"
        )
        cancel = threading.Event()
        call_count = [0]
        original_client = object()

        def fn(_c):
            call_count[0] += 1
            if call_count[0] == 1:
                err = RuntimeError("503 Service Unavailable")
                err.code = 503  # type: ignore[attr-defined]
                raise err
            cancel.set()
            raise RuntimeError("inner retry error")

        with patch(
            "el_sbobinator.services.generation_service.sleep_with_cancel",
            return_value=True,
        ):
            returned_client, result = retry_with_quota(
                fn,
                client=original_client,
                fallback_keys=[],
                model_name="gemini-2.5-flash",
                model_state=model_state,
                cancelled=cancel.is_set,
                runtime=_FakeRuntime(),
                request_fallback_key=lambda: None,
                max_attempts=2,
                retry_sleep_seconds=0.0,
                model_unavailable_retry_delays=(0.0,),
                rate_limit_sleep_seconds=0.0,
            )

        self.assertIsNone(result)
        self.assertIs(returned_client, original_client)
        self.assertEqual(call_count[0], 2)
