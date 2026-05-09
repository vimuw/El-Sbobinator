"""
Revision helpers extracted from the main pipeline.
"""

from __future__ import annotations

import os
import re
import time
from collections.abc import Callable

from google.genai import types

from el_sbobinator.core.model_registry import ModelState
from el_sbobinator.core.session_store import _update_session
from el_sbobinator.core.shared import _atomic_write_text
from el_sbobinator.pipeline.pipeline_session import record_step_metric
from el_sbobinator.services.generation_service import (
    QuotaDailyLimitError,
    current_model_name,
    extract_response_text,
    retry_with_quota,
    sleep_with_cancel,
)
from el_sbobinator.utils.dedup_utils import local_macro_cleanup
from el_sbobinator.utils.logging_utils import get_logger


def _normalize_block_indexes(value) -> list[int]:
    indexes: list[int] = []
    seen: set[int] = set()
    if not isinstance(value, list | tuple | set):
        return indexes
    for item in value:
        try:
            idx = int(item)
        except (TypeError, ValueError):
            continue
        if idx <= 0 or idx in seen:
            continue
        seen.add(idx)
        indexes.append(idx)
    indexes.sort()
    return indexes


def build_macro_blocks(text: str, macro_char_limit: int) -> list[str]:
    paragraphs = text.split("\n\n")
    blocks: list[str] = []
    current_parts: list[str] = []
    current_len = 0
    _h_re = re.compile(r"^\s*#{1,3}\s+\S")
    for paragraph in paragraphs:
        seg = paragraph + "\n\n"
        is_h = bool(_h_re.match(paragraph))
        past_soft = current_len > macro_char_limit * 0.70
        has_content = current_len > 500
        if current_len + len(paragraph) > macro_char_limit and current_parts:
            blocks.append("".join(current_parts))
            current_parts = [seg]
            current_len = len(seg)
        elif is_h and past_soft and has_content and current_parts:
            blocks.append("".join(current_parts))
            current_parts = [seg]
            current_len = len(seg)
        else:
            current_parts.append(seg)
            current_len += len(seg)
    if current_parts:
        joined = "".join(current_parts)
        if joined.strip():
            blocks.append(joined)
    return blocks


def process_macro_revision_phase(  # noqa: C901
    *,
    client,
    model_name: str,
    model_state: ModelState | None = None,
    macro_blocks: list[str],
    phase2_revised_dir: str,
    session: dict,
    save_session: Callable[[], bool],
    runtime,
    cancelled: Callable[[], bool],
    fallback_keys: list[str],
    request_fallback_key: Callable[[], str | None],
    prompt_revisione: str,
    on_model_switched=None,
    logger=None,
) -> tuple[object, str]:
    log = logger or get_logger("el_sbobinator.revision", stage="phase2")
    revised_text = ""
    macro_total = len(macro_blocks)
    revised_done = 0
    pending_retry: list[tuple[int, str, str]] = []  # (index, raw_path, rev_path)

    runtime.set_work_totals(macro_total=macro_total)
    try:
        runtime.update_work_done(
            "macro",
            int(session.get("phase2", {}).get("revised_done", 0) or 0),
            total=macro_total,
        )
    except Exception:
        pass

    for index, block in enumerate(macro_blocks, 1):
        if cancelled():
            print("   [*] Operazione annullata dall'utente.")
            return client, revised_text

        runtime.phase(f"Fase 2/3: revisione ({index}/{macro_total})")
        rev_path = os.path.join(phase2_revised_dir, f"rev_{index:03}.md")
        raw_path = os.path.join(phase2_revised_dir, f"rev_{index:03}.raw.md")

        if os.path.exists(rev_path):
            try:
                with open(rev_path, encoding="utf-8") as _fh:
                    existing = _fh.read().strip()
            except Exception:
                existing = ""
            if existing:
                revised_text += f"\n\n{existing}\n\n"
                revised_done += 1
                runtime.update_work_done("macro", revised_done, total=macro_total)
                _update_session(
                    session,
                    {
                        "stage": "phase2",
                        "phase2": {
                            **session.get("phase2", {}),
                            "revised_done": int(revised_done),
                        },
                        "last_error": None,
                        "last_error_detail": None,
                    },
                )
                save_session()
                runtime.progress(0.7 + 0.2 * (revised_done / max(1, macro_total)))
                continue

        if os.path.exists(raw_path):
            pending_retry.append((index, raw_path, rev_path))
            continue

        block_src = (block or "").strip()
        block_local, removed_exact, removed_adj, near_adj, _ = local_macro_cleanup(
            block_src
        )
        block_for_ai = (block_local or block_src).strip()
        if removed_exact or removed_adj:
            print(
                f"   -> Pre-clean locale Macro-blocco {index}/{macro_total}: duplicati rimossi={removed_exact + removed_adj} (sospetti={near_adj})."
            )

        step_t0 = time.monotonic()
        print(f"   -> Revisione Macro-blocco {index} di {macro_total}...")
        success = False

        def _call(current_client):
            response = current_client.models.generate_content(
                model=current_model_name(model_state, model_name),
                contents=[block_for_ai],  # noqa: B023
                config=types.GenerateContentConfig(
                    system_instruction=prompt_revisione,
                    temperature=0.1,
                ),
            )
            current_text = extract_response_text(response)
            if not current_text:
                raise RuntimeError("Risposta vuota dal modello in revisione.")
            return current_text

        try:
            client, current_text = retry_with_quota(
                _call,
                client=client,
                fallback_keys=fallback_keys,
                model_name=model_name,
                model_state=model_state,
                cancelled=cancelled,
                runtime=runtime,
                request_fallback_key=request_fallback_key,
                retry_sleep_seconds=20.0,
                on_model_switched=on_model_switched,
                logger=log,
                resume_phase_text=f"Fase 2/3: revisione ({index}/{macro_total})",
            )
            if current_text is None:
                return client, revised_text
            revised_text += f"\n\n{current_text}\n\n"
            _atomic_write_text(rev_path, current_text + "\n")
            print(f"   [autosave] Revisione salvata: {os.path.basename(rev_path)}")

            revised_done += 1
            _update_session(
                session,
                {
                    "stage": "phase2",
                    "phase2": {
                        **session.get("phase2", {}),
                        "revised_done": int(revised_done),
                    },
                    "last_error": None,
                    "last_error_detail": None,
                },
            )
            save_session()

            success = True
            runtime.progress(0.7 + 0.2 * (revised_done / max(1, macro_total)))
            _macro_secs = max(0.0, time.monotonic() - float(step_t0))
            runtime.register_step_time(
                "macro", _macro_secs, done=revised_done, total=macro_total
            )
            record_step_metric(
                session, "macro", _macro_secs, done=revised_done, total=macro_total
            )
        except QuotaDailyLimitError:
            print("   Interruzione: progressi salvati. Potrai riprendere più tardi.")
            session["last_error"] = "quota_daily_limit_phase2"
            if session.get("last_error_detail") != "api_key_prompt_timeout":
                session["last_error_detail"] = None
            save_session()
            return client, revised_text
        except Exception as exc:
            log.warning(
                "Errore revisione blocco %d/%d: %s",
                index,
                macro_total,
                exc,
                extra={"stage": "phase2"},
            )

        if not success:
            print(
                f"   [!] Revisione blocco {index} fallita. Salvo provvisoriamente come raw (sarà riprovato)."
            )
            _atomic_write_text(raw_path, block_src + "\n")
            pending_retry.append((index, raw_path, rev_path))
            _macro_secs = max(0.0, time.monotonic() - float(step_t0))
            runtime.register_step_time(
                "macro", _macro_secs, done=revised_done, total=macro_total
            )
            record_step_metric(
                session, "macro", _macro_secs, done=revised_done, total=macro_total
            )

        runtime.progress(0.7 + 0.2 * (revised_done / max(1, macro_total)))
        if not sleep_with_cancel(cancelled, 5):
            print("   [*] Operazione annullata dall'utente.")
            return client, revised_text

    # ---- RETRY PASS: second attempt on provisionally-failed blocks ----
    if pending_retry:
        print(
            f"\n[*] Retry pass: {len(pending_retry)} blocco/i senza revisione. Riprovo..."
        )
        _update_session(
            session, {"revision_pending_blocks": [idx for idx, _, _ in pending_retry]}
        )
        save_session()

        failed_blocks: list[int] = []

        for index, raw_path, rev_path in pending_retry:
            if cancelled():
                print("   [*] Operazione annullata dall'utente (retry pass).")
                return client, revised_text

            try:
                with open(raw_path, encoding="utf-8") as _fh:
                    block_src = _fh.read().rstrip("\n")
            except Exception:
                block_src = ""

            if not block_src:
                _atomic_write_text(rev_path, "")
                try:
                    os.remove(raw_path)
                except Exception:
                    pass
                revised_done += 1
                _update_session(
                    session,
                    {
                        "stage": "phase2",
                        "phase2": {
                            **session.get("phase2", {}),
                            "revised_done": int(revised_done),
                        },
                    },
                )
                save_session()
                failed_blocks.append(index)
                continue

            block_local, removed_exact, removed_adj, _, _ = local_macro_cleanup(
                block_src
            )
            block_for_ai_retry = (block_local or block_src).strip()

            runtime.phase(f"Fase 2/3: retry revisione (blocco {index}/{macro_total})")
            print(f"   -> Retry revisione blocco {index}/{macro_total}...")
            step_t0 = time.monotonic()
            retry_success = False

            def _call_retry(current_client, _block=block_for_ai_retry):
                response = current_client.models.generate_content(
                    model=current_model_name(model_state, model_name),
                    contents=[_block],
                    config=types.GenerateContentConfig(
                        system_instruction=prompt_revisione,
                        temperature=0.1,
                    ),
                )
                current_text = extract_response_text(response)
                if not current_text:
                    raise RuntimeError("Risposta vuota dal modello in revisione.")
                return current_text

            try:
                client, current_text = retry_with_quota(
                    _call_retry,
                    client=client,
                    fallback_keys=fallback_keys,
                    model_name=model_name,
                    model_state=model_state,
                    cancelled=cancelled,
                    runtime=runtime,
                    request_fallback_key=request_fallback_key,
                    retry_sleep_seconds=20.0,
                    on_model_switched=on_model_switched,
                    logger=log,
                    resume_phase_text=f"Fase 2/3: retry revisione (blocco {index}/{macro_total})",
                )
                if current_text is None:
                    return client, revised_text
                _atomic_write_text(rev_path, current_text + "\n")
                try:
                    os.remove(raw_path)
                except Exception:
                    pass
                print(f"   [OK] Retry blocco {index}: revisione completata.")
                retry_success = True
                revised_done += 1
                _update_session(
                    session,
                    {
                        "stage": "phase2",
                        "phase2": {
                            **session.get("phase2", {}),
                            "revised_done": int(revised_done),
                        },
                        "last_error": None,
                        "last_error_detail": None,
                    },
                )
                save_session()
                _macro_secs = max(0.0, time.monotonic() - float(step_t0))
                runtime.register_step_time(
                    "macro", _macro_secs, done=revised_done, total=macro_total
                )
                record_step_metric(
                    session, "macro", _macro_secs, done=revised_done, total=macro_total
                )
            except QuotaDailyLimitError:
                print(
                    "   Interruzione: quota giornaliera raggiunta durante retry pass."
                )
                session["last_error"] = "quota_daily_limit_phase2"
                if session.get("last_error_detail") != "api_key_prompt_timeout":
                    session["last_error_detail"] = None
                save_session()
                return client, revised_text
            except Exception as exc:
                log.warning(
                    "Retry revisione blocco %d/%d fallita: %s",
                    index,
                    macro_total,
                    exc,
                    extra={"stage": "phase2"},
                )

            if not retry_success:
                print(
                    f"   [!!] Blocco {index}: revisione definitivamente fallita. Incluso non revisionato."
                )
                try:
                    with open(raw_path, encoding="utf-8") as _fh:
                        _raw_content = _fh.read().rstrip("\n")
                    _atomic_write_text(rev_path, _raw_content + "\n")
                except Exception:
                    _atomic_write_text(rev_path, block_src + "\n")
                revised_done += 1
                failed_blocks.append(index)
                _update_session(
                    session,
                    {
                        "stage": "phase2",
                        "phase2": {
                            **session.get("phase2", {}),
                            "revised_done": int(revised_done),
                        },
                    },
                )
                save_session()
                _macro_secs = max(0.0, time.monotonic() - float(step_t0))
                runtime.register_step_time(
                    "macro", _macro_secs, done=revised_done, total=macro_total
                )
                record_step_metric(
                    session, "macro", _macro_secs, done=revised_done, total=macro_total
                )

            runtime.progress(0.7 + 0.2 * (revised_done / max(1, macro_total)))

        session_update: dict = {"revision_pending_blocks": []}
        if failed_blocks:
            session_update["revision_failed_blocks"] = failed_blocks
        _update_session(session, session_update)
        save_session()
        if failed_blocks:
            print(
                f"\n[!!] ATTENZIONE: i seguenti blocchi sono stati inclusi non revisionati: {failed_blocks}"
            )

    # Rebuild revised_text from all final .md files (authoritative source of truth)
    revised_text = ""
    for idx in range(1, macro_total + 1):
        rpath = os.path.join(phase2_revised_dir, f"rev_{idx:03}.md")
        if os.path.exists(rpath):
            try:
                with open(rpath, encoding="utf-8") as _fh:
                    content = _fh.read().strip()
                if content:
                    revised_text += f"\n\n{content}\n\n"
            except Exception:
                pass

    return client, revised_text


def retry_failed_revision_blocks(
    *,
    client,
    model_name: str,
    model_state: ModelState | None = None,
    phase2_revised_dir: str,
    session: dict,
    save_session: Callable[[], bool],
    runtime,
    cancelled: Callable[[], bool],
    fallback_keys: list[str],
    request_fallback_key: Callable[[], str | None],
    prompt_revisione: str,
    on_model_switched=None,
    logger=None,
) -> tuple[object, dict]:
    """Retry only blocks previously shipped as unrevised raw markdown.

    The normal pipeline deliberately keeps ``rev_NNN.raw.md`` for failed blocks
    after this fix. For older sessions that only have ``rev_NNN.md``, we fall
    back to that file so users still have a recovery path.
    """

    log = logger or get_logger("el_sbobinator.revision_retry", stage="phase2")
    failed_blocks = _normalize_block_indexes(session.get("revision_failed_blocks"))
    if not failed_blocks:
        return client, {
            "retried_blocks": [],
            "failed_blocks": [],
            "cancelled": False,
            "quota_exhausted": False,
        }

    try:
        macro_total = int(session.get("phase2", {}).get("macro_total", 0) or 0)
    except (TypeError, ValueError):
        macro_total = 0
    macro_total = max(macro_total, max(failed_blocks))

    retried_blocks: list[int] = []
    remaining_blocks: list[int] = []
    was_cancelled = False
    quota_exhausted = False

    try:
        runtime.set_work_totals(macro_total=macro_total)
    except Exception:
        pass

    for position, index in enumerate(failed_blocks, 1):
        if cancelled():
            was_cancelled = True
            remaining_blocks.extend(failed_blocks[position - 1 :])
            break

        raw_path = os.path.join(phase2_revised_dir, f"rev_{index:03}.raw.md")
        rev_path = os.path.join(phase2_revised_dir, f"rev_{index:03}.md")
        source_path = raw_path if os.path.exists(raw_path) else rev_path
        try:
            with open(source_path, encoding="utf-8") as _fh:
                block_src = _fh.read().rstrip("\n")
        except Exception:
            block_src = ""

        if not block_src.strip():
            remaining_blocks.append(index)
            continue

        block_local, _removed_exact, _removed_adj, _near_adj, _ = local_macro_cleanup(
            block_src
        )
        block_for_ai_retry = (block_local or block_src).strip()

        try:
            runtime.phase(
                f"Fase 2/3: retry blocchi mancanti ({position}/{len(failed_blocks)})"
            )
        except Exception:
            pass
        step_t0 = time.monotonic()
        log.info(
            "Retry blocco non revisionato %d/%d.",
            index,
            macro_total,
            extra={"stage": "phase2_retry_failed_blocks"},
        )

        def _call_retry(current_client, _block=block_for_ai_retry):
            response = current_client.models.generate_content(
                model=current_model_name(model_state, model_name),
                contents=[_block],
                config=types.GenerateContentConfig(
                    system_instruction=prompt_revisione,
                    temperature=0.1,
                ),
            )
            current_text = extract_response_text(response)
            if not current_text:
                raise RuntimeError("Risposta vuota dal modello in revisione.")
            return current_text

        try:
            client, current_text = retry_with_quota(
                _call_retry,
                client=client,
                fallback_keys=fallback_keys,
                model_name=model_name,
                model_state=model_state,
                cancelled=cancelled,
                runtime=runtime,
                request_fallback_key=request_fallback_key,
                retry_sleep_seconds=20.0,
                on_model_switched=on_model_switched,
                logger=log,
                resume_phase_text=f"Fase 2/3: retry blocchi mancanti ({position}/{len(failed_blocks)})",
            )
            if current_text is None:
                if cancelled():
                    was_cancelled = True
                remaining_blocks.append(index)
                remaining_blocks.extend(failed_blocks[position:])
                break
            _atomic_write_text(rev_path, current_text + "\n")
            try:
                if os.path.exists(raw_path):
                    os.remove(raw_path)
            except Exception:
                pass
            retried_blocks.append(index)
            _macro_secs = max(0.0, time.monotonic() - float(step_t0))
            try:
                runtime.register_step_time(
                    "macro",
                    _macro_secs,
                    done=max(0, macro_total - len(failed_blocks) + len(retried_blocks)),
                    total=macro_total,
                )
            except Exception:
                pass
            log.info(
                "Blocco %d: revisione recuperata.",
                index,
                extra={"stage": "phase2_retry_failed_blocks"},
            )
        except QuotaDailyLimitError:
            quota_exhausted = True
            session["last_error"] = "quota_daily_limit_phase2"
            if session.get("last_error_detail") != "api_key_prompt_timeout":
                session["last_error_detail"] = None
            remaining_blocks.append(index)
            remaining_blocks.extend(failed_blocks[position:])
            save_session()
            break
        except Exception as exc:
            log.warning(
                "Retry manuale blocco %d/%d fallito: %s",
                index,
                macro_total,
                exc,
                extra={"stage": "phase2_retry_failed_blocks"},
            )
            remaining_blocks.append(index)

    session_update = {
        "revision_failed_blocks": remaining_blocks,
        "revision_pending_blocks": [],
    }
    if not remaining_blocks:
        session_update["last_error"] = None
        session_update["last_error_detail"] = None
    _update_session(session, session_update)
    save_session()

    return client, {
        "retried_blocks": retried_blocks,
        "failed_blocks": remaining_blocks,
        "cancelled": was_cancelled,
        "quota_exhausted": quota_exhausted,
    }
