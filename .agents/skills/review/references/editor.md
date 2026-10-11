# Editor and document fidelity

The main workflow is editing transcripts in the app and transferring formatted content to Google Docs. HTML also supports persistence and compatibility. Validate the changed user action and resulting semantic content, not only an HTML string or screenshot.

## Shared formatting and model

- [document_formatting.json](../../../../el_sbobinator/document_formatting.json), [documentFormatting.ts](../../../../webui/src/documentFormatting.ts) and [document-formatting.md](../../../../docs/document-formatting.md) define shared formatting. Read their current values; do not hardcode a second list of heading sizes or content width in this skill.
- Block-format commands must clear conflicting inline font-size marks where required (`clearBlockFontSize` in [editorExtensions.ts](../../../../webui/src/editorExtensions.ts)). Preserve authored formatting that belongs to the user, and distinguish document defaults from explicit overrides during paste, normalization and export.
- Preserve lists/markers, soft breaks, tables, equations, image layout/captions and Unicode as editable semantic content through the affected transformation. Test astral characters as well as ordinary text when offsets/selection are involved; identical corrupted fixture and expectation text is not adequate coverage.
- Respect TipTap ownership and destroyed-editor checks for delayed callbacks, effects, commands and teardown. Inspect the actual API lifecycle; do not mandate blanket `try/catch` around every command or destroy an instance owned by another layer.

## Clipboard and images

- Follow the relevant paths in [editorClipboard.ts](../../../../webui/src/editorClipboard.ts), [editorSelectionClipboard.ts](../../../../webui/src/editorSelectionClipboard.ts), [utils.ts](../../../../webui/src/utils.ts) and [useEditorImageDrop.ts](../../../../webui/src/hooks/useEditorImageDrop.ts). Toolbar copy, keyboard copy, context-menu copy and selection copy may have distinct semantics; test the trigger actually changed.
- Portable images need explicit pixel dimensions derived from the shared document width, compatible responsive styles and target-sized bitmap data where the current clipboard pipeline requires it. Preserve parsing of native attributes and imported pixel dimensions in [FloatingImage.tsx](../../../../webui/src/components/FloatingImage.tsx); avoid restoring a full-margin bitmap by normalizing only its wrapper CSS.
- Image-only clipboard MIME data can be valid without HTML or plain text. Check MIME routing, placement, oversize handling, undo/redo, autosave and reopen for relevant image paste/drop changes.
- For recipient-sensitive changes, compare actual Google Docs content, dimensions and editability after the relevant paste. Existing [parity matrix](../../../../docs/editor-google-docs-parity-matrix.md) and [desktop acceptance](../../../../docs/editor-desktop-acceptance-2026-10-07.md) provide bounded evidence and scenarios, not universal certification. Report recipient limitations accurately.

## Geometry and UI consistency

- In [imageDrag.ts](../../../../webui/src/imageDrag.ts), pointer gestures must use current geometry when zoom, scroll or layout changes, including at release. Preserve the correct owning block/table cell, selection, image attributes and history. Test movement across affected boundaries rather than relying only on default-zoom coordinates.
- Compare repeated controls with shared components and the CSS cascade in [index.css](../../../../webui/src/index.css), in both themes and relevant sizes. Keep natural Italian wording and consistent modal/close-control behavior. Existing flat content surfaces and shared overlay elevation tokens guide local changes; document-specific styling and deliberate variants must not become false positives.
- Pagination is a separate feature. Do not add it or redesign the editor as an incidental fix to copy, image layout or persistence.
