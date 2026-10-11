# Runtime contracts

## Bridge and startup

- Read relevant [bridge protocol](../../../../docs/bridge_protocol.md), frontend [bridge.ts](../../../../webui/src/bridge.ts), backend [bridge_types.py](../../../../el_sbobinator/bridge/bridge_types.py) and controller/dispatcher code. Verify payloads, optional fields, event ordering/batching, error results and stale-response ownership on both sides.
- Startup must expose a usable bridge or an actionable failure. Preserve version/identity checks; do not hide a missing packaged backend version with a frontend version fallback. Trace [desktop_startup.py](../../../../el_sbobinator/core/desktop_startup.py), [app_webview.py](../../../../el_sbobinator/app_webview.py) and [webview_entry.py](../../../../el_sbobinator/webview_entry.py) when touched.
- CSP changes in [index.html](../../../../webui/index.html) can affect native bridge injection differently in WebView2 and WKWebView. Preserve compatibility requirements covered by [csp.test.ts](../../../../webui/src/csp.test.ts) until a supported injection mechanism and runtime evidence justify changing them. A Windows pass does not prove macOS bridge initialization. Avoid treating a version-specific workaround as a universal browser/security rule.

## Gemini, workers and local services

- Read the affected [pipeline](../../../../docs/pipeline.md) and implementation for settings, model IDs, key rotation, retry, cancellation and resume. Preserve saved choices and distinguish transient, quota, model-access and permanent errors using current contracts. Do not embed changing model availability or defaults in skill text.
- Inspect FFmpeg argument construction, worker cancellation, subprocess cleanup, temporary media and error propagation. Keep blocking work off the UI lifecycle and release only resources owned by the task. Local startup/media servers need correct shutdown, request containment and open-stream handling.
- Ensure logs, support bundles, errors and frontend payloads do not expose API keys. Follow [credentials.py](../../../../el_sbobinator/core/credentials.py) and current configuration migration; native credential-store behavior requires native evidence when claimed.

## Imports, updates and packaging

- For HTML/media/session import, inspect validation and containment through [html_controller.py](../../../../el_sbobinator/bridge/controllers/html_controller.py), [sharing_service.py](../../../../el_sbobinator/services/sharing_service.py) and relevant render/export code. Imported content must preserve useful document semantics without gaining script execution or arbitrary filesystem access.
- Distinguish checking update availability, downloading, verifying, launching an installer and closing the app. Follow [updater.py](../../../../el_sbobinator/core/updater.py) and frontend state transitions; failed checks should not pretend installation occurred, and pending/saving/error states must stay usable.
- For installer/updater changes, inspect [packaging](../../../../packaging) and [.github/workflows/build.yml](../../../../.github/workflows/build.yml). Check integrity verification and save/close behavior before replacement. Do not introduce forced termination that can bypass failed or pending persistence.
- Separate source-runtime, PyInstaller and Setup/DMG results. A passing browser suite or build job does not demonstrate install/update/uninstall or crash recovery.
