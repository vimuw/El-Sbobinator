# Proposed WebView2 and diagnostic logging review invariants

Proposed addition under `#### 1. Project-Specific Domain Standards` in
`.agents/skills/review/SKILL.md`. The skill file has not been changed.

```diff
--- a/.agents/skills/review/SKILL.md
+++ b/.agents/skills/review/SKILL.md
@@
 #### 1. Project-Specific Domain Standards
+- **Unified Startup Diagnostics**: Initialize the bounded, sanitized general log before WebView2 detection. The support report must read the same log written by the app and include the separately persisted latest startup result, even after log rotation. Recovery HTML must expose the log path without requiring the modern WebUI. Polling must not emit repeated records; session processing details must remain in their run.log files. Diagnostic write failures must never block startup.
+- **Local Support Bundles**: Preserve the last failed startup and last error across successful restarts. Correlate bounded Python, frontend and bridge incidents with boot/operation identifiers. Support export must remain local and must not trigger credential checks. Only collect selected metadata and bounded logs from a validated archive session; exclude media, transcript state and full configuration, redact recognized credentials and personal paths. Cover save cancellation/failure, early frontend errors, redaction and multibyte size limits with regression tests. Load bootstrap collection from an external script allowed by the existing CSP.
+- **WebView2 Detection and Recovery Renderer**: On Windows, `has_webview2_runtime()` must require the WebView2 native loader to confirm an available runtime before loading the modern WebUI. Registry entries, cached `winforms.is_chromium`, and nonempty binaries are insufficient. Select the pywebview renderer consistently at startup, including MSHTML for the recovery page when native detection fails. The installation monitor must probe without changing the renderer of an existing window; switch backends only in the restarted process. On macOS, skip all Windows runtime probes. Cover stale registry entries, incomplete binaries, native loader failures, and recovery polling with regression tests.
```

## Proposed credential migration and imported HTML invariants

The following additions are proposed under `#### 1. Project-Specific Domain Standards`
in `.agents/skills/review/SKILL.md`. The skill file has not been changed.

```diff
--- a/.agents/skills/review/SKILL.md
+++ b/.agents/skills/review/SKILL.md
@@
 #### 1. Project-Specific Domain Standards
+- **Credential Migration Cleanup and Truthful Status**: After a protected save or plaintext migration publishes the modern config, scrub plaintext in the legacy config before removing it. Rename/delete failures must not leave plaintext in a `.migrated` copy. `api_key_insecure` must account for plaintext remaining in either the legacy file or its migration copy, even when the effective credential is protected or process-only; propagate this flag through both load and save bridge responses. Cover recovery after failed protection, cleanup failures, and restart behavior.
+- **Imported HTML Content Preservation**: Sanitize imported HTML and rebuild the trusted document shell without losing valid body content. Entering an explicit body must end head collection even when the optional `</head>` is omitted. Verify the complete package import preserves lesson text and formulas while excluding scripts and retaining the trusted CSP.
```
