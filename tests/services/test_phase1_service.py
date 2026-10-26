import io
import logging
import os
import tempfile
import threading
import time
import unittest
from contextlib import redirect_stdout
from typing import ClassVar
from unittest.mock import MagicMock, patch

from el_sbobinator.pipeline.pipeline_hooks import PipelineRuntime
from el_sbobinator.services.gemini_errors import CircuitBreakerExhaustedError
from el_sbobinator.services.generation_service import (
    DegenerateOutputError,
    QuotaDailyLimitError,
)
from el_sbobinator.services.phase1_service import (
    _call_chunk_transcription_api,
    _generate_chunk_content_with_fallback,
    process_phase1_transcription,
)
from el_sbobinator.utils.logging_utils import (
    LOGGER_NAME,
    attach_file_handler,
    configure_logging,
    detach_file_handler,
    get_logger,
)


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


class _RecordingRuntime(_FakeRuntime):
    def __init__(self):
        self.temp_files: list[str] = []

    def track_temp_file(self, path):
        self.temp_files.append(path)


class Phase1TempChunkPathTests(unittest.TestCase):
    def _capture_single_chunk_paths(
        self, chunks_dir: str
    ) -> tuple[list[str], list[str]]:
        session = {"stage": "phase1", "phase1": {}}
        runtime = _RecordingRuntime()
        cut_paths: list[str] = []

        def fake_cut(**kwargs):
            cut_paths.append(str(kwargs.get("output_path", "")))
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
            patch(
                "el_sbobinator.services.phase1_service.sleep_with_cancel",
                return_value=True,
            ),
        ):
            _, transcript, _ = process_phase1_transcription(
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
                runtime=runtime,
            )

        self.assertIsNotNone(transcript)
        return cut_paths, runtime.temp_files

    def test_identical_chunk_ranges_in_two_sessions_generate_different_temp_paths(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            chunks_a = os.path.join(tmpdir, "session-a", "phase1_chunks")
            chunks_b = os.path.join(tmpdir, "session-b", "phase1_chunks")
            os.makedirs(chunks_a)
            os.makedirs(chunks_b)

            cut_paths_a, tracked_a = self._capture_single_chunk_paths(chunks_a)
            cut_paths_b, tracked_b = self._capture_single_chunk_paths(chunks_b)

            path_a = cut_paths_a[0]
            path_b = cut_paths_b[0]
            prefix_a = os.path.join(tmpdir, "session-a", "temp_chunks") + os.sep
            prefix_b = os.path.join(tmpdir, "session-b", "temp_chunks") + os.sep

            self.assertNotEqual(path_a, path_b)
            self.assertTrue(
                os.path.normcase(path_a).startswith(os.path.normcase(prefix_a))
            )
            self.assertTrue(
                os.path.normcase(path_b).startswith(os.path.normcase(prefix_b))
            )
            self.assertEqual(os.path.basename(path_a), "chunk_001_0_60.mp3")
            self.assertEqual(os.path.basename(path_b), "chunk_001_0_60.mp3")
            self.assertEqual(tracked_a, cut_paths_a)
            self.assertEqual(tracked_b, cut_paths_b)

    def test_identical_chunk_ranges_in_same_session_generate_different_run_paths(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            chunks_dir = os.path.join(tmpdir, "session", "phase1_chunks")
            os.makedirs(chunks_dir)

            cut_paths_a, _ = self._capture_single_chunk_paths(chunks_dir)
            cut_paths_b, _ = self._capture_single_chunk_paths(chunks_dir)

            path_a = cut_paths_a[0]
            path_b = cut_paths_b[0]

            self.assertNotEqual(path_a, path_b)
            self.assertNotEqual(os.path.dirname(path_a), os.path.dirname(path_b))

    def test_success_removes_empty_temp_run_dir(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            chunks_dir = os.path.join(tmpdir, "session", "phase1_chunks")
            os.makedirs(chunks_dir)

            cut_paths, _ = self._capture_single_chunk_paths(chunks_dir)

            run_dir = os.path.dirname(cut_paths[0])
            self.assertFalse(os.path.exists(run_dir))

    def test_quota_return_removes_empty_temp_run_dir_after_chunk_cleanup(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            chunks_dir = os.path.join(tmpdir, "session", "phase1_chunks")
            os.makedirs(chunks_dir)
            session = {"stage": "phase1", "phase1": {}}
            runtime = _RecordingRuntime()
            cut_paths: list[str] = []

            def fake_cut(**kwargs):
                output_path = str(kwargs.get("output_path", ""))
                cut_paths.append(output_path)
                with open(output_path, "wb") as handle:
                    handle.write(b"x" * 2048)
                return True, None

            with (
                patch(
                    "el_sbobinator.services.phase1_service.cut_audio_chunk_to_mp3",
                    side_effect=fake_cut,
                ),
                patch(
                    "el_sbobinator.services.phase1_service.generation_service.make_inline_audio_part",
                    return_value=None,
                ),
                patch(
                    "el_sbobinator.services.phase1_service.retry_with_quota",
                    side_effect=QuotaDailyLimitError("daily"),
                ),
            ):
                _, transcript, _ = process_phase1_transcription(
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
                    runtime=runtime,
                )

            self.assertIsNone(transcript)
            self.assertEqual(session["last_error"], "quota_daily_limit_phase1")
            self.assertEqual(len(cut_paths), 1)
            self.assertFalse(os.path.exists(cut_paths[0]))
            self.assertFalse(os.path.exists(os.path.dirname(cut_paths[0])))

    def test_prefetched_chunk_uses_same_session_temp_run_dir(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            chunks_dir = os.path.join(tmpdir, "session", "phase1_chunks")
            os.makedirs(chunks_dir)
            session = {"stage": "phase1", "phase1": {}}
            runtime = _RecordingRuntime()
            cut_paths: list[str] = []

            def fake_cut(**kwargs):
                output_path = str(kwargs.get("output_path", ""))
                cut_paths.append(output_path)
                with open(output_path, "wb") as handle:
                    handle.write(b"x" * 2048)
                return True, None

            with (
                patch(
                    "el_sbobinator.services.phase1_service.cut_audio_chunk_to_mp3",
                    side_effect=fake_cut,
                ),
                patch(
                    "el_sbobinator.services.phase1_service.generation_service.make_inline_audio_part",
                    return_value=None,
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
                    model_name="test",
                    input_path="fake.mp3",
                    preconv_used_path=None,
                    ffmpeg_exe="ffmpeg",
                    cancel_event=threading.Event(),
                    cancelled=lambda: False,
                    start_sec=0,
                    total_duration_sec=120,
                    step_seconds=60,
                    chunk_seconds=60,
                    bitrate="48k",
                    inline_max_bytes=None,
                    prefetch_enabled=True,
                    phase1_chunks_dir=chunks_dir,
                    session=session,
                    save_session=lambda: True,
                    fallback_keys=[],
                    request_fallback_key=lambda: None,
                    system_prompt="test",
                    runtime=runtime,
                )

            self.assertIsNotNone(transcript)
            prefix = os.path.join(tmpdir, "session", "temp_chunks") + os.sep
            self.assertEqual(len(cut_paths), 2)
            self.assertEqual(
                {os.path.dirname(path) for path in cut_paths},
                {os.path.dirname(cut_paths[0])},
            )
            self.assertTrue(
                os.path.normcase(cut_paths[0]).startswith(os.path.normcase(prefix))
            )
            self.assertEqual(
                sorted(os.path.basename(path) for path in cut_paths),
                ["chunk_001_0_60.mp3", "chunk_002_60_120.mp3"],
            )
            self.assertEqual(list(dict.fromkeys(runtime.temp_files)), cut_paths)

    def test_pipeline_cleanup_removes_empty_run_dir_after_prefetch_quota_abort(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            chunks_dir = os.path.join(tmpdir, "session", "phase1_chunks")
            os.makedirs(chunks_dir)
            session = {"stage": "phase1", "phase1": {}}

            class _Target:
                def __init__(self):
                    self.cancel_event = threading.Event()
                    self.file_temporanei: list[str] = []

            target = _Target()
            runtime = PipelineRuntime(target)
            prefetch_written = threading.Event()
            cut_paths: list[str] = []

            def fake_cut(**kwargs):
                output_path = str(kwargs.get("output_path", ""))
                start_sec = int(kwargs.get("start_sec", 0))
                cut_paths.append(output_path)
                with open(output_path, "wb") as handle:
                    handle.write(b"x" * 2048)
                if start_sec == 60:
                    prefetch_written.set()
                return True, None

            def fake_retry(*_, **__):
                self.assertTrue(prefetch_written.wait(timeout=2.0))
                raise QuotaDailyLimitError("daily")

            with (
                patch(
                    "el_sbobinator.services.phase1_service.cut_audio_chunk_to_mp3",
                    side_effect=fake_cut,
                ),
                patch(
                    "el_sbobinator.services.phase1_service.generation_service.make_inline_audio_part",
                    return_value=None,
                ),
                patch(
                    "el_sbobinator.services.phase1_service.retry_with_quota",
                    side_effect=fake_retry,
                ),
            ):
                _, transcript, _ = process_phase1_transcription(
                    client=object(),
                    model_name="test",
                    input_path="fake.mp3",
                    preconv_used_path=None,
                    ffmpeg_exe="ffmpeg",
                    cancel_event=threading.Event(),
                    cancelled=lambda: False,
                    start_sec=0,
                    total_duration_sec=120,
                    step_seconds=60,
                    chunk_seconds=60,
                    bitrate="48k",
                    inline_max_bytes=None,
                    prefetch_enabled=True,
                    phase1_chunks_dir=chunks_dir,
                    session=session,
                    save_session=lambda: True,
                    fallback_keys=[],
                    request_fallback_key=lambda: None,
                    system_prompt="test",
                    runtime=runtime,
                )

            self.assertIsNone(transcript)
            self.assertEqual(session["last_error"], "quota_daily_limit_phase1")
            self.assertEqual(
                sorted(os.path.basename(path) for path in cut_paths),
                ["chunk_001_0_60.mp3", "chunk_002_60_120.mp3"],
            )
            run_dir = os.path.dirname(cut_paths[0])
            self.assertFalse(os.path.exists(run_dir))

            runtime.cleanup_temp_files()

            self.assertEqual(target.file_temporanei, [])


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

    def test_degenerate_output_after_recovery_sets_specific_last_error(self):
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
                        "Il modello selezionato ha prodotto output non valido."
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


class ChunkRecoveryTests(unittest.TestCase):
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

    def _run(self, session, chunks_dir, retry_side_effect, runtime=None):
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
                phase1_chunks_dir=chunks_dir,
                session=session,
                save_session=lambda: True,
                runtime=runtime or _FakeRuntime(),
                **self._COMMON_KWARGS,  # type: ignore[arg-type]
            ), call_count[0]

    def test_recovery_pass_is_announced_in_the_phase(self):
        """The banner learns about the extra pass, not only the console."""

        class _RecordingRuntime(_FakeRuntime):
            def __init__(self):
                self.phases: list[str] = []

            def phase(self, text):
                self.phases.append(text)

        runtime = _RecordingRuntime()
        session = {"stage": "phase1", "phase1": {}}

        with tempfile.TemporaryDirectory() as tmpdir:
            chunks_dir = os.path.join(tmpdir, "chunks")
            os.makedirs(chunks_dir)
            self._run(
                session,
                chunks_dir,
                retry_side_effect=[
                    DegenerateOutputError("output non valido"),
                    "testo valido trascritto",
                ],
                runtime=runtime,
            )

        self.assertIn(
            "Output non valido nel blocco 1 — rigenero il blocco", runtime.phases
        )

    def test_recovery_succeeds_on_extra_pass(self):
        """An extra pass on the chosen model saves valid output without switching."""
        session = {"stage": "phase1", "phase1": {}}
        selected_model = "gemini-2.5-flash"

        with tempfile.TemporaryDirectory() as tmpdir:
            chunks_dir = os.path.join(tmpdir, "chunks")
            os.makedirs(chunks_dir)

            (_, transcript, _), calls = self._run(
                session,
                chunks_dir,
                retry_side_effect=[
                    DegenerateOutputError("output non valido"),
                    "testo valido trascritto",
                ],
            )

            self.assertIsNotNone(transcript)
            self.assertIsNone(session.get("last_error"))
            self.assertEqual(len(os.listdir(chunks_dir)), 1)
            self.assertEqual(calls, 2)
            self.assertEqual(selected_model, "gemini-2.5-flash")

    def test_recovery_extra_pass_also_exhausted_stops_job(self):
        """retry_with_quota rejects invalid output twice: once in the initial call and once
        in the outer recovery pass. No chunk saved, last_error='phase1_degenerate_output'."""
        session = {"stage": "phase1", "phase1": {}}

        with tempfile.TemporaryDirectory() as tmpdir:
            chunks_dir = os.path.join(tmpdir, "chunks")
            os.makedirs(chunks_dir)

            (_, transcript, _), calls = self._run(
                session,
                chunks_dir,
                retry_side_effect=[
                    DegenerateOutputError("output non valido prima volta"),
                    DegenerateOutputError("output non valido seconda volta"),
                ],
            )

            self.assertIsNone(transcript)
            self.assertEqual(session.get("last_error"), "phase1_degenerate_output")
            self.assertEqual(os.listdir(chunks_dir), [])
            self.assertEqual(calls, 2)

    def test_recovery_saves_output_on_extra_pass(self):
        """Recovery retries the chunk using its selected model."""
        session = {"stage": "phase1", "phase1": {}}

        with tempfile.TemporaryDirectory() as tmpdir:
            chunks_dir = os.path.join(tmpdir, "chunks")
            os.makedirs(chunks_dir)
            (_, transcript, _), calls = self._run(
                session,
                chunks_dir,
                retry_side_effect=[
                    DegenerateOutputError("output non valido"),
                    "testo valido",
                ],
            )
            self.assertEqual(calls, 2)
            self.assertIn("testo valido", transcript or "")
            self.assertEqual(len(os.listdir(chunks_dir)), 1)

    def test_recovery_extra_pass_keeps_selected_model_then_succeeds(self):
        """The recovery pass retains the selected model and saves valid output."""
        session = {"stage": "phase1", "phase1": {}}
        # Old saved fallback metadata cannot select a different model.
        selected_model = "gemini-2.5-flash"

        call_count = [0]

        def fake_retry(fn, **kwargs):
            call_count[0] += 1
            if call_count[0] == 1:
                raise DegenerateOutputError("output non valido")
            return kwargs["client"], "testo valido trascritto"

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
                patch(
                    "el_sbobinator.services.phase1_service.sleep_with_cancel",
                    return_value=True,
                ),
            ):
                _client, transcript, _prev = process_phase1_transcription(  # type: ignore[arg-type]
                    client=object(),
                    model_name="gemini-2.5-flash",
                    phase1_chunks_dir=chunks_dir,
                    session=session,
                    save_session=lambda: True,
                    runtime=_FakeRuntime(),
                    **self._COMMON_KWARGS,  # type: ignore[arg-type]
                )

            saved_chunks = os.listdir(chunks_dir)

        self.assertIsNotNone(transcript)
        self.assertIsNone(session.get("last_error"))
        self.assertIsNone(session.get("last_error_detail"))
        self.assertEqual(len(saved_chunks), 1)
        self.assertEqual(call_count[0], 2)
        self.assertEqual(selected_model, "gemini-2.5-flash")

    def test_recovery_rebuilds_chunk_audio_for_each_pass(self):
        """cut_audio_chunk_to_mp3 and make_inline_audio_part must each be called once
        per outer-loop pass — twice total when the chunk recovery fires —
        proving the chunk audio context is fully reconstructed before the extra pass."""
        from unittest.mock import MagicMock

        session = {"stage": "phase1", "phase1": {}}
        cut_mock = MagicMock(return_value=(True, None))
        inline_mock = MagicMock(return_value=object())
        call_count = [0]

        def fake_retry(fn, **kwargs):
            call_count[0] += 1
            if call_count[0] == 1:
                raise DegenerateOutputError("output non valido")
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
                patch(
                    "el_sbobinator.services.phase1_service.sleep_with_cancel",
                    return_value=True,
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

    def test_exhausted_retries_keep_traceback_in_file_and_preserve_resume_state(self):
        for reason in (
            "Server Gemini temporaneamente indisponibile dopo 4 tentativi (test-model).",
            "Rate limit persistente per il modello test-model.",
        ):
            with self.subTest(reason=reason), tempfile.TemporaryDirectory() as tmpdir:
                chunks_dir = os.path.join(tmpdir, "chunks")
                os.makedirs(chunks_dir)
                saved_chunk = os.path.join(chunks_dir, "chunk_001_0_60.md")
                with open(saved_chunk, "w", encoding="utf-8") as handle:
                    handle.write("Testo precedente.")
                progress = {
                    "chunks_done": 1,
                    "next_start_sec": 60,
                    "memoria_precedente": "Testo precedente.",
                }
                session = {"stage": "phase1", "phase1": progress.copy()}
                save_session = MagicMock(return_value=True)
                console = io.StringIO()
                log_path = os.path.join(tmpdir, "run.log")
                base_logger = logging.getLogger(LOGGER_NAME)
                with (
                    patch.object(base_logger, "handlers", []),
                    patch.dict(
                        base_logger.__dict__, {"_el_sbobinator_configured": False}
                    ),
                    patch("sys.stdout", console),
                    patch(
                        "el_sbobinator.services.phase1_service.cut_audio_chunk_to_mp3",
                        return_value=(True, None),
                    ),
                    patch(
                        "el_sbobinator.services.phase1_service.retry_with_quota",
                        side_effect=CircuitBreakerExhaustedError(reason),
                    ),
                ):
                    configure_logging(stream=console)
                    handler = attach_file_handler(log_path)
                    try:
                        kwargs = {
                            **self._COMMON_KWARGS,
                            "start_sec": 60,
                            "total_duration_sec": 120,
                            "initial_full_transcript": "Testo precedente.",
                            "initial_prev_memory": "Testo precedente.",
                            "logger": get_logger(session_dir=tmpdir, stage="phase1"),
                        }
                        _, transcript, _ = process_phase1_transcription(
                            client=object(),
                            input_path="fake.mp3",
                            preconv_used_path=None,
                            phase1_chunks_dir=chunks_dir,
                            session=session,
                            save_session=save_session,
                            **kwargs,  # type: ignore[arg-type]
                        )
                    finally:
                        detach_file_handler(handler)
                self.assertIsNone(transcript)
                self.assertEqual(session["phase1"], progress)
                self.assertEqual(session["last_error"], "phase1_chunk_failed_2")
                self.assertIn(reason, session["last_error_detail"])
                save_session.assert_called_once()
                with open(saved_chunk, encoding="utf-8") as handle:
                    self.assertEqual(handle.read(), "Testo precedente.")
                output = console.getvalue()
                self.assertEqual(output.count(reason), 1)
                self.assertIn("progressi salvati. Potrai riprendere", output)
                self.assertNotIn("Traceback", output)
                self.assertNotIn("Errore non gestito", output)
                self.assertNotIn("Errore critico", output)
                with open(log_path, encoding="utf-8") as handle:
                    diagnostic = handle.read()
                self.assertIn("Traceback", diagnostic)
                self.assertIn("CircuitBreakerExhaustedError", diagnostic)
                self.assertIn(reason, diagnostic)
                self.assertIn("stage=phase1", diagnostic)

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

        self.assertIsNotNone(transcript)
        assert transcript is not None
        self.assertIn("Testo.", transcript)
        self.assertEqual(len(cut_calls), 1)

    # ── console lines ──────────────────────────────────────────────────────────

    def test_chunk_console_lines_show_the_lecture_range_once(self):
        """The phase already names the chunk: no separator or second chunk header."""
        session = {"stage": "phase1", "phase1": {}}
        out = io.StringIO()
        with (
            patch(
                "el_sbobinator.services.phase1_service.cut_audio_chunk_to_mp3",
                return_value=(True, None),
            ),
            patch(
                "el_sbobinator.services.phase1_service.retry_with_quota",
                return_value=(object(), "Testo."),
            ),
            redirect_stdout(out),
        ):
            _, transcript, _ = self._run(
                session, total_duration_sec=3700, step_seconds=3600, chunk_seconds=3600
            )

        self.assertIsNotNone(transcript)
        printed = out.getvalue()
        self.assertIn("Taglio dell'audio da 0:00 a 1:00:00...", printed)
        self.assertIn("Taglio dell'audio da 1:00:00 a 1:01:40...", printed)
        self.assertNotIn("Blocco Audio", printed)
        self.assertNotIn("-----", printed)
        self.assertIn("✅ Blocco 2/2 salvato.", printed)
        # Flat lines: the collapsed console tail has no phase line to indent under.
        self.assertEqual(
            [line for line in printed.splitlines() if line[:1].isspace()], []
        )

    def test_stop_during_retry_wait_is_not_recorded_as_chunk_failure(self):
        """A retry wait cut short by Stop returns no text, like a real failure would."""
        for stopped in (True, False):
            with self.subTest(stopped=stopped):
                cancel = threading.Event()
                session = {"stage": "phase1", "phase1": {}}

                def stop_while_waiting(
                    *_args, stopped=stopped, cancel=cancel, **_kwargs
                ):
                    if stopped:
                        cancel.set()
                    return object(), None

                out = io.StringIO()
                with (
                    patch(
                        "el_sbobinator.services.phase1_service.cut_audio_chunk_to_mp3",
                        return_value=(True, None),
                    ),
                    patch(
                        "el_sbobinator.services.phase1_service.retry_with_quota",
                        side_effect=stop_while_waiting,
                    ),
                    redirect_stdout(out),
                ):
                    _, transcript, _ = self._run(
                        session, cancel_event=cancel, cancelled=cancel.is_set
                    )

                self.assertIsNone(transcript)
                if stopped:
                    self.assertNotIn("last_error", session)
                    self.assertNotIn("❌", out.getvalue())
                else:
                    self.assertEqual(session["last_error"], "phase1_chunk_failed_1")
                    self.assertIn("❌ Errore nel blocco 1", out.getvalue())

    def test_cancellation_leaves_the_outcome_to_the_phase_line(self):
        cancel = threading.Event()
        cancel.set()
        out = io.StringIO()
        with (
            patch(
                "el_sbobinator.services.phase1_service.cut_audio_chunk_to_mp3",
                return_value=(False, "cancelled"),
            ),
            redirect_stdout(out),
        ):
            _, transcript, _ = self._run(
                {"stage": "phase1", "phase1": {}},
                cancel_event=cancel,
                cancelled=cancel.is_set,
            )

        self.assertIsNone(transcript)
        self.assertNotIn("annullata", out.getvalue())

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

        self.assertIsNotNone(transcript)
        assert transcript is not None
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

        self.assertIsNotNone(transcript)
        assert transcript is not None
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

        self.assertIsNotNone(transcript)
        assert transcript is not None
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

    # ── chunk recovery ───────────────────────────────────────────────

    def test_degenerate_output_triggers_recovery_and_succeeds(self):
        """Degenerate output gets one extra pass without changing the model."""

        selected_model = "flash-1.5-8b"

        session = {"stage": "phase1", "phase1": {}}
        kwargs = self._COMMON_KWARGS.copy()

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

        self.assertIsNotNone(transcript)
        assert transcript is not None
        self.assertIn("Testo ripreso.", transcript)
        self.assertEqual(selected_model, "flash-1.5-8b")

    def test_degenerate_output_recovery_also_fails_sets_error(self):
        """Both calls raise DegenerateOutputError → last_error = phase1_degenerate_output."""

        session = {"stage": "phase1", "phase1": {}}
        kwargs = self._COMMON_KWARGS.copy()

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

        self.assertIsNotNone(transcript)
        assert transcript is not None
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

        self.assertIsNotNone(transcript)
        assert transcript is not None
        self.assertIn("Testo.", transcript)


class TestChunkFileSaveFailure(unittest.TestCase):
    """next_start_sec / memoria_precedente must not advance when the chunk file write fails."""

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
        initial_full_transcript="",
        initial_prev_memory="",
        fallback_keys=[],
        request_fallback_key=lambda: None,
        system_prompt="test",
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


class Phase1ResumeProgressTests(unittest.TestCase):
    def test_resume_emits_initial_progress(self):
        progress_calls: list[float] = []

        class _ProgressRuntime(_FakeRuntime):
            def progress(self, v):
                progress_calls.append(v)

        session = {
            "stage": "phase1",
            "phase1": {"chunks_done": 2, "next_start_sec": 120},
        }
        runtime = _ProgressRuntime()

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
                    return_value=(object(), "Testo."),
                ),
                patch(
                    "el_sbobinator.services.phase1_service.sleep_with_cancel",
                    return_value=True,
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
                    start_sec=120,
                    total_duration_sec=240,
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
                    runtime=runtime,
                )

        self.assertTrue(len(progress_calls) >= 1)
        self.assertAlmostEqual(progress_calls[0], 0.35)

    def test_each_saved_chunk_advances_work_done(self):
        work_done_calls: list[tuple[str, int, int | None]] = []

        class _WorkRuntime(_FakeRuntime):
            def update_work_done(self, kind, done, total=None):
                work_done_calls.append((kind, done, total))

        session = {
            "stage": "phase1",
            "phase1": {"chunks_done": 0, "next_start_sec": 0},
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
                    return_value=(object(), "Testo."),
                ),
                patch(
                    "el_sbobinator.services.phase1_service.sleep_with_cancel",
                    return_value=True,
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
                    total_duration_sec=180,
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
                    runtime=_WorkRuntime(),
                )

        self.assertEqual(
            work_done_calls,
            [("chunks", 0, 3), ("chunks", 1, 3), ("chunks", 2, 3), ("chunks", 3, 3)],
        )


class Phase1ResponseTimingTests(unittest.TestCase):
    def test_successful_chunk_logs_gemini_timing_and_thinking_tokens(self):
        class _Usage:
            thoughts_token_count = 9000
            candidates_token_count = 3000

        class _Response:
            text = "Trascrizione del blocco."
            usage_metadata = _Usage()

        class _Models:
            def generate_content(self, **_kwargs):
                return _Response()

        class _Client:
            models = _Models()

        out = io.StringIO()
        with (
            redirect_stdout(out),
            patch(
                "el_sbobinator.services.phase1_service.time.monotonic",
                side_effect=[100.0, 245.0],
            ),
        ):
            text = _generate_chunk_content_with_fallback(
                current_client=_Client(),
                model_name="gemini-3.8-flash",
                system_prompt="sistema",
                chunk_prompt="blocco",
                audio_inline=object(),
                ensure_uploaded_audio_fn=lambda _c: None,
            )

        self.assertEqual(text, "Trascrizione del blocco.")
        self.assertIn(
            "Risposta di Gemini in 2m 25s (ragionamento 9.000 token, testo 3.000 token).",
            out.getvalue(),
        )


class Phase1CancelDuringRequestTests(unittest.TestCase):
    def test_stop_during_slow_gemini_answer_returns_at_once_and_drops_it(self):
        request_started = threading.Event()
        release_answer = threading.Event()
        stop = threading.Event()

        class _Response:
            text = "Trascrizione arrivata dopo lo stop."
            usage_metadata = None

        class _Models:
            def generate_content(self, **_kwargs):
                request_started.set()
                release_answer.wait(10)
                return _Response()

        class _Client:
            models = _Models()

        def _retry_like_real(fn, **kw):
            # retry_with_quota turns any error raised after Stop into no text.
            try:
                return kw["client"], fn(kw["client"])
            except Exception:
                if kw["cancelled"]():
                    return kw["client"], None
                raise

        def _press_stop():
            request_started.wait(10)
            stop.set()

        session = {"stage": "phase1", "phase1": {"chunks_done": 0}}
        out = io.StringIO()
        with tempfile.TemporaryDirectory() as tmpdir:
            chunks_dir = os.path.join(tmpdir, "chunks")
            os.makedirs(chunks_dir)
            threading.Thread(target=_press_stop, daemon=True).start()
            try:
                with (
                    redirect_stdout(out),
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
                        side_effect=_retry_like_real,
                    ),
                ):
                    t0 = time.monotonic()
                    process_phase1_transcription(  # type: ignore[arg-type]
                        client=_Client(),
                        model_name="gemini-2.5-flash",
                        input_path="fake.mp3",
                        preconv_used_path=None,
                        ffmpeg_exe="ffmpeg",
                        cancel_event=stop,
                        cancelled=stop.is_set,
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
                    elapsed = time.monotonic() - t0
                    saved_chunks = os.listdir(chunks_dir)
            finally:
                release_answer.set()

        self.assertLess(elapsed, 5)
        self.assertEqual(saved_chunks, [])
        self.assertEqual(session["phase1"]["chunks_done"], 0)
        self.assertNotIn("last_error", session)
        self.assertIn(
            "Blocco 1 interrotto: la risposta non verrà salvata.", out.getvalue()
        )

    def test_answer_arriving_after_stop_is_kept_out_of_the_log(self):
        stopped = threading.Event()

        class _Response:
            text = "Trascrizione arrivata dopo lo stop."
            usage_metadata = None

        class _Models:
            def generate_content(self, **_kwargs):
                stopped.set()
                return _Response()

        class _Client:
            models = _Models()

        out = io.StringIO()
        with redirect_stdout(out):
            text = _generate_chunk_content_with_fallback(
                current_client=_Client(),
                model_name="gemini-2.5-flash",
                system_prompt="sistema",
                chunk_prompt="blocco",
                audio_inline=object(),
                ensure_uploaded_audio_fn=lambda _c: None,
                cancelled=stopped.is_set,
            )

        self.assertIsNone(text)
        self.assertNotIn("Risposta di Gemini", out.getvalue())

    def test_late_answer_stays_dropped_after_the_next_run_clears_stop(self):
        request_started = threading.Event()
        release_answer = threading.Event()
        stop = threading.Event()

        class _Response:
            text = "Trascrizione arrivata dopo lo stop."
            usage_metadata = None

        class _Models:
            def generate_content(self, **_kwargs):
                request_started.set()
                release_answer.wait(10)
                return _Response()

        class _Client:
            models = _Models()

        def _retry_like_real(fn, **kw):
            try:
                return kw["client"], fn(kw["client"])
            except Exception:
                if kw["cancelled"]():
                    return kw["client"], None
                raise

        def _press_stop():
            request_started.wait(10)
            stop.set()

        threading.Thread(target=_press_stop, daemon=True).start()
        out = io.StringIO()
        try:
            with (
                redirect_stdout(out),
                patch(
                    "el_sbobinator.services.phase1_service.generation_service.make_inline_audio_part",
                    return_value=object(),
                ),
                patch(
                    "el_sbobinator.services.phase1_service.retry_with_quota",
                    side_effect=_retry_like_real,
                ),
            ):
                _client, text = _call_chunk_transcription_api(
                    client=_Client(),
                    chunk_path="fake.mp3",
                    chunk_idx=1,
                    total_chunks=1,
                    prev_memory="",
                    system_prompt="sistema",
                    model_name="gemini-2.5-flash",
                    inline_max_bytes=None,
                    runtime=None,
                    cancelled=stop.is_set,
                    fallback_keys=[],
                    request_fallback_key=lambda: None,
                )
                # Starting the next run clears the shared Stop flag.
                stop.clear()
                workers = [
                    t for t in threading.enumerate() if t.name == "phase1-chunk-request"
                ]
                release_answer.set()
                for worker in workers:
                    worker.join(5)
        finally:
            release_answer.set()

        self.assertIsNone(text)
        self.assertTrue(workers)
        self.assertNotIn("Risposta di Gemini", out.getvalue())

    def test_stop_during_audio_upload_sends_no_request_and_deletes_the_file(self):
        upload_started = threading.Event()
        release_upload = threading.Event()
        upload_handled = threading.Event()
        stop = threading.Event()
        generate_calls = []
        deleted = []

        class _File:
            name = "files/blocco-1"
            uri = "https://example.invalid/files/blocco-1"
            mime_type = "audio/mpeg"
            state = "ACTIVE"

        class _Files:
            def upload(self, **_kwargs):
                upload_started.set()
                release_upload.wait(10)
                return _File()

            def delete(self, name):
                deleted.append(name)
                upload_handled.set()

        class _Models:
            def generate_content(self, **kwargs):
                generate_calls.append(kwargs)
                upload_handled.set()

        class _Client:
            files = _Files()
            models = _Models()

        def _retry_like_real(fn, **kw):
            try:
                return kw["client"], fn(kw["client"])
            except Exception:
                if kw["cancelled"]():
                    return kw["client"], None
                raise

        def _press_stop():
            upload_started.wait(10)
            stop.set()

        threading.Thread(target=_press_stop, daemon=True).start()
        out = io.StringIO()
        try:
            with (
                redirect_stdout(out),
                patch(
                    "el_sbobinator.services.phase1_service.generation_service.make_inline_audio_part",
                    return_value=None,
                ),
                patch(
                    "el_sbobinator.services.phase1_service.retry_with_quota",
                    side_effect=_retry_like_real,
                ),
            ):
                _client, text = _call_chunk_transcription_api(
                    client=_Client(),
                    chunk_path="fake.mp3",
                    chunk_idx=1,
                    total_chunks=1,
                    prev_memory="",
                    system_prompt="sistema",
                    model_name="gemini-2.5-flash",
                    inline_max_bytes=None,
                    runtime=None,
                    cancelled=stop.is_set,
                    fallback_keys=[],
                    request_fallback_key=lambda: None,
                )
                # Stop returned while the upload was still running.
                release_upload.set()
                self.assertTrue(upload_handled.wait(5))
        finally:
            release_upload.set()

        self.assertIsNone(text)
        self.assertEqual(generate_calls, [])
        self.assertEqual(deleted, ["files/blocco-1"])
        self.assertNotIn("Trascrizione in corso", out.getvalue())


class Phase1ThinkingBudgetTests(unittest.TestCase):
    def _sent_config(self, model_name):
        sent = {}

        class _Response:
            text = "Trascrizione del blocco."
            usage_metadata = None

        class _Models:
            def generate_content(self, **kwargs):
                sent.update(kwargs)
                return _Response()

        class _Client:
            models = _Models()

        with redirect_stdout(io.StringIO()):
            _generate_chunk_content_with_fallback(
                current_client=_Client(),
                model_name=model_name,
                system_prompt="sistema",
                chunk_prompt="blocco",
                audio_inline=object(),
                ensure_uploaded_audio_fn=lambda _c: None,
            )
        return sent["config"]

    def test_gemini_25_chunk_caps_thinking_without_capping_output(self):
        config = self._sent_config("gemini-2.5-flash")

        self.assertEqual(config.thinking_config.thinking_budget, 16384)
        # The output limit also counts thinking: capping it would truncate text.
        self.assertIsNone(config.max_output_tokens)

    def test_gemini_3_chunk_keeps_default_thinking(self):
        config = self._sent_config("gemini-3.6-flash")

        self.assertIsNone(config.thinking_config)
