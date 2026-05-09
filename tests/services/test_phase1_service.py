import os
import tempfile
import threading
import unittest
from typing import ClassVar
from unittest.mock import MagicMock, patch

from el_sbobinator.core.model_registry import build_model_state
from el_sbobinator.services.generation_service import (
    AllModelsUnavailableError,
    DegenerateOutputError,
    QuotaDailyLimitError,
)
from el_sbobinator.services.phase1_service import process_phase1_transcription


class _FakeRuntime:
    def phase(self, _):
        pass

    def set_work_totals(self, **_):
        pass

    def update_work_done(self, *_, **__):
        pass

    def track_temp_file(self, _):
        pass

    def progress(self, _):
        pass

    def register_step_time(self, *_, **__):
        pass


class Phase1SessionErrorKeyTests(unittest.TestCase):
    def test_daily_quota_records_quota_daily_limit_phase1(self):
        """QuotaDailyLimitError in phase 1 must set last_error='quota_daily_limit_phase1'."""
        session = {
            "stage": "phase1",
            "phase1": {},
            "last_error": "phase1_chunk_failed_1",
            "last_error_detail": "old detail",
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            chunks_dir = os.path.join(tmpdir, "chunks")
            os.makedirs(chunks_dir)

            with (
                patch(
                    "el_sbobinator.services.phase1_service.cut_audio_chunk_to_mp3",
                    return_value=(True, None),
                ),
                patch(
                    "el_sbobinator.services.phase1_service.retry_with_quota",
                    side_effect=QuotaDailyLimitError("daily"),
                ),
            ):
                process_phase1_transcription(
                    client=object(),
                    model_name="test",
                    input_path="fake.mp3",
                    preconv_used_path=None,
                    ffmpeg_exe="ffmpeg",
                    cancel_event=threading.Event(),
                    cancelled=lambda: False,
                    start_sec=0,
                    total_duration_sec=60,
                    step_seconds=60,
                    chunk_seconds=60,
                    bitrate="48k",
                    inline_max_bytes=None,
                    prefetch_enabled=False,
                    phase1_chunks_dir=chunks_dir,
                    session=session,
                    save_session=lambda: True,
                    fallback_keys=[],
                    request_fallback_key=lambda: None,
                    system_prompt="test",
                    runtime=_FakeRuntime(),
                )

        self.assertEqual(
            session.get("last_error"),
            "quota_daily_limit_phase1",
            "session must record quota_daily_limit_phase1 when QuotaDailyLimitError is raised in phase 1",
        )

    def test_degenerate_output_stops_without_saving_chunk(self):
        session = {"stage": "phase1", "phase1": {}}

        class _Response:
            text = (
                "E allora l'emoglobina cede piu facilmente l'ossigeno. " * 8
            ).strip()

        class _Models:
            def generate_content(self, **_kwargs):
                return _Response()

        class _Client:
            def __init__(self):
                self.models = _Models()

        with tempfile.TemporaryDirectory() as tmpdir:
            chunks_dir = os.path.join(tmpdir, "chunks")
            os.makedirs(chunks_dir)

            with (
                patch(
                    "el_sbobinator.services.phase1_service.cut_audio_chunk_to_mp3",
                    return_value=(True, None),
                ),
                patch(
                    "el_sbobinator.services.phase1_service.generation_service.make_inline_audio_part",
                    return_value=object(),
                ),
                patch(
                    "el_sbobinator.services.phase1_service.retry_with_quota",
                    side_effect=lambda fn, **kwargs: (
                        kwargs["client"],
                        fn(kwargs["client"]),
                    ),
                ),
            ):
                _client, transcript, _prev = process_phase1_transcription(
                    client=_Client(),
                    model_name="gemini-2.5-flash",
                    input_path="fake.mp3",
                    preconv_used_path=None,
                    ffmpeg_exe="ffmpeg",
                    cancel_event=threading.Event(),
                    cancelled=lambda: False,
                    start_sec=0,
                    total_duration_sec=60,
                    step_seconds=60,
                    chunk_seconds=60,
                    bitrate="48k",
                    inline_max_bytes=None,
                    prefetch_enabled=False,
                    phase1_chunks_dir=chunks_dir,
                    session=session,
                    save_session=lambda: True,
                    fallback_keys=[],
                    request_fallback_key=lambda: None,
                    system_prompt="test",
                    runtime=_FakeRuntime(),
                )

            self.assertIsNone(transcript)
            self.assertEqual(session.get("last_error"), "phase1_degenerate_output")
            self.assertEqual(os.listdir(chunks_dir), [])

    def test_degenerate_output_chain_exhaustion_sets_specific_last_error(self):
        session = {"stage": "phase1", "phase1": {}}

        with tempfile.TemporaryDirectory() as tmpdir:
            chunks_dir = os.path.join(tmpdir, "chunks")
            os.makedirs(chunks_dir)

            with (
                patch(
                    "el_sbobinator.services.phase1_service.cut_audio_chunk_to_mp3",
                    return_value=(True, None),
                ),
                patch(
                    "el_sbobinator.services.phase1_service.generation_service.make_inline_audio_part",
                    return_value=object(),
                ),
                patch(
                    "el_sbobinator.services.phase1_service.retry_with_quota",
                    side_effect=__import__(
                        "el_sbobinator.services.generation_service",
                        fromlist=["DegenerateOutputError"],
                    ).DegenerateOutputError(
                        "Tutti i modelli della chain hanno prodotto output degenerato o non valido."
                    ),
                ),
            ):
                _client, transcript, _prev = process_phase1_transcription(
                    client=object(),
                    model_name="gemini-2.5-flash",
                    input_path="fake.mp3",
                    preconv_used_path=None,
                    ffmpeg_exe="ffmpeg",
                    cancel_event=threading.Event(),
                    cancelled=lambda: False,
                    start_sec=0,
                    total_duration_sec=60,
                    step_seconds=60,
                    chunk_seconds=60,
                    bitrate="48k",
                    inline_max_bytes=None,
                    prefetch_enabled=False,
                    phase1_chunks_dir=chunks_dir,
                    session=session,
                    save_session=lambda: True,
                    fallback_keys=[],
                    request_fallback_key=lambda: None,
                    system_prompt="test",
                    runtime=_FakeRuntime(),
                )

            self.assertIsNone(transcript)
            self.assertEqual(session.get("last_error"), "phase1_degenerate_output")
            self.assertEqual(os.listdir(chunks_dir), [])


class ChainExhaustionRecoveryTests(unittest.TestCase):
    _COMMON_KWARGS: ClassVar[dict] = dict(
        input_path="fake.mp3",
        preconv_used_path=None,
        ffmpeg_exe="ffmpeg",
        cancel_event=threading.Event(),
        cancelled=lambda: False,
        start_sec=0,
        total_duration_sec=60,
        step_seconds=60,
        chunk_seconds=60,
        bitrate="48k",
        inline_max_bytes=None,
        prefetch_enabled=False,
        system_prompt="test",
        fallback_keys=[],
        request_fallback_key=lambda: None,
    )

    def _run(
        self, session, chunks_dir, retry_side_effect, model_state=None, switched=None
    ):
        call_count = [0]
        effects = list(retry_side_effect) if not callable(retry_side_effect) else None

        def fake_retry(fn, **kwargs):
            call_count[0] += 1
            if effects is not None:
                effect = effects[min(call_count[0] - 1, len(effects) - 1)]
            else:
                effect = retry_side_effect(call_count[0])
            if isinstance(effect, BaseException):
                raise effect
            return kwargs["client"], effect

        on_switched = (
            (lambda old, new: switched.append((old, new)))
            if switched is not None
            else None
        )

        with (
            patch(
                "el_sbobinator.services.phase1_service.cut_audio_chunk_to_mp3",
                return_value=(True, None),
            ),
            patch(
                "el_sbobinator.services.phase1_service.generation_service.make_inline_audio_part",
                return_value=object(),
            ),
            patch(
                "el_sbobinator.services.phase1_service.retry_with_quota",
                side_effect=fake_retry,
            ),
            patch(
                "el_sbobinator.services.phase1_service.sleep_with_cancel",
                return_value=True,
            ),
        ):
            return process_phase1_transcription(  # type: ignore[arg-type]
                client=object(),
                model_name="gemini-2.5-flash",
                model_state=model_state,
                phase1_chunks_dir=chunks_dir,
                session=session,
                save_session=lambda: True,
                runtime=_FakeRuntime(),
                on_model_switched=on_switched,
                **self._COMMON_KWARGS,  # type: ignore[arg-type]
            ), call_count[0]

    def test_recovery_succeeds_on_extra_pass(self):
        """retry_with_quota exhausts the full model chain (DegenerateOutputError). Outer
        recovery resets model_state to primary and retries the chunk one more time.
        Extra pass returns valid output: one chunk saved, last_error absent."""
        session = {"stage": "phase1", "phase1": {}}
        switched = []
        model_state = build_model_state(
            "gemini-2.5-flash", ["gemini-2.5-flash-lite"], "gemini-2.5-flash-lite"
        )

        with tempfile.TemporaryDirectory() as tmpdir:
            chunks_dir = os.path.join(tmpdir, "chunks")
            os.makedirs(chunks_dir)

            (_, transcript, _), calls = self._run(
                session,
                chunks_dir,
                retry_side_effect=[
                    DegenerateOutputError("chain esaurita"),
                    "testo valido trascritto",
                ],
                model_state=model_state,
                switched=switched,
            )

            self.assertIsNotNone(transcript)
            self.assertIsNone(session.get("last_error"))
            self.assertEqual(len(os.listdir(chunks_dir)), 1)
            self.assertEqual(calls, 2)
            self.assertEqual(model_state.current, "gemini-2.5-flash")
            self.assertIn(("gemini-2.5-flash-lite", "gemini-2.5-flash"), switched)

    def test_recovery_extra_pass_also_exhausted_stops_job(self):
        """retry_with_quota exhausts the chain twice: once in the initial call and once
        in the outer recovery pass. No chunk saved, last_error='phase1_degenerate_output'."""
        session = {"stage": "phase1", "phase1": {}}

        with tempfile.TemporaryDirectory() as tmpdir:
            chunks_dir = os.path.join(tmpdir, "chunks")
            os.makedirs(chunks_dir)

            (_, transcript, _), calls = self._run(
                session,
                chunks_dir,
                retry_side_effect=[
                    DegenerateOutputError("chain esaurita prima volta"),
                    DegenerateOutputError("chain esaurita seconda volta"),
                ],
            )

            self.assertIsNone(transcript)
            self.assertEqual(session.get("last_error"), "phase1_degenerate_output")
            self.assertEqual(os.listdir(chunks_dir), [])
            self.assertEqual(calls, 2)

    def test_recovery_no_model_switch_callback_when_already_primary(self):
        """If model_state.current is already the primary when the chain is exhausted,
        the outer recovery resets the model but does NOT fire on_model_switched."""
        session = {"stage": "phase1", "phase1": {}}
        switched = []
        model_state = build_model_state("gemini-2.5-flash", [], "gemini-2.5-flash")

        with tempfile.TemporaryDirectory() as tmpdir:
            chunks_dir = os.path.join(tmpdir, "chunks")
            os.makedirs(chunks_dir)

            self._run(
                session,
                chunks_dir,
                retry_side_effect=[
                    DegenerateOutputError("chain esaurita"),
                    "testo valido trascritto",
                ],
                model_state=model_state,
                switched=switched,
            )

            self.assertEqual(switched, [])

    def test_recovery_extra_pass_503_switches_to_fallback_then_success(self):
        """Chain exhausted (fallback was active) → outer recovery resets to primary.
        Extra pass: primary gets 503 and retry_with_quota internally switches to fallback,
        returning valid output. Chunk saved, last_error absent."""
        session = {"stage": "phase1", "phase1": {}}
        switched = []
        # Start with fallback already active (prior 503 moved the model during this session)
        model_state = build_model_state(
            "gemini-2.5-flash", ["gemini-2.5-flash-lite"], "gemini-2.5-flash-lite"
        )

        call_count = [0]

        def fake_retry(fn, **kwargs):
            call_count[0] += 1
            if call_count[0] == 1:
                # First attempt: degenerate output exhausted the whole chain
                raise DegenerateOutputError(
                    "tutti i modelli hanno prodotto output degenerato"
                )
            # Second attempt (after recovery reset to primary):
            # simulate primary 503 → retry_with_quota switches to fallback internally
            ms = kwargs.get("model_state")
            if ms is not None:
                old = ms.current
                ms.current = "gemini-2.5-flash-lite"
                on_sw = kwargs.get("on_model_switched")
                if on_sw is not None and old != "gemini-2.5-flash-lite":
                    on_sw(old, "gemini-2.5-flash-lite")
            return kwargs["client"], "testo valido trascritto via fallback"

        saved_chunks = []
        with tempfile.TemporaryDirectory() as tmpdir:
            chunks_dir = os.path.join(tmpdir, "chunks")
            os.makedirs(chunks_dir)

            with (
                patch(
                    "el_sbobinator.services.phase1_service.cut_audio_chunk_to_mp3",
                    return_value=(True, None),
                ),
                patch(
                    "el_sbobinator.services.phase1_service.generation_service.make_inline_audio_part",
                    return_value=object(),
                ),
                patch(
                    "el_sbobinator.services.phase1_service.retry_with_quota",
                    side_effect=fake_retry,
                ),
            ):
                _client, transcript, _prev = process_phase1_transcription(  # type: ignore[arg-type]
                    client=object(),
                    model_name="gemini-2.5-flash",
                    model_state=model_state,
                    phase1_chunks_dir=chunks_dir,
                    session=session,
                    save_session=lambda: True,
                    runtime=_FakeRuntime(),
                    on_model_switched=lambda old, new: switched.append((old, new)),
                    **self._COMMON_KWARGS,  # type: ignore[arg-type]
                )

            saved_chunks = os.listdir(chunks_dir)

        self.assertIsNotNone(transcript)
        self.assertIsNone(session.get("last_error"))
        self.assertIsNone(session.get("last_error_detail"))
        self.assertEqual(len(saved_chunks), 1)
        self.assertEqual(call_count[0], 2)
        self.assertEqual(model_state.current, "gemini-2.5-flash-lite")
        # recovery: lite→flash; then 503 fallback: flash→lite
        self.assertIn(("gemini-2.5-flash-lite", "gemini-2.5-flash"), switched)
        self.assertIn(("gemini-2.5-flash", "gemini-2.5-flash-lite"), switched)

    def test_recovery_rebuilds_chunk_audio_for_each_pass(self):
        """cut_audio_chunk_to_mp3 and make_inline_audio_part must each be called once
        per outer-loop pass — twice total when the chain-exhaustion recovery fires —
        proving the chunk audio context is fully reconstructed before the extra pass."""
        from unittest.mock import MagicMock

        session = {"stage": "phase1", "phase1": {}}
        cut_mock = MagicMock(return_value=(True, None))
        inline_mock = MagicMock(return_value=object())
        call_count = [0]

        def fake_retry(fn, **kwargs):
            call_count[0] += 1
            if call_count[0] == 1:
                raise DegenerateOutputError("chain esaurita")
            return kwargs["client"], "testo valido trascritto"

        with tempfile.TemporaryDirectory() as tmpdir:
            chunks_dir = os.path.join(tmpdir, "chunks")
            os.makedirs(chunks_dir)

            with (
                patch(
                    "el_sbobinator.services.phase1_service.cut_audio_chunk_to_mp3",
                    cut_mock,
                ),
                patch(
                    "el_sbobinator.services.phase1_service.generation_service.make_inline_audio_part",
                    inline_mock,
                ),
                patch(
                    "el_sbobinator.services.phase1_service.retry_with_quota",
                    side_effect=fake_retry,
                ),
            ):
                process_phase1_transcription(  # type: ignore[arg-type]
                    client=object(),
                    model_name="gemini-2.5-flash",
                    phase1_chunks_dir=chunks_dir,
                    session=session,
                    save_session=lambda: True,
                    runtime=_FakeRuntime(),
                    **self._COMMON_KWARGS,  # type: ignore[arg-type]
                )

        self.assertEqual(
            cut_mock.call_count, 2, "chunk audio must be re-cut on each attempt"
        )
        self.assertEqual(
            inline_mock.call_count,
            2,
            "inline audio part must be rebuilt on each attempt",
        )

    def test_all_models_unavailable_triggers_recovery_then_succeeds(self):
        """Compound failure: AllModelsUnavailableError (all 503) triggers the same
        chain-exhaustion recovery as DegenerateOutputError.  Second attempt succeeds:
        one chunk saved, last_error absent."""
        session = {"stage": "phase1", "phase1": {}}
        switched = []
        model_state = build_model_state(
            "gemini-2.5-flash", ["gemini-2.5-flash-lite"], "gemini-2.5-flash-lite"
        )

        with tempfile.TemporaryDirectory() as tmpdir:
            chunks_dir = os.path.join(tmpdir, "chunks")
            os.makedirs(chunks_dir)

            (_, transcript, _), calls = self._run(
                session,
                chunks_dir,
                retry_side_effect=[
                    AllModelsUnavailableError("tutti i modelli 503"),
                    "testo valido trascritto",
                ],
                model_state=model_state,
                switched=switched,
            )

            self.assertIsNotNone(transcript)
            self.assertIsNone(session.get("last_error"))
            self.assertEqual(len(os.listdir(chunks_dir)), 1)
            self.assertEqual(calls, 2)
            self.assertEqual(model_state.current, "gemini-2.5-flash")
            self.assertIn(("gemini-2.5-flash-lite", "gemini-2.5-flash"), switched)

    def test_all_models_unavailable_twice_sets_specific_error(self):
        """AllModelsUnavailableError on both the initial attempt and the recovery pass:
        transcript is None, last_error='phase1_all_models_unavailable'."""
        session = {"stage": "phase1", "phase1": {}}

        with tempfile.TemporaryDirectory() as tmpdir:
            chunks_dir = os.path.join(tmpdir, "chunks")
            os.makedirs(chunks_dir)

            (_, transcript, _), calls = self._run(
                session,
                chunks_dir,
                retry_side_effect=[
                    AllModelsUnavailableError("tutti i modelli 503 - prima volta"),
                    AllModelsUnavailableError("tutti i modelli 503 - seconda volta"),
                ],
            )

            self.assertIsNone(transcript)
            self.assertEqual(session.get("last_error"), "phase1_all_models_unavailable")
            self.assertEqual(os.listdir(chunks_dir), [])
            self.assertEqual(calls, 2)


class Phase1UploadModeTests(unittest.TestCase):
    """Tests for the upload audio path and inline→upload fallback inside _call."""

    _COMMON_KWARGS: ClassVar[dict] = dict(
        model_name="test-model",
        input_path="fake.mp3",
        preconv_used_path=None,
        ffmpeg_exe="ffmpeg",
        cancel_event=threading.Event(),
        cancelled=lambda: False,
        start_sec=0,
        total_duration_sec=60,
        step_seconds=60,
        chunk_seconds=60,
        bitrate="48k",
        inline_max_bytes=None,
        prefetch_enabled=False,
        system_prompt="test",
        fallback_keys=[],
        request_fallback_key=lambda: None,
    )

    def test_upload_mode_path_when_inline_returns_none(self):
        """When make_inline_audio_part returns None, _call must use upload_audio_path
        and wait_for_file_ready to obtain the audio input for the API call."""
        session = {"stage": "phase1", "phase1": {}}

        class _FakeAudioFile:
            uri = "gs://fake/audio.mp3"
            mime_type = "audio/mpeg"
            name = "files/fake"

        fake_file = _FakeAudioFile()
        upload_mock = MagicMock(return_value=fake_file)
        wait_mock = MagicMock(return_value=fake_file)
        fake_client = MagicMock()
        fake_client.models.generate_content.return_value = MagicMock()

        with tempfile.TemporaryDirectory() as tmpdir:
            chunks_dir = os.path.join(tmpdir, "chunks")
            os.makedirs(chunks_dir)

            with (
                patch(
                    "el_sbobinator.services.phase1_service.cut_audio_chunk_to_mp3",
                    return_value=(True, None),
                ),
                patch(
                    "el_sbobinator.services.phase1_service.generation_service.make_inline_audio_part",
                    return_value=None,
                ),
                patch(
                    "el_sbobinator.services.phase1_service.generation_service.upload_audio_path",
                    upload_mock,
                ),
                patch(
                    "el_sbobinator.services.phase1_service.generation_service.wait_for_file_ready",
                    wait_mock,
                ),
                patch("el_sbobinator.services.phase1_service.types") as mock_types,
                patch(
                    "el_sbobinator.services.phase1_service.extract_response_text",
                    return_value="Testo trascritto.",
                ),
                patch(
                    "el_sbobinator.services.phase1_service.detect_degenerate_output",
                    return_value=None,
                ),
                patch(
                    "el_sbobinator.services.phase1_service.sleep_with_cancel",
                    return_value=True,
                ),
                patch(
                    "el_sbobinator.services.phase1_service.retry_with_quota",
                    side_effect=lambda fn, **kw: (kw["client"], fn(kw["client"])),
                ),
            ):
                mock_types.Part.from_uri.return_value = MagicMock()
                mock_types.GenerateContentConfig.return_value = MagicMock()

                _, transcript, _ = process_phase1_transcription(  # type: ignore[arg-type]
                    client=fake_client,
                    phase1_chunks_dir=chunks_dir,
                    session=session,
                    save_session=lambda: True,
                    runtime=_FakeRuntime(),
                    **self._COMMON_KWARGS,  # type: ignore[arg-type]
                )

                self.assertIsNotNone(transcript)
                assert transcript is not None
                self.assertIn("Testo trascritto.", transcript)
                upload_mock.assert_called_once()
                wait_mock.assert_called_once()
                fake_client.models.generate_content.assert_called_once()
                self.assertEqual(len(os.listdir(chunks_dir)), 1)

    def test_inline_to_upload_fallback_on_payload_error(self):
        """When inline audio raises a 'too large' error, _call must flip
        audio_mode to 'upload' and retry, calling upload_audio_path exactly once."""
        session = {"stage": "phase1", "phase1": {}}

        class _FakeAudioFile:
            uri = "gs://fake/audio.mp3"
            mime_type = "audio/mpeg"
            name = "files/fake"

        fake_file = _FakeAudioFile()
        upload_mock = MagicMock(return_value=fake_file)
        wait_mock = MagicMock(return_value=fake_file)
        generate_call_count = [0]

        def fake_generate(*args, **kw):
            generate_call_count[0] += 1
            if generate_call_count[0] == 1:
                raise RuntimeError("Request payload too large")
            return MagicMock()

        fake_client = MagicMock()
        fake_client.models.generate_content.side_effect = fake_generate

        with tempfile.TemporaryDirectory() as tmpdir:
            chunks_dir = os.path.join(tmpdir, "chunks")
            os.makedirs(chunks_dir)

            with (
                patch(
                    "el_sbobinator.services.phase1_service.cut_audio_chunk_to_mp3",
                    return_value=(True, None),
                ),
                patch(
                    "el_sbobinator.services.phase1_service.generation_service.make_inline_audio_part",
                    return_value=object(),
                ),
                patch(
                    "el_sbobinator.services.phase1_service.generation_service.upload_audio_path",
                    upload_mock,
                ),
                patch(
                    "el_sbobinator.services.phase1_service.generation_service.wait_for_file_ready",
                    wait_mock,
                ),
                patch("el_sbobinator.services.phase1_service.types") as mock_types,
                patch(
                    "el_sbobinator.services.phase1_service.extract_response_text",
                    return_value="Testo trascritto via upload.",
                ),
                patch(
                    "el_sbobinator.services.phase1_service.detect_degenerate_output",
                    return_value=None,
                ),
                patch(
                    "el_sbobinator.services.phase1_service.sleep_with_cancel",
                    return_value=True,
                ),
                patch(
                    "el_sbobinator.services.phase1_service.retry_with_quota",
                    side_effect=lambda fn, **kw: (kw["client"], fn(kw["client"])),
                ),
            ):
                mock_types.Part.from_uri.return_value = MagicMock()
                mock_types.GenerateContentConfig.return_value = MagicMock()

                _, transcript, _ = process_phase1_transcription(  # type: ignore[arg-type]
                    client=fake_client,
                    phase1_chunks_dir=chunks_dir,
                    session=session,
                    save_session=lambda: True,
                    runtime=_FakeRuntime(),
                    **self._COMMON_KWARGS,  # type: ignore[arg-type]
                )

                self.assertIsNotNone(transcript)
                assert transcript is not None
                self.assertIn("Testo trascritto via upload.", transcript)
                self.assertEqual(
                    generate_call_count[0],
                    2,
                    "generate_content must be called twice: inline fail then upload succeed",
                )
                upload_mock.assert_called_once()
                wait_mock.assert_called_once()


if __name__ == "__main__":
    unittest.main()


class TestPhase1EdgeCases(unittest.TestCase):
    """Tests for uncovered branches in phase1_service.process_phase1_transcription."""

    # Common kwargs for single-chunk runs (60s file, 60s step/chunk = 1 chunk)
    _COMMON_KWARGS: ClassVar[dict] = {
        "model_name": "test-model",
        "model_state": None,
        "ffmpeg_exe": "ffmpeg",
        "cancel_event": threading.Event(),
        "cancelled": lambda: False,
        "start_sec": 0,
        "total_duration_sec": 60,
        "step_seconds": 60,
        "chunk_seconds": 60,
        "bitrate": "128k",
        "inline_max_bytes": 8 * 1024 * 1024,
        "prefetch_enabled": False,  # off by default; enable per-test when needed
        "initial_full_transcript": "",
        "initial_prev_memory": "",
        "fallback_keys": [],
        "request_fallback_key": lambda: None,
        "system_prompt": "Transcribe.",
        "runtime": _FakeRuntime(),
        "on_model_switched": None,
        "logger": None,
    }

    def _run(self, session, client=None, **overrides):
        """Helper: run process_phase1_transcription with common defaults."""
        with tempfile.TemporaryDirectory() as tmpdir:
            chunks_dir = os.path.join(tmpdir, "chunks")
            os.makedirs(chunks_dir)
            kwargs = self._COMMON_KWARGS.copy()
            kwargs.update(overrides)
            with patch(
                "el_sbobinator.services.phase1_service.sleep_with_cancel",
                return_value=True,
            ):
                return process_phase1_transcription(
                    client=client or object(),
                    input_path="fake.mp3",
                    preconv_used_path=None,
                    phase1_chunks_dir=chunks_dir,
                    session=session,
                    save_session=lambda: True,
                    **kwargs,
                )

    # ── prefetch disabled ──────────────────────────────────────────────────────

    def test_prefetch_disabled_never_calls_start_prefetch(self):
        """prefetch_enabled=False → only 1 cut call, no thread started."""
        session = {"stage": "phase1", "phase1": {}}
        cut_calls = []

        def fake_cut(**kw):
            cut_calls.append(kw.get("stream_copy"))
            return True, None

        with (
            patch(
                "el_sbobinator.services.phase1_service.cut_audio_chunk_to_mp3",
                side_effect=fake_cut,
            ),
            patch(
                "el_sbobinator.services.phase1_service.retry_with_quota",
                return_value=(object(), "Testo."),
            ),
        ):
            _, transcript, _ = self._run(session, prefetch_enabled=False)

        self.assertIn("Testo.", transcript)
        self.assertEqual(len(cut_calls), 1)

    # ── stream-copy fallback ────────────────────────────────────────────────────

    def test_preconv_stream_copy_failure_falls_back_to_reencode(self):
        """When stream_copy fails, _cut_chunk_to_path re-encodes from the original."""
        with tempfile.TemporaryDirectory() as tmpdir:
            chunks_dir = os.path.join(tmpdir, "chunks")
            os.makedirs(chunks_dir)
            preconv_path = os.path.join(tmpdir, "preconv.mp3")
            with open(preconv_path, "wb") as fh:
                fh.write(b"fake audio data")

            session = {"stage": "phase1", "phase1": {}}
            calls = []

            def fake_cut(**kw):
                calls.append(bool(kw.get("stream_copy")))
                return (
                    (False, "stream_copy failed")
                    if kw.get("stream_copy")
                    else (True, None)
                )

            with (
                patch(
                    "el_sbobinator.services.phase1_service.cut_audio_chunk_to_mp3",
                    side_effect=fake_cut,
                ),
                patch(
                    "el_sbobinator.services.phase1_service.retry_with_quota",
                    return_value=(object(), "Testo."),
                ),
                patch(
                    "el_sbobinator.services.phase1_service.sleep_with_cancel",
                    return_value=True,
                ),
            ):
                _, transcript, _ = process_phase1_transcription(
                    client=object(),
                    input_path="fake.mp3",
                    preconv_used_path=preconv_path,
                    phase1_chunks_dir=chunks_dir,
                    session=session,
                    save_session=lambda: True,
                    **self._COMMON_KWARGS,
                )

        self.assertIn("Testo.", transcript)
        # First call is stream_copy=True (preconv), second is stream_copy=False (reencode)
        self.assertEqual(calls, [True, False])

    # ── cancellation ───────────────────────────────────────────────────────────

    def test_cancelled_before_first_chunk_returns_none(self):
        """If cancelled() is True at the start of the chunk loop, return None."""
        cancel = threading.Event()
        cancel.set()
        session = {"stage": "phase1", "phase1": {}}
        kwargs = self._COMMON_KWARGS.copy()
        kwargs["cancel_event"] = cancel
        kwargs["cancelled"] = cancel.is_set

        with patch(
            "el_sbobinator.services.phase1_service.cut_audio_chunk_to_mp3",
            return_value=(False, "cancelled"),
        ):
            _, transcript, _ = self._run(session, **kwargs)

        self.assertIsNone(transcript)

    def test_ffmpeg_error_sets_chunk_failed(self):
        """FFmpeg failure (non-cancel) raises RuntimeError → chunk_failed session error."""
        session = {"stage": "phase1", "phase1": {}}

        with patch(
            "el_sbobinator.services.phase1_service.cut_audio_chunk_to_mp3",
            return_value=(False, "ffmpeg io error"),
        ):
            _, transcript, _ = self._run(session)

        self.assertIsNone(transcript)
        self.assertEqual(session.get("last_error"), "phase1_chunk_failed_1")
        self.assertIn("ffmpeg io error", session.get("last_error_detail", ""))

    def test_cut_raises_exception_sets_chunk_failed(self):
        """Unhandled exception during cut → outer except → chunk_failed."""
        session = {"stage": "phase1", "phase1": {}}

        with patch(
            "el_sbobinator.services.phase1_service.cut_audio_chunk_to_mp3",
            side_effect=RuntimeError("disk full"),
        ):
            _, transcript, _ = self._run(session)

        self.assertIsNone(transcript)
        self.assertEqual(session.get("last_error"), "phase1_chunk_failed_1")
        self.assertIn("disk full", session.get("last_error_detail", ""))

    # ── upload mode ────────────────────────────────────────────────────────────

    def test_inline_none_triggers_upload_mode(self):
        """make_inline_audio_part=None → upload path, transcript still populated."""
        session = {"stage": "phase1", "phase1": {}}
        fake_audio = MagicMock()
        fake_audio.uri = "gs://bucket/audio.mp3"
        fake_audio.mime_type = "audio/mpeg"
        fake_client = MagicMock()
        fake_client.models.generate_content.return_value = MagicMock()

        with (
            patch(
                "el_sbobinator.services.phase1_service.cut_audio_chunk_to_mp3",
                return_value=(True, None),
            ),
            patch(
                "el_sbobinator.services.phase1_service.generation_service.make_inline_audio_part",
                return_value=None,
            ),
            patch(
                "el_sbobinator.services.phase1_service.generation_service.upload_audio_path",
                return_value=fake_audio,
            ),
            patch(
                "el_sbobinator.services.phase1_service.generation_service.wait_for_file_ready",
                return_value=fake_audio,
            ),
            patch("el_sbobinator.services.phase1_service.types") as mock_types,
            patch(
                "el_sbobinator.services.phase1_service.extract_response_text",
                return_value="Trascritto.",
            ),
            patch(
                "el_sbobinator.services.phase1_service.detect_degenerate_output",
                return_value=None,
            ),
            patch(
                "el_sbobinator.services.phase1_service.retry_with_quota",
                side_effect=lambda fn, **kw: (kw["client"], fn(kw["client"])),
            ),
        ):
            mock_types.Part.from_uri.return_value = MagicMock()
            mock_types.GenerateContentConfig.return_value = MagicMock()
            _, transcript, _ = self._run(session, client=fake_client)

        self.assertIn("Trascritto.", transcript)

    def test_inline_invalid_argument_falls_back_to_upload(self):
        """'invalid_argument' error during inline generate → fallback to upload → success."""
        session = {"stage": "phase1", "phase1": {}}
        fake_audio = MagicMock()
        fake_audio.uri = "gs://bucket/audio.mp3"
        fake_audio.mime_type = "audio/mpeg"
        call_count = [0]
        fake_client = MagicMock()

        def fake_generate(**_kw):
            call_count[0] += 1
            if call_count[0] == 1:
                raise RuntimeError("invalid_argument: payload too large")
            return MagicMock()

        fake_client.models.generate_content.side_effect = fake_generate

        with (
            patch(
                "el_sbobinator.services.phase1_service.cut_audio_chunk_to_mp3",
                return_value=(True, None),
            ),
            patch(
                "el_sbobinator.services.phase1_service.generation_service.make_inline_audio_part",
                return_value=MagicMock(),
            ),
            patch(
                "el_sbobinator.services.phase1_service.generation_service.upload_audio_path",
                return_value=fake_audio,
            ),
            patch(
                "el_sbobinator.services.phase1_service.generation_service.wait_for_file_ready",
                return_value=fake_audio,
            ),
            patch("el_sbobinator.services.phase1_service.types") as mock_types,
            patch(
                "el_sbobinator.services.phase1_service.extract_response_text",
                return_value="Trascritto.",
            ),
            patch(
                "el_sbobinator.services.phase1_service.detect_degenerate_output",
                return_value=None,
            ),
            patch(
                "el_sbobinator.services.phase1_service.retry_with_quota",
                side_effect=lambda fn, **kw: (kw["client"], fn(kw["client"])),
            ),
        ):
            mock_types.Part.from_uri.return_value = MagicMock()
            mock_types.GenerateContentConfig.return_value = MagicMock()
            _, transcript, _ = self._run(session, client=fake_client)

        self.assertIn("Trascritto.", transcript)
        self.assertEqual(call_count[0], 2)

    def test_permanent_400_error_sets_bad_request_phase1(self):
        """400/BadRequest in upload mode raises PermanentError → last_error = bad_request_phase1.

        Inline mode would first trigger the inline→upload fallback (since the error text
        contains '400'). Using upload mode directly (make_inline_audio_part=None) ensures
        the permanent-error branch is reached immediately.
        """
        session = {"stage": "phase1", "phase1": {}}
        fake_audio = MagicMock()
        fake_audio.uri = "gs://bucket/audio.mp3"
        fake_audio.mime_type = "audio/mpeg"
        fake_client = MagicMock()
        # generate_content always raises a hard 400
        fake_client.models.generate_content.side_effect = RuntimeError(
            "BadRequest INVALID_ARGUMENT"
        )

        with (
            patch(
                "el_sbobinator.services.phase1_service.cut_audio_chunk_to_mp3",
                return_value=(True, None),
            ),
            # None → upload mode (avoids inline→upload fallback ambiguity)
            patch(
                "el_sbobinator.services.phase1_service.generation_service.make_inline_audio_part",
                return_value=None,
            ),
            patch(
                "el_sbobinator.services.phase1_service.generation_service.upload_audio_path",
                return_value=fake_audio,
            ),
            patch(
                "el_sbobinator.services.phase1_service.generation_service.wait_for_file_ready",
                return_value=fake_audio,
            ),
            patch("el_sbobinator.services.phase1_service.types") as mock_types,
            patch(
                "el_sbobinator.services.phase1_service.retry_with_quota",
                side_effect=lambda fn, **kw: (kw["client"], fn(kw["client"])),
            ),
        ):
            mock_types.Part.from_uri.return_value = MagicMock()
            mock_types.GenerateContentConfig.return_value = MagicMock()
            _, transcript, _ = self._run(session, client=fake_client)

        self.assertIsNone(transcript)
        self.assertEqual(session.get("last_error"), "bad_request_phase1")

    # ── chain exhaustion recovery ───────────────────────────────────────────────

    def test_degenerate_output_triggers_recovery_and_succeeds(self):
        """First retry_with_quota raises DegenerateOutputError → model reset → second call succeeds."""
        from el_sbobinator.core.model_registry import ModelState

        model_state = ModelState(
            chain=("flash-1.5", "flash-1.5-8b"), current="flash-1.5-8b"
        )
        switched = []

        session = {"stage": "phase1", "phase1": {}}
        kwargs = self._COMMON_KWARGS.copy()
        kwargs["model_state"] = model_state
        kwargs["on_model_switched"] = lambda old, new: switched.append((old, new))

        with (
            patch(
                "el_sbobinator.services.phase1_service.cut_audio_chunk_to_mp3",
                return_value=(True, None),
            ),
            patch(
                "el_sbobinator.services.phase1_service.retry_with_quota",
                side_effect=[
                    DegenerateOutputError("repetition", "aaabbb"),  # raises → recovery
                    (object(), "Testo ripreso."),  # returns → success
                ],
            ),
        ):
            _, transcript, _ = self._run(session, **kwargs)

        self.assertIn("Testo ripreso.", transcript)
        self.assertEqual(switched, [("flash-1.5-8b", "flash-1.5")])

    def test_degenerate_output_recovery_also_fails_sets_error(self):
        """Both calls raise DegenerateOutputError → last_error = phase1_degenerate_output."""
        from el_sbobinator.core.model_registry import ModelState

        model_state = ModelState(
            chain=("flash-1.5", "flash-1.5-8b"), current="flash-1.5-8b"
        )
        session = {"stage": "phase1", "phase1": {}}
        kwargs = self._COMMON_KWARGS.copy()
        kwargs["model_state"] = model_state

        with (
            patch(
                "el_sbobinator.services.phase1_service.cut_audio_chunk_to_mp3",
                return_value=(True, None),
            ),
            patch(
                "el_sbobinator.services.phase1_service.retry_with_quota",
                side_effect=[
                    DegenerateOutputError("repetition", "aaa"),
                    DegenerateOutputError("repetition again", "bbb"),
                ],
            ),
        ):
            _, transcript, _ = self._run(session, **kwargs)

        self.assertIsNone(transcript)
        self.assertEqual(session.get("last_error"), "phase1_degenerate_output")

    def test_all_models_unavailable_triggers_recovery_and_succeeds(self):
        """AllModelsUnavailableError → model reset → second call succeeds."""
        from el_sbobinator.core.model_registry import ModelState

        model_state = ModelState(
            chain=("flash-1.5", "flash-1.5-8b"), current="flash-1.5-8b"
        )
        switched = []
        session = {"stage": "phase1", "phase1": {}}
        kwargs = self._COMMON_KWARGS.copy()
        kwargs["model_state"] = model_state
        kwargs["on_model_switched"] = lambda old, new: switched.append((old, new))

        with (
            patch(
                "el_sbobinator.services.phase1_service.cut_audio_chunk_to_mp3",
                return_value=(True, None),
            ),
            patch(
                "el_sbobinator.services.phase1_service.retry_with_quota",
                side_effect=[
                    AllModelsUnavailableError("all down"),
                    (object(), "Testo ripreso."),
                ],
            ),
        ):
            _, transcript, _ = self._run(session, **kwargs)

        self.assertIn("Testo ripreso.", transcript)
        self.assertEqual(switched, [("flash-1.5-8b", "flash-1.5")])

    def test_all_models_unavailable_recovery_also_fails_sets_error(self):
        """Both calls raise AllModelsUnavailableError → last_error = phase1_all_models_unavailable."""
        from el_sbobinator.core.model_registry import ModelState

        model_state = ModelState(
            chain=("flash-1.5", "flash-1.5-8b"), current="flash-1.5-8b"
        )
        session = {"stage": "phase1", "phase1": {}}
        kwargs = self._COMMON_KWARGS.copy()
        kwargs["model_state"] = model_state

        with (
            patch(
                "el_sbobinator.services.phase1_service.cut_audio_chunk_to_mp3",
                return_value=(True, None),
            ),
            patch(
                "el_sbobinator.services.phase1_service.retry_with_quota",
                side_effect=[
                    AllModelsUnavailableError("all down"),
                    AllModelsUnavailableError("still down"),
                ],
            ),
        ):
            _, transcript, _ = self._run(session, **kwargs)

        self.assertIsNone(transcript)
        self.assertEqual(session.get("last_error"), "phase1_all_models_unavailable")

    # ── autosave / cleanup ─────────────────────────────────────────────────────

    def test_autosave_write_failure_stops_pipeline_without_advancing_position(self):
        """_atomic_write_text raising stops the pipeline and must not advance
        next_start_sec or memoria_precedente (resume bookmark stays consistent)."""
        session: dict = {
            "stage": "phase1",
            "phase1": {"next_start_sec": 0, "chunks_done": 0, "memoria_precedente": ""},
        }

        with (
            patch(
                "el_sbobinator.services.phase1_service.cut_audio_chunk_to_mp3",
                return_value=(True, None),
            ),
            patch(
                "el_sbobinator.services.phase1_service.retry_with_quota",
                return_value=(object(), "Testo."),
            ),
            patch(
                "el_sbobinator.services.phase1_service._atomic_write_text",
                side_effect=OSError("disk full"),
            ),
        ):
            _, transcript, _ = self._run(session)

        self.assertIsNone(transcript)
        self.assertEqual(session.get("phase1", {}).get("next_start_sec", 0), 0)
        self.assertEqual(session.get("phase1", {}).get("memoria_precedente", ""), "")
        self.assertEqual(session.get("last_error"), "phase1_chunk_failed_1")

    def test_chunk_file_removal_failure_is_swallowed(self):
        """os.remove failing in finally block does not abort the transcription."""
        session = {"stage": "phase1", "phase1": {}}

        with (
            patch(
                "el_sbobinator.services.phase1_service.cut_audio_chunk_to_mp3",
                return_value=(True, None),
            ),
            patch(
                "el_sbobinator.services.phase1_service.retry_with_quota",
                return_value=(object(), "Testo."),
            ),
            patch(
                "el_sbobinator.services.phase1_service.os.remove",
                side_effect=OSError("locked"),
            ),
        ):
            _, transcript, _ = self._run(session)

        self.assertIn("Testo.", transcript)

    def test_audio_file_delete_failure_in_finally_is_swallowed(self):
        """client.files.delete() raising in the finally block is swallowed."""
        session = {"stage": "phase1", "phase1": {}}
        fake_audio = MagicMock()
        fake_audio.uri = "gs://bucket/audio.mp3"
        fake_audio.mime_type = "audio/mpeg"
        fake_client = MagicMock()
        fake_client.files.delete.side_effect = OSError("delete failed")

        with (
            patch(
                "el_sbobinator.services.phase1_service.cut_audio_chunk_to_mp3",
                return_value=(True, None),
            ),
            patch(
                "el_sbobinator.services.phase1_service.generation_service.make_inline_audio_part",
                return_value=None,
            ),
            patch(
                "el_sbobinator.services.phase1_service.generation_service.upload_audio_path",
                return_value=fake_audio,
            ),
            patch(
                "el_sbobinator.services.phase1_service.generation_service.wait_for_file_ready",
                return_value=fake_audio,
            ),
            patch("el_sbobinator.services.phase1_service.types") as mock_types,
            patch(
                "el_sbobinator.services.phase1_service.extract_response_text",
                return_value="Testo.",
            ),
            patch(
                "el_sbobinator.services.phase1_service.detect_degenerate_output",
                return_value=None,
            ),
            patch(
                "el_sbobinator.services.phase1_service.retry_with_quota",
                side_effect=lambda fn, **kw: (kw["client"], fn(kw["client"])),
            ),
        ):
            mock_types.Part.from_uri.return_value = MagicMock()
            mock_types.GenerateContentConfig.return_value = MagicMock()
            _, transcript, _ = self._run(session, client=fake_client)

        self.assertIn("Testo.", transcript)


class TestChunkFileSaveFailure(unittest.TestCase):
    """next_start_sec / memoria_precedente must not advance when the chunk file write fails."""

    _COMMON_KWARGS: ClassVar[dict] = dict(
        model_name="test-model",
        model_state=None,
        input_path="fake.mp3",
        preconv_used_path=None,
        ffmpeg_exe="ffmpeg",
        cancel_event=threading.Event(),
        cancelled=lambda: False,
        start_sec=0,
        total_duration_sec=60,
        step_seconds=60,
        chunk_seconds=60,
        bitrate="48k",
        inline_max_bytes=None,
        prefetch_enabled=False,
        initial_full_transcript="",
        initial_prev_memory="",
        fallback_keys=[],
        request_fallback_key=lambda: None,
        system_prompt="test",
        on_model_switched=None,
        logger=None,
    )

    def test_chunk_file_write_failure_does_not_advance_next_start_sec(self):
        """If _atomic_write_text raises (e.g. rename after write fails), next_start_sec
        and memoria_precedente must NOT be advanced in the session, the pipeline must
        stop (None transcript), and last_error must be set.  The real
        _atomic_write_text runs so we also verify that neither the final .md file
        nor the intermediate .tmp file survives a failed atomic write."""
        import copy

        session: dict = {
            "stage": "phase1",
            "phase1": {"next_start_sec": 0, "chunks_done": 0, "memoria_precedente": ""},
        }
        saved_snapshots: list[dict] = []

        def recording_save() -> bool:
            saved_snapshots.append(copy.deepcopy(session))
            return True

        with tempfile.TemporaryDirectory() as tmpdir:
            chunks_dir = os.path.join(tmpdir, "chunks")
            os.makedirs(chunks_dir)

            with (
                patch(
                    "el_sbobinator.services.phase1_service.cut_audio_chunk_to_mp3",
                    return_value=(True, None),
                ),
                patch(
                    "el_sbobinator.services.phase1_service.retry_with_quota",
                    return_value=(object(), "Testo trascritto chunk 1."),
                ),
                patch(
                    "el_sbobinator.core.shared.os.replace",
                    side_effect=OSError("No space left on device"),
                ),
            ):
                _, transcript, _ = process_phase1_transcription(
                    client=object(),
                    phase1_chunks_dir=chunks_dir,
                    session=session,
                    save_session=recording_save,
                    runtime=_FakeRuntime(),
                    **self._COMMON_KWARGS,  # type: ignore[arg-type]
                )

            self.assertIsNone(
                transcript, "pipeline must stop when chunk file cannot be written"
            )
            self.assertEqual(
                session.get("phase1", {}).get("next_start_sec", 0),
                0,
                "next_start_sec must not advance past an unwritten chunk",
            )
            self.assertEqual(
                session.get("phase1", {}).get("memoria_precedente", ""),
                "",
                "memoria_precedente must not be updated when chunk file was not saved",
            )
            self.assertEqual(
                session.get("last_error"),
                "phase1_chunk_failed_1",
                "last_error must be set to phase1_chunk_failed_1",
            )
            self.assertEqual(
                os.listdir(chunks_dir),
                [],
                "neither the .md chunk file nor the .tmp intermediate must survive a failed atomic write",
            )
            self.assertEqual(
                len(saved_snapshots),
                1,
                "save_session must be called exactly once (error-path call only, not the success-path call)",
            )
            self.assertEqual(
                saved_snapshots[0].get("last_error"),
                "phase1_chunk_failed_1",
                "snapshot must show last_error == 'phase1_chunk_failed_1' at the moment of save",
            )
            self.assertEqual(
                saved_snapshots[0].get("phase1", {}).get("next_start_sec", 0),
                0,
                "snapshot must show next_start_sec == 0 (not advanced past the unwritten chunk)",
            )
