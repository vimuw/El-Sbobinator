---
name: learn-bug
description: Wrap up an El Sbobinator bug fix with a meaningful regression check, appropriate verification and selective documentation of durable domain lessons. Use after a fix or when the user asks to capture a lesson.
---

# Bug-fix wrap-up

Identify the observed trigger, root cause, corrected behavior and affected boundary from the actual diff and reproduction. Distinguish confirmed evidence from assumptions. Stay within the authorized fix; this workflow does not imply commit, push or release authority.

## Regression evidence

Check existing tests before adding another. For a behavioral bug, add or update a regression that fails on the faulty behavior and passes with the fix when practical. Assert outcomes rather than the chosen implementation.

- Python logic and persistence: `tests/test_*.py`.
- Frontend pure logic: `webui/src/**/*.test.{ts,tsx}`.
- DOM/editor interactions: `webui/src/**/*.dom.test.{ts,tsx}`.
- Browser gestures and integration: `webui/e2e/*.spec.ts`.
- Native clipboard, close handling, packaged runtime or installer: use isolated real-runtime evidence when that boundary is essential; a mock/browser result alone does not prove it.

Choose the lowest layer that exposes the defect. A reversible copy or cosmetic edit may need inspection instead of a contrived automated test. If automation cannot cover a relevant native behavior, record the reproduction, observed result and remaining limit.

Complete or reuse [project verification](../check/references/verification.md) for the final content. Do not rerun an unchanged gate merely because this wrap-up started.

## Retain only useful lessons

Add a lesson only if it is durable, non-obvious, evidenced and likely to change future decisions. First check for an existing invariant; refine it rather than appending another incident. Put domain guidance in the relevant [review reference](../review/SKILL.md) or authoritative project document, not an ever-growing review entrypoint. Link to configuration/code for values and implementation details likely to change.

If the user requested learning or skill/documentation updates, that authorizes the scoped update; do not ask again. Otherwise finish the fix and present a concrete proposed documentation change separately before applying it. Do not create a mandatory `learning_proposal.md` for every fix or update unrelated coding rules or personal memory.

Report root cause, regression evidence, completed checks and any lesson actually retained or proposed. State material platform limits and source/history side effects.
