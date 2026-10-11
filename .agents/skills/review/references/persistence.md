# Persistence and identity

Read the relevant parts of [session_model.md](../../../../docs/session_model.md) and trace actual callers; older prose may use legacy paths, so current implementations and schemas determine behavior.

## Editor saves and close

- In [useEditorAutosave.ts](../../../../webui/src/hooks/useEditorAutosave.ts), equality with `lastPersistedRef` is not proof of current disk state while a submitted write is unconfirmed. `diskStateConfirmedRef` and save generation/result semantics must preserve that distinction.
- `flushPendingAutosave()` may permit close only after the current snapshot is confirmed persisted. An equal snapshot without disk confirmation may need a restoring write. Rejected/stale saves, pending acknowledgements and a document switch must not incorrectly mark the active document saved or allow data loss.
- Trace the backend [html_controller.py](../../../../el_sbobinator/bridge/controllers/html_controller.py), generation ordering and native close path in [webview_entry.py](../../../../el_sbobinator/webview_entry.py). Keep error recovery usable; a UI success state must correspond to the actual write result.
- Validate temporal changes with delayed/failing writes, edit/revert while a save is pending, close and disk readback/reopen. Preserve unrelated documents and original content; a green mock test alone is insufficient for a native-close claim.

## Session roots and archive associations

- Use [session_store.py](../../../../el_sbobinator/core/session_store.py) for session identity, root resolution and atomic persistence. Preserve completed work during recovery or regeneration unless its destruction was explicitly requested.
- When storage moves, follow [settings_controller.py](../../../../el_sbobinator/bridge/controllers/settings_controller.py) and [folders_service.py](../../../../el_sbobinator/services/folders_service.py): migrate secondary references, reconcile stale metadata on read, and notify the frontend of the old/new roots. Inspect tags, folders and queued output/media references affected by the move.
- Windows paths are case-insensitive while JS keys are not. Use the existing `normalizeSessionPath` from [utils.ts](../../../../webui/src/utils.ts) for session lookup/association keys; retain filesystem-aware backend normalization. Do not apply Windows lowercasing indiscriminately to case-sensitive platforms or display labels.
- Verify archive reducer/selection state across deletion, move, reload and stale asynchronous responses. Missing media or corrupt metadata should be recoverable without discarding valid transcript content.

Choose an isolated temporary archive for probes. Assert the persisted model/content and reopened state, not only the rendered preview or acknowledged request.
