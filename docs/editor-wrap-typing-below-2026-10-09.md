# Wrap typing below late figures — 2026-10-09

The user reported typing lag in a newly authored paragraph below two Wrap
images, before the next heading. The application was running from source.
The earlier multi-image tests placed figures near the beginning of a document;
they did not cover this late-figure paragraph boundary.

## Reproduction and change

A saved copy of the reported transcript was loaded into an isolated test
session. It contains 14 images, including two right-aligned Wrap images late
in the document. The original session was read to make the copy; test edits and
autosaves used separate session roots.

Before the change, typing the 39-character probe below those images produced
39 measurements, copying up to 187 root blocks. Individual measured copies
took up to 73.5 ms in that run. The calculation included all preceding content
and also treated its following measurement buffer as an affected region.

`imageWrap.ts` now copies the blocks covering the first through last Wrap
figure with surrounding buffers. An empty prefix preserves the vertical
origin without cloning preceding text and assets. Text, image, and atom
position mappings use that same selected region. Complete lists/tables remain
intact. The cached affected boundary is computed from the solved exclusion
region, image anchors, and gaps, rather than from the measurement buffer.

On the same transcript snapshot, typing in the new paragraph below the figures
produced **zero Wrap measurements**. When an edit still affects the exclusion
area, the measured copy contained at most 11 blocks rather than 187.
Measurements remain necessary beside images and for edits above them; this is
not a claim that all editing in all documents avoids layout work.

## Behavioral verification

- Chromium: 17 existing Wrap cases passed, including two/four-image placements
  beside/below/above, collision-free text, resize, table-cell anchors, zoom,
  typing near/far, history, and persisted reopen.
- New permanent regression: 180 preceding paragraphs, two late figures, typing
  below them, bounded initial clone size, zero subsequent measurements,
  stable figure geometry, text exclusion, undo/redo, autosave, and exact reopened
  document model. All three cases passed at 90%, 100%, and 110% zoom. The fixture
  installation is kept separate from typing history. Together with the 17
  existing cases, this covers 20 distinct Chromium cases.
- Source WebView2 with rebuilt production frontend and the real Python bridge:
  isolated copy of the reported transcript, initial copies of 11/9/11 blocks,
  zero measurements during JS typing transactions below the figures, stable
  images, undo/redo, and exact model after autosave and reopening. Native typing
  was driven by transactions; Chromium covers keyboard input.
- Full authoritative check passed: lint, Python/frontend type checks, backend
  tests with coverage, and frontend tests with coverage. Production frontend
  build and `git diff --check` passed as well.

Local evidence is under `_smoke/wrap-typing-below-2026-10-09/`: original snapshot,
before/after measurement reports, native report, Playwright artifacts, and full
project check log. No commit, push, executable packaging, or release is part of
this correction.
