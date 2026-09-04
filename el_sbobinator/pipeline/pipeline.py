"""
Core pipeline for El Sbobinator (no UI widgets touched directly).

This module contains the heavy workflow:
- FFmpeg duration/probe, optional pre-conversion, chunk cutting
- Gemini generation (chunk), macro revision
- Autosave sessions and final HTML export
"""

from __future__ import annotations

import os
import threading
import time
from typing import Any

from google import genai

from el_sbobinator.core.model_registry import (
    ModelState,
    build_model_state,
    default_macro_char_limit_for_model,
)
from el_sbobinator.core.prompts import PROMPT_REVISIONE, PROMPT_SISTEMA
from el_sbobinator.core.session_store import _update_session, mark_html_exported
from el_sbobinator.core.shared import (
    PRECONVERTED_AUDIO_FINAL,
    _atomic_write_json,
    _load_json,
    invalidate_session_storage_cache,
)
from el_sbobinator.pipeline.pipeline_hooks import PipelineRuntime
from el_sbobinator.pipeline.pipeline_session import (
    AutosaveFailedError,
    PipelineSessionContext,
    SaveSessionGuard,
    check_disk_space,
    ensure_preconverted_audio,
    initialize_session_context,
    list_phase1_chunks,
    normalize_stage,
    persist_phase1_metadata,
    phase1_has_progress,
    read_text_file,
    reset_for_regeneration,
    restore_phase1_progress,
)
from el_sbobinator.services import generation_service
from el_sbobinator.services.audio_service import (
    probe_media_duration,
    resolve_ffmpeg,
)
from el_sbobinator.services.config_service import safe_output_basename
from el_sbobinator.services.export_service import export_final_html_document
from el_sbobinator.services.generation_service import (
    extract_client_api_key,
    load_fallback_keys,
)
from el_sbobinator.services.phase1_service import process_phase1_transcription
from el_sbobinator.services.revision_service import (
    build_macro_blocks,
    process_macro_revision_phase,
)
from el_sbobinator.utils.logging_utils import (
    attach_file_handler,
    detach_file_handler,
    get_logger,
)

# Maximum seconds to wait for a user response in the "regenerate?" dialog before
# pausing with a visible, resumable error so the pipeline never chooses silently.
_REGENERATE_DIALOG_TIMEOUT_SECONDS: int = 120
_REGENERATE_PROMPT_TIMEOUT_ERROR = "regenerate_prompt_timeout"


def _probe_input_media(
    input_path: str, runtime: PipelineRuntime, logger
) -> tuple[float | None, str | None]:
    """Probe media duration and return (total_duration_sec, ffmpeg_exe) or (None, None) on failure."""
    print(f"[*] Analisi del file originale in corso:\n{os.path.basename(input_path)}")
    runtime.phase("Fase: analisi file")
    try:
        ffmpeg_exe = resolve_ffmpeg()
        total_duration_sec, reason = probe_media_duration(
            input_path, ffmpeg_exe=ffmpeg_exe
        )
        if total_duration_sec is None:
            raise ValueError(
                str(reason or "Impossibile leggere la durata dal file usando FFmpeg.")
            )
        return total_duration_sec, ffmpeg_exe
    except Exception as e:
        print(f"Errore caricamento audio. File corrotto o formato non supportato.\n{e}")
        logger.exception("Analisi file fallita.", extra={"stage": "probe"})
        return None, None


def _ask_regeneration_decision(
    input_path: str,
    session_ctx: PipelineSessionContext,
    app_instance,
    runtime: PipelineRuntime,
    stage: str,
    cancel_event,
) -> tuple[bool | str, bool]:
    """Prompt the user whether to regenerate or resume. Returns (decision, is_timeout)."""
    if callable(getattr(app_instance, "ask_regenerate", None)):
        event = threading.Event()
        rigenera = False
        answered_at = None

        def on_answer(payload):
            nonlocal answered_at, rigenera
            answered_at = time.monotonic()
            val = payload.get("regenerate", False)
            if val is None and cancel_event is not None:
                cancel_event.set()
            rigenera = False if val is None else val
            event.set()

        regenerate_mode = "completed" if stage == "done" else "resume"
        if runtime.ask_regenerate(
            os.path.basename(input_path),
            on_answer,
            regenerate_mode,
            session_dir=str(session_ctx.session_dir),
        ):
            deadline = time.monotonic() + _REGENERATE_DIALOG_TIMEOUT_SECONDS
            while True:
                if event.is_set() and (answered_at is None or answered_at <= deadline):
                    return rigenera, False
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    runtime.dismiss_regenerate_prompt()
                    return "timeout", True
                if runtime.cancelled():
                    return False, False
                event.wait(min(0.2, remaining))

    ans = runtime.ask_confirmation(
        "File gia' completato",
        f"Il file '{os.path.basename(input_path)}' e' gia' completato.\n"
        "Vuoi usare il salvataggio vecchio o ricominciare da zero perdendo tutti i progressi pregressi?\n\n"
        "- Scegli 'OK'/'Si' per RIGENERARE da capo.\n"
        "- Scegli 'Annulla'/'No' per usare la versione gia' pronta.",
    )
    if ans is not None:
        return bool(ans), False

    return False, False


def _make_fallback_key_requester(runtime: PipelineRuntime, session: dict, save_session):
    def request_fallback_key():
        prompt_timed_out = False

        def _on_timeout() -> None:
            nonlocal prompt_timed_out
            prompt_timed_out = True

        key = generation_service.request_new_api_key(
            runtime,
            runtime.cancelled,
            on_timeout=_on_timeout,
        )
        if not key or not key.strip():
            if prompt_timed_out:
                error_key = "quota_daily_limit_phase1"
                if isinstance(session, dict):
                    stage_name = str(session.get("stage") or "").lower()
                    if stage_name == "phase2":
                        error_key = "quota_daily_limit_phase2"
                    session["last_error"] = error_key
                    session["last_error_detail"] = "api_key_prompt_timeout"
                    try:
                        save_session()
                    except Exception:
                        pass
                runtime.console_error(
                    "Attesa chiave API scaduta. Sessione salvata - riprendi quando vuoi."
                )
                runtime.set_run_error_detail("api_key_prompt_timeout")
                raise generation_service.QuotaDailyLimitError("api_key_prompt_timeout")
            _ce = runtime.cancel_event
            if _ce is not None:
                _ce.set()
        return key

    return request_fallback_key


def _handle_regeneration_flow(
    input_path: str,
    session_ctx: PipelineSessionContext,
    app_instance,
    runtime: PipelineRuntime,
    stage: str,
    cancel_event,
    save_session,
    logger,
) -> tuple[str, str, bool]:
    """Handle resume/regenerate prompt when progress already exists.

    Returns (status, new_stage, is_timeout_terminal). Status can be 'proceed', 'early_done',
    'timeout', or 'continue'.
    """
    session = session_ctx.session
    _is_regen, _is_timeout = _ask_regeneration_decision(
        input_path,
        session_ctx,
        app_instance,
        runtime,
        stage,
        cancel_event,
    )
    print(f"[*] Risposta Rigenerare dal JS: {_is_regen}")
    if _is_regen == "timeout":
        session["last_error"] = _REGENERATE_PROMPT_TIMEOUT_ERROR
        session["last_error_detail"] = None
        save_session()
        runtime.console_error(
            "Risposta non ricevuta entro 120 secondi. Sessione salvata - riprendi quando vuoi."
        )
        runtime.set_run_result("failed", _REGENERATE_PROMPT_TIMEOUT_ERROR)
        return "timeout", stage, True
    if _is_regen:
        print(
            f"[*] L'utente ha scelto di rigenerare il file {os.path.basename(input_path)}. Pulizia sessione precedente..."
        )
        reset_for_regeneration(session_ctx)
        logger.info(
            "Sessione rigenerata su richiesta utente.",
            extra={"stage": "resume"},
        )
        return "regenerated", "phase1", False
    if stage == "done":
        existing_html = (
            session.get("outputs", {}).get("html", "")
            if isinstance(session, dict)
            else ""
        )
        if existing_html and os.path.exists(str(existing_html)):
            print(
                "[*] File gia' completato, l'utente ha scelto di usare la versione pronta."
            )
            runtime.output_html(str(existing_html))
            runtime.set_revision_failed_blocks(
                session.get("revision_failed_blocks") or []
            )
            _completion_status = (
                "completed_with_warnings"
                if runtime.get_revision_failed_blocks()
                else "completed"
            )
            runtime.set_run_result(_completion_status)
            return "early_done", stage, False
    return "proceed", stage, False


def _run_phase1_transcription(
    client,
    session_ctx: PipelineSessionContext,
    session: dict,
    save_session,
    settings,
    model_state: ModelState,
    input_path: str,
    preconv_used_path: str | None,
    ffmpeg_exe: str,
    cancel_event,
    runtime: PipelineRuntime,
    start_sec: int,
    total_duration_sec: float,
    fallback_keys: list[str],
    request_fallback_key,
    on_model_switched,
    logger,
    initial_full_transcript: str,
    initial_prev_memory: str,
) -> tuple[Any, str | None]:
    """Execute phase 1 chunked transcription."""
    print(
        f"[*] INIZIO FASE 1: Trascrizione a blocchi (circa {settings.chunk_minutes} min per blocco)"
    )
    runtime.phase("Fase 1/3: trascrizione (chunk)")
    client, full_transcript, _ = process_phase1_transcription(
        client=client,
        model_name=settings.model,
        model_state=model_state,
        input_path=input_path,
        preconv_used_path=preconv_used_path,
        ffmpeg_exe=ffmpeg_exe,
        cancel_event=cancel_event,
        cancelled=runtime.cancelled,
        start_sec=start_sec,
        total_duration_sec=total_duration_sec,
        step_seconds=settings.step_seconds,
        chunk_seconds=settings.chunk_seconds,
        bitrate=str(settings.audio_bitrate or "48k"),
        inline_max_bytes=settings.inline_max_bytes,
        prefetch_enabled=bool(settings.prefetch_next_chunk),
        initial_full_transcript=initial_full_transcript,
        initial_prev_memory=initial_prev_memory,
        phase1_chunks_dir=session_ctx.phase1_chunks_dir,
        session=session,
        save_session=save_session,
        fallback_keys=fallback_keys,
        request_fallback_key=request_fallback_key,
        system_prompt=PROMPT_SISTEMA,
        runtime=runtime,
        on_model_switched=on_model_switched,
        logger=logger,
    )
    if full_transcript is not None:
        _update_session(
            session,
            {"stage": "phase2", "last_error": None, "last_error_detail": None},
        )
        save_session()
    return client, full_transcript


def _run_phase2_revision(
    client,
    model_name: str,
    model_state: ModelState,
    full_transcript: str,
    macro_path: str,
    phase2_revised_dir: str,
    session: dict,
    save_session,
    runtime: PipelineRuntime,
    fallback_keys: list[str],
    request_fallback_key,
    on_model_switched,
    logger,
    settings,
) -> tuple[Any, str, bool]:
    """Execute phase 2 macro revision. Returns (client, revised_text, should_exit)."""
    print("\n--------------------------------------")
    runtime.phase("Fase 2/3: revisione")

    char_limit = int(
        settings.macro_char_limit or default_macro_char_limit_for_model(settings.model)
    )

    macro_blocks = None
    if os.path.exists(macro_path):
        try:
            macro_data = _load_json(macro_path)
            macro_blocks = list(macro_data.get("blocks") or [])
        except Exception:
            macro_blocks = None

    if not macro_blocks:
        macro_blocks = build_macro_blocks(full_transcript, char_limit)
        try:
            _atomic_write_json(
                macro_path, {"limit_chars": char_limit, "blocks": macro_blocks}
            )
        except Exception:
            pass

    print(f"[*] INIZIO FASE 2: Revisione e pulizia ({len(macro_blocks)} macro-sezioni)")
    _update_session(
        session,
        {
            "phase2": {
                **session.get("phase2", {}),
                "macro_total": len(macro_blocks),
            },
        },
    )
    save_session()

    revised_text = ""
    if macro_blocks:
        client, revised_text = process_macro_revision_phase(
            client=client,
            model_name=model_name,
            model_state=model_state,
            macro_blocks=macro_blocks,
            phase2_revised_dir=phase2_revised_dir,
            session=session,
            save_session=save_session,
            runtime=runtime,
            cancelled=runtime.cancelled,
            fallback_keys=fallback_keys,
            request_fallback_key=request_fallback_key,
            prompt_revisione=PROMPT_REVISIONE,
            on_model_switched=on_model_switched,
            logger=logger,
        )
        if (
            runtime.cancelled()
            or session.get("last_error") == "quota_daily_limit_phase2"
        ):
            return client, revised_text, True

    current_stage = str(session.get("stage", "phase1")).strip().lower()
    if current_stage in ("phase2", "boundary"):
        _revision_failed_blocks = [
            int(idx) for idx in (session.get("revision_failed_blocks") or [])
        ]
        _update_session(
            session,
            {
                "stage": "done",
                "completion_status": "completed_with_warnings"
                if _revision_failed_blocks
                else "completed",
                "last_error": None,
                "last_error_detail": None,
            },
        )
        save_session()
    return client, revised_text, False


def _export_html_and_finish(
    input_path: str,
    session_ctx: PipelineSessionContext,
    session: dict,
    save_session,
    revised_text: str,
    phase2_revised_dir: str,
    runtime: PipelineRuntime,
    app_instance,
    logger,
    start_time: float,
) -> bool:
    """Export the HTML document and update completion status. Returns success flag."""
    runtime.phase("Fase: esportazione HTML")
    session_html_dir = session_ctx.session_dir

    try:
        _title, html_path = export_final_html_document(
            input_path=input_path,
            phase2_revised_dir=phase2_revised_dir,
            fallback_body=revised_text,
            read_text=read_text_file,
            output_dir=session_html_dir,
            fallback_output_dir=session_html_dir,
            safe_output_basename=safe_output_basename,
            revision_failed_blocks=[
                int(idx) for idx in (session.get("revision_failed_blocks") or [])
            ],
        )
    except Exception as e:
        print(f"[!] Errore salvataggio HTML: {e}")
        session["last_error"] = "html_export_failed"
        session["last_error_detail"] = None
        save_session()
        return False

    if not os.path.exists(html_path):
        print("[!] Errore salvataggio HTML: file finale non trovato dopo la scrittura.")
        session["last_error"] = "html_export_missing"
        session["last_error_detail"] = None
        save_session()
        return False

    try:
        _update_session(
            session,
            {"outputs": {**session.get("outputs", {}), "html": html_path}},
        )
        mark_html_exported(session)
        save_session()
    except Exception:
        pass

    try:
        runtime.output_html(html_path)
    except Exception:
        pass

    elapsed = time.monotonic() - start_time
    minutes = int(elapsed // 60)
    seconds = int(elapsed % 60)
    print("\n======================================")
    print("SBOBINATURA COMPLETATA CON SUCCESSO!")
    print(f"Tempo totale: {minutes}m {seconds}s")
    print(f"File salvato in: {session_html_dir}")
    runtime.phase("Fase: completato")
    runtime.set_revision_failed_blocks(session.get("revision_failed_blocks") or [])
    _completion_status = (
        "completed_with_warnings"
        if runtime.get_revision_failed_blocks()
        else "completed"
    )
    runtime.set_run_result(_completion_status)
    logger.info("Pipeline completata con successo.", extra={"stage": "done"})
    return True


def _pipeline_finally_cleanup(
    session_ctx: PipelineSessionContext | None,
    session: dict | None,
    client: genai.Client | None,
    app_instance,
    runtime: PipelineRuntime,
    log_handler,
    regenerate_prompt_timeout_terminal: bool,
):
    """Clean up resources, temp files, and post final session states."""
    if session_ctx is not None:
        try:
            _final_stage = (
                str(session.get("stage", "") if isinstance(session, dict) else "")
                .strip()
                .lower()
            )
            if _final_stage == "done":
                _preconv = os.path.join(
                    session_ctx.session_dir, PRECONVERTED_AUDIO_FINAL
                )
                if os.path.exists(_preconv):
                    os.remove(_preconv)
                    invalidate_session_storage_cache()
        except Exception:
            pass

    runtime.set_effective_api_key(
        extract_client_api_key(client) or runtime.get_effective_api_key()
    )
    runtime.cleanup_temp_files()

    last_run_error = runtime.get_last_run_error()
    last_run_status = runtime.get_last_run_status()

    if (
        runtime.cancelled()
        and not regenerate_prompt_timeout_terminal
        and last_run_error != _REGENERATE_PROMPT_TIMEOUT_ERROR
    ) or last_run_status == "cancelled":
        runtime.phase("Fase: annullato")
        runtime.set_run_result(
            "cancelled",
            last_run_error or "cancelled",
        )
    else:
        runtime.progress(1.0)
        if last_run_status in {
            "completed",
            "completed_with_warnings",
        }:
            runtime.set_run_error_detail(None)
        else:
            runtime.set_run_error_detail(
                session.get("last_error_detail") if isinstance(session, dict) else None
            )
            runtime.set_run_result(
                "failed",
                last_run_error
                or (session.get("last_error") if isinstance(session, dict) else None)
                or "processing_failed",
            )
    detach_file_handler(log_handler)
    runtime.process_done()


def _esegui_sbobinatura_impl(
    input_path,
    api_key_value,
    app_instance,
    session_dir_hint=None,
    resume_session=False,
    allow_completed_destroy=False,
):
    runtime = PipelineRuntime(app_instance)
    runtime.reset_temp_files()
    cancel_event = runtime.cancel_event
    log_handler = None
    logger = get_logger("el_sbobinator.pipeline")
    start_time = time.monotonic()

    fallback_keys = load_fallback_keys()

    session = None
    session_ctx = None
    client = None
    regenerate_prompt_timeout_terminal = False
    try:
        if not api_key_value or api_key_value.strip() == "":
            runtime.set_run_result("failed", "api_key_mancante")
            print("Errore: Formato API Key non valido o assente.")
            logger.error("API key mancante o non valida.", extra={"stage": "startup"})
            return

        client = genai.Client(api_key=api_key_value.strip())
        runtime.set_run_result("failed")
        runtime.set_effective_api_key(api_key_value.strip())

        session_ctx = initialize_session_context(
            input_path,
            session_dir_hint=session_dir_hint,
            resume_session=resume_session,
            allow_completed_destroy=allow_completed_destroy,
        )
        session = session_ctx.session
        logger = get_logger(
            "el_sbobinator.pipeline",
            run_id=os.path.basename(session_ctx.session_dir),
            session_dir=session_ctx.session_dir,
            input_file=os.path.basename(input_path),
        )
        log_handler = attach_file_handler(
            os.path.join(session_ctx.session_dir, "run.log")
        )

        def _on_autosave_fatal(msg: str) -> None:
            print(msg)
            runtime.console_error(msg)
            if isinstance(session, dict):
                session["last_error"] = "autosave_failed"
                session["last_error_detail"] = None

        save_session = SaveSessionGuard(session_ctx.save, _on_autosave_fatal)
        request_fallback_key = _make_fallback_key_requester(
            runtime, session, save_session
        )

        def on_model_switched(previous_model: str, new_model: str):
            assert session is not None
            session.setdefault("settings", {})
            session["settings"]["effective_model"] = new_model
            save_session()
            runtime.update_model(new_model)
            print(f"   [OK] Cambio modello automatico: {previous_model} -> {new_model}")

        settings = session_ctx.settings
        model_state = build_model_state(settings.model, settings.fallback_models)
        runtime.update_model(model_state.current)

        total_duration_sec, ffmpeg_exe = _probe_input_media(input_path, runtime, logger)
        if total_duration_sec is None or ffmpeg_exe is None:
            return

        print(f"[*] Durata totale rilevata: {int(total_duration_sec / 60)} minuti.")
        persist_phase1_metadata(session_ctx, total_duration_sec, settings.step_seconds)

        previous_stage = str(session.get("stage", "phase1")).strip().lower()
        stage = normalize_stage(session)
        if stage != previous_stage:
            save_session()

        _next_start_sec = int(
            (session.get("phase1") or {}).get("next_start_sec", 0) or 0
        )
        check_disk_space(
            session_ctx.session_dir,
            total_duration_sec,
            settings,
            stage,
            _next_start_sec,
        )

        existing_chunks = list_phase1_chunks(session_ctx.phase1_chunks_dir)
        if phase1_has_progress(session, stage, existing_chunks) and resume_session:
            status, stage, timeout_flag = _handle_regeneration_flow(
                input_path,
                session_ctx,
                app_instance,
                runtime,
                stage,
                cancel_event,
                save_session,
                logger,
            )
            if timeout_flag:
                regenerate_prompt_timeout_terminal = True
            if status in ("timeout", "early_done"):
                return
            if status == "regenerated":
                settings = session_ctx.settings
                model_state = build_model_state(
                    settings.model, settings.fallback_models
                )
                runtime.update_model(model_state.current)

        if runtime.cancelled():
            return
        _, preconv_used_path = ensure_preconverted_audio(
            session_ctx,
            input_path=input_path,
            stage=stage,
            ffmpeg_exe=ffmpeg_exe,
            cancel_event=cancel_event,
            cancelled=runtime.cancelled,
            phase_callback=runtime.phase,
        )
        if runtime.cancelled():
            return

        restored_phase1 = restore_phase1_progress(
            session_ctx, stage=stage, step_seconds=settings.step_seconds
        )
        full_transcript = restored_phase1.full_transcript
        start_sec = (
            restored_phase1.start_sec if stage == "phase1" else int(total_duration_sec)
        )

        if stage == "phase1":
            client, full_transcript = _run_phase1_transcription(
                client=client,
                session_ctx=session_ctx,
                session=session,
                save_session=save_session,
                settings=settings,
                model_state=model_state,
                input_path=input_path,
                preconv_used_path=preconv_used_path,
                ffmpeg_exe=ffmpeg_exe,
                cancel_event=cancel_event,
                runtime=runtime,
                start_sec=start_sec,
                total_duration_sec=total_duration_sec,
                fallback_keys=fallback_keys,
                request_fallback_key=request_fallback_key,
                on_model_switched=on_model_switched,
                logger=logger,
                initial_full_transcript=full_transcript,
                initial_prev_memory=restored_phase1.prev_memory,
            )
            if full_transcript is None:
                return

        client, revised_text, should_exit = _run_phase2_revision(
            client=client,
            model_name=settings.model,
            model_state=model_state,
            full_transcript=full_transcript,
            macro_path=session_ctx.macro_path,
            phase2_revised_dir=session_ctx.phase2_revised_dir,
            session=session,
            save_session=save_session,
            runtime=runtime,
            fallback_keys=fallback_keys,
            request_fallback_key=request_fallback_key,
            on_model_switched=on_model_switched,
            logger=logger,
            settings=settings,
        )
        if should_exit:
            return

        if not _export_html_and_finish(
            input_path=input_path,
            session_ctx=session_ctx,
            session=session,
            save_session=save_session,
            revised_text=revised_text,
            phase2_revised_dir=session_ctx.phase2_revised_dir,
            runtime=runtime,
            app_instance=app_instance,
            logger=logger,
            start_time=start_time,
        ):
            return

    except AutosaveFailedError:
        runtime.set_run_result("failed", "autosave_failed")
        logger.warning(
            "Autosalvataggio fallito ripetutamente: elaborazione interrotta.",
            extra={"stage": "autosave_fatal"},
        )
    except Exception as e:
        runtime.set_run_result("failed", str(e))
        logger.exception("Errore imprevisto nella pipeline.", extra={"stage": "fatal"})
        print(f"\n[X] ERRORE IMPREVISTO DURANTE L'ESECUZIONE:\n{e}")
    finally:
        _pipeline_finally_cleanup(
            session_ctx,
            session,
            client,
            app_instance,
            runtime,
            log_handler,
            regenerate_prompt_timeout_terminal,
        )


def esegui_sbobinatura(
    input_path,
    api_key_value,
    app_instance,
    session_dir_hint=None,
    resume_session=False,
    allow_completed_destroy=False,
):
    # Wrapper stabile: mantiene la firma pubblica mentre l'implementazione evolve.
    return _esegui_sbobinatura_impl(
        input_path,
        api_key_value,
        app_instance,
        session_dir_hint=session_dir_hint,
        resume_session=resume_session,
        allow_completed_destroy=allow_completed_destroy,
    )
