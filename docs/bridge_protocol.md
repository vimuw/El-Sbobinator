# Bridge protocol

The Python backend and the React frontend live in the same pywebview process but communicate as if over a bridge. This doc is the contract: which events flow each way, what their payloads look like, and how batching/ordering is guaranteed.

## Layers

```
┌──────────────────────────────────────────────────────────────────┐
│                 React app (webui/src/*)                         │
│                                                                  │
│  window.pywebview.api.* ◄──────── JS → Python (sync/async RPC)  │
│                                                                  │
│  window.elSbobinatorBridge.* ──── Python → JS (event push)      │
└──────────────────────────────────────────────────────────────────┘
             ▲                                        │
             │ evaluate_js                            │ JS API methods
             │                                        ▼
┌──────────────────────────────────────────────────────────────────┐
│            Python backend (el_sbobinator/app_webview.py)         │
│                                                                  │
│  _BridgeDispatcher   ──►  window.evaluate_js(...)               │
│                                                                  │
│  ElSbobinatorApi     ◄── pywebview JS-API dispatcher             │
│                                                                  │
│  PipelineAdapter     ──►  emits BridgeEvents through dispatcher  │
│  PipelineRuntime     ──►  duck-typed facade over PipelineAdapter │
└──────────────────────────────────────────────────────────────────┘
```

All pipeline code (in `pipeline.py`, `phase1_service.py`, `revision_service.py`, `generation_service.py`) talks exclusively to `PipelineRuntime` (`el_sbobinator/pipeline_hooks.py`). The runtime forwards calls to whatever adapter is attached — in the real app that's `PipelineAdapter` in `el_sbobinator/app_webview.py`, which turns them into bridge events. Tests use a simple dummy object.

## Python → JS events

Source: `_BridgeDispatcher` + `PipelineAdapter` in `el_sbobinator/app_webview.py`. Consumer: `BridgeCallbacks` in `webui/src/bridge.ts` via `createBridge(...)` and `processingReducer` in `webui/src/appState.ts`.

### Dispatcher semantics

- The dispatcher buffers events and flushes them with `window.evaluate_js(<multi-line script>)` roughly every `flush_interval` seconds (default **0.08 s** inside the app, 0.12 s default on the class).
- Events marked **batched** collapse multiple pushes into the latest value (keyed by event name). High-frequency updates like `updateProgress` therefore never swamp the JS runtime.
- Non-batched events use a FIFO queue. Before a non-batched event is queued, any pending batched values are flushed into the queue first so ordering is preserved — this matters for lifecycle events (`setCurrentFile`, `fileDone`, …) that must follow the progress they supersede.
- If `window.evaluate_js` fails (window closed, not ready, JS exception), events are re-queued up to `MAX_RETRIES = 3` times before being dropped.

### Event table

| Event name | Batched? | Payload | Emitter | Purpose |
|---|---|---|---|---|
| `updateProgress` | yes | `float` (0.0–1.0) | `PipelineAdapter.aggiorna_progresso` | Overall pipeline progress for the current file. |
| `updatePhase` | yes | `string` | `PipelineAdapter.aggiorna_fase` | Human-readable phase label (e.g. `"Fase 1/3: trascrizione (chunk 3/8)"`). |
| `updateModel` | yes | `string` | `PipelineAdapter.update_model` | Currently active Gemini model id. |
| `setWorkTotals` | yes | `{chunks?, macro?}` — each `int \| null` | `PipelineAdapter.set_work_totals` | Total items per kind; used for the step counters and ETA. |
| `updateWorkDone` | yes | `{kind: "chunks"\|"macro", done: int, total: int\|null}` | `PipelineAdapter.update_work_done` | Incremental counters per phase. |
| `registerStepTime` (Deprecated/Unused) | yes | `{kind, seconds, done?, total?}` | `PipelineAdapter.register_step_time` | [DEPRECATED/UNUSED] Formerly used to track elapsed time for a single step to drive the EMA-based ETA. |
| `setCurrentFile` | no | `{index: int, id: string, total: int}` | Inside `ElSbobinatorApi.start_processing._run` | New file in the batch has started. |
| `fileDone` | no | `{index, id, output_html, output_dir, primary_model?, effective_model?}` | `ElSbobinatorApi.start_processing._run` | File completed successfully. |
| `fileFailed` | no | `{index, id, error, error_detail?}` | `ElSbobinatorApi.start_processing._run` | File failed; `error` may be a `last_error` key mapped via `utils.errorLabel`; `error_detail` carries optional session detail such as `api_key_prompt_timeout`. |
| `processDone` | no | `{cancelled: bool, completed: int, failed: int, total: int, quota_exhausted?}` | `ElSbobinatorApi.start_processing._run` (finally) | Batch has finished (or was cancelled). `quota_exhausted` marks a terminal quota stop so auto-continue does not restart queued files. |
| `askRegenerate` | no | `{filename: string, mode?: "completed" \| "resume"}` | `PipelineAdapter.ask_regenerate` | Pipeline needs the user to decide "regenerate vs. use saved". |
| `askNewKey` | no | `{}` | `PipelineAdapter.ask_new_api_key` | Quota exhausted; ask the user for a new API key. |
| `dismissNewKey` | no | `{}` | `PipelineAdapter.dismiss_new_api_key_prompt` | Close the new-key prompt after backend timeout without treating it as a user cancellation. |
| `filesDropped` | no | `FileDescriptor[]` | `ElSbobinatorApi.collect_dropped_files` | New files dropped on the window; front-end adds them to the queue. |
| `updateDownloadProgress` | no | `{status: string, bytes_done: number, bytes_total: number, error?: string}` | `updater.py` via auto-update process | Native download/installation progress during auto-updates. |
| `appendConsole` | no | `string` | `_ConsoleTee` (wraps `sys.stdout`/`stderr`) | Forwarded stdout/stderr for the in-app terminal. |

The TypeScript-side payload shapes are the same ones declared in `webui/src/appState.ts` (`WorkTotalsPayload`, `WorkDonePayload`, `StepTimePayload`, `SetCurrentFilePayload`, `FileDonePayload`, `FileFailedPayload`, `ProcessDonePayload`) and `webui/src/bridge.ts` (`BridgeCallbacks`). The Python-side counterparts are `TypedDict`s in `el_sbobinator/bridge_types.py`.

## JS → Python API

Source: `ElSbobinatorApi` in `el_sbobinator/app_webview.py`. Consumer: `PywebviewApi` interface in `webui/src/bridge.ts` (accessed via `window.pywebview.api`).

### Settings / archive

| Method | Arguments | Returns | Notes |
|---|---|---|---|
| `load_settings()` | — | `{api_key, fallback_keys, preferred_model, fallback_models, available_models, has_protected_key, api_key_insecure, api_key_insecure_reason}` | `available_models` mirrors `MODEL_OPTIONS`; `api_key_insecure` warns when Windows DPAPI was unavailable and the key is plaintext on disk. |
| `save_settings(api_key, fallback_keys, preferred_model, fallback_models)` | API key (nullable), list of strings, model id, list of ids | `{ok, error?}` | Writes via `config_service.save_config`. |
| `save_theme_preference(theme)` | theme string (`"light"` \| `"dark"`) | `None` | Persists theme preference to disk. |
| `validate_environment(api_key?, check_api_key?, preferred_model?, fallback_models?)` | `{ok, result?: ValidationResult, error?}` | Cached environment check. | |
| `get_session_storage_info()` | — | `{ok, total_bytes, total_sessions, session_root, error?}` | Wraps `shared.get_session_storage_info` (30 s cache). |
| `cleanup_old_sessions(max_age_days=14)` | — | `{ok, removed, freed_bytes, errors, candidates, preserved_completed, missing_completed_html, error?}` | Deletes incomplete session folders older than threshold. |
| `cleanup_completed_sessions(max_age_days=14)` | — | `{ok, removed, freed_bytes, errors, candidates, preserved_completed, missing_completed_html, error?}` | Counts or deletes completed session folders older than threshold. |
| `get_completed_sessions(limit=20)` | — | `{ok, sessions: ArchiveSession[], total, error?}` | 5 s internal cache; filters for `stage == "done"`. |
| `delete_session(session_dir)` | absolute path under `SESSION_ROOT` | `{ok, error?}` | Path-traversal-checked. |
| `update_session_input_path(session_dir, new_path)` | — | `{ok, error?}` | Relinks the audio path after the user moves the file. |
| `open_session_folder()` | — | `{ok, error?}` | Opens `SESSION_ROOT` in the OS file manager. |
| `ask_session_folder()` | — | `{ok, path?, cancelled?: bool, error?}` | Opens a folder-picker dialog and returns the selected path. |
| `move_session_root(new_path)` | new absolute path | `{ok, started?, error?}` | Starts an asynchronous background move of all sessions to `new_path`. |
| `get_session_move_status()` | — | `{status, moved?, total?, error?}` | Returns the current status of an ongoing or completed session move. |
| `get_archive_folders()` | — | `{ok, folders: ArchiveFolder[], error?}` | Returns user-defined folder list for sorting sessions. |
| `save_archive_folders(folders)` | folder list | `{ok, error?}` | Persists the folder list to folders.json. |
| `search_sessions(query, limit=10)` | query string, limit | `{ok, results: SearchSessionResult[], error?}` | Searches plain-text content of every completed session HTML. |
| `retry_failed_revision_blocks(session_dir)` | session directory path | `{ok, retried_blocks?, remaining_failed_blocks?, html_path?, session_dir?, effective_model?, completion_status?, cancelled?, quota_exhausted?, conflict?, error?}` | Retries unrevised macro blocks from a done session using current API key. |

### File intake

| Method | Arguments | Returns | Notes |
|---|---|---|---|
| `ask_files()` | — | `BridgeFileItem[]` | Native multi-select dialog. |
| `ask_media_file()` | — | `BridgeFileItem \| null` | Native single-select dialog (used to re-link audio). |
| `check_path_exists(path)` | absolute path | `{ok, exists}` | Used when re-hydrating the queue from `localStorage`. |
| `collect_dropped_files(names)` | list of basenames | `{ok}` | Retrieves OS paths for drag-and-dropped files via the WebView2 native-bridge; then emits `filesDropped`. Only allowed audio/video extensions are surfaced. |

### Processing lifecycle

| Method | Arguments | Returns | Notes |
|---|---|---|---|
| `start_processing(files, api_key, resume_session, preferred_model?, fallback_models?)` | `BridgeFileItem[]`, key, bool, optional strings | `{ok, error?}` | Persists config, then launches the pipeline worker thread. |
| `stop_processing()` | — | `{ok}` | Sets the cancel event; pipeline exits at the next check. Also cancels any pending `ask_*` prompts. |
| `answer_regenerate(regenerate)` | `true \| false \| null` | `{ok}` | `null` treats the prompt as cancelled. |
| `answer_new_key(key)` | new API key string | `{ok}` | Empty string = refuse and abort. |

### Filesystem helpers

| Method | Arguments | Returns | Notes |
|---|---|---|---|
| `open_file(path)` | absolute path to a whitelisted file type or a session dir | `{ok, error?}` | Extensions: `.html .htm .docx .doc .pdf .txt .md`. Rejects `http(s)://` — use `open_url`. |
| `open_url(url)` | URL with an allowed prefix | `{ok, error?}` | Allowlist: `github.com`, `ko-fi.com`, Microsoft's WebView2 install link, `aistudio.google.com`. |
| `read_html_content(path)` | path under Desktop or `SESSION_ROOT` | `{ok, content?, error?}` | Path-traversal-checked; also caches the outer `<html>…<body>` shell for the matching `save_html_content`. |
| `save_html_content(path, content, generation?)` | — | `{ok, error?}` | `generation` is a monotonic counter used to drop stale autosaves. Only the body is written; the cached shell is preserved. |
| `stream_media_file(path, session_dir?)` | audio/video path, optional session dir | `{ok, url?, error?}` | Starts a `LocalMediaServer` (Range-request capable) and returns a `http://127.0.0.1:<port>/stream.media?t=<ts>` URL. |
| `show_notification(title, message)` | — | `void` | Best-effort OS notification. |
| `download_and_install_update(version)` | version string without `v` prefix? (`updater.py` handles both) | `{ok, error?}` | Downloads the GitHub release asset for the current OS, launches it, and schedules the webview to close. |

### Shared type definitions

- `BridgeFileItem` — `el_sbobinator/bridge_types.py`:
  ```python
  {"id": str, "path": str, "name": str, "size": int, "duration": float, "resume_session": bool}
  ```
- `FileDescriptor` — TS equivalent in `webui/src/appState.ts`. Same shape minus `id` being optional on intake.
- `ValidationResult` — `{ok, summary, checks: ValidationCheck[]}`. Checks look like `{id, label, status: "ok"|"warning"|"error", message, details?}`.
- `ArchiveSession` — `{name, completed_at_iso, html_path, effective_model, input_path, session_dir}`.
- `ModelOption` — `{id, label, summary, default_chunk_minutes, phase1_temperature?}`.

## `PipelineRuntime` — the duck-typed facade

File: `el_sbobinator/pipeline_hooks.py`. The pipeline never touches `PipelineAdapter` directly; it wraps it (or a dummy) in `PipelineRuntime`. The runtime has a small surface area, so swapping the UI layer is contained to that one file.

| Runtime method | Target attribute / method on the adapter | Called from |
|---|---|---|
| `progress(value)` | `aggiorna_progresso(value)` | `pipeline.py`, `phase1_service.py`, `revision_service.py` |
| `phase(text)` | `aggiorna_fase(text)` | everywhere |
| `update_model(model)` | `update_model(model)` | `pipeline.py` (model fallback) |
| `set_work_totals(chunks_total=None, macro_total=None)` | `set_work_totals(...)` | `phase1_service.py`, `revision_service.py` |
| `update_work_done(kind, done, total=None)` | `update_work_done(...)` | `phase1_service.py`, `revision_service.py` |
| `register_step_time(kind, seconds, done=None, total=None)` (Deprecated/Unused) | `register_step_time(...)` | `phase1_service.py`, `revision_service.py` (calculations removed) |
| `output_html(path, output_dir=None)` | `imposta_output_html(path, output_dir)` | `pipeline.py` (final export) |
| `process_done()` | `processo_terminato()` | `pipeline.py` (finally block) |
| `set_run_result(status, error=None)` | `set_run_result(...)` or `last_run_{status,error}` attributes | `pipeline.py` (finally block) |
| `set_effective_api_key(api_key)` | `set_effective_api_key(...)` or `effective_api_key` attribute | `generation_service.retry_with_quota` |
| `ask_regenerate(filename, callback, mode)` | `ask_regenerate(filename, callback, mode)` | `pipeline.py` (resume flow) |
| `ask_new_api_key(callback)` | `ask_new_api_key(callback)` | `generation_service.request_new_api_key` |
| `ask_confirmation(title, message)` | `window.create_confirmation_dialog(...)` | `pipeline.py` fallback for `ask_regenerate` |
| `track_temp_file(path)` / `reset_temp_files()` / `cleanup_temp_files()` | `file_temporanei` list attribute | `phase1_service.py` / `pipeline.py` |
| `cancel_event` / `cancelled()` | `cancel_event` attribute | everywhere |
| `schedule(delay_ms, cb, *args)` | `after(delay_ms, cb, *args)` | unused in the current pipeline (kept for parity with the old CTk UI) |

## Ordering guarantees

- **Within a single flush**, events execute in the order they were queued. `_BridgeDispatcher.flush` concatenates them into one `evaluate_js` script so the JS engine runs them atomically from the renderer's perspective.
- **Across flushes**, batched values are always emitted *before* any newer non-batched event enqueued during the same cycle. The code path is: copy `_queue` to the local list, append the current `_latest` batched dict, append `_pending` retries last (retries are stale by definition). This stops progress from landing on a file that already received `setCurrentFile` for the next one.

## Where to look next

- [`architecture.md`](./architecture.md) — module map and threading model.
- [`pipeline.md`](./pipeline.md) — which events each phase emits and in which order.
- [`session_model.md`](./session_model.md) — the durable state that the UI is visualizing.
