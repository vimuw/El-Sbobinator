---
name: maintainability
description: Assess El Sbobinator files, modules or changes for concrete maintenance costs and proportionate architectural improvements. Use for code-health or refactoring reviews; propose changes before applying them unless implementation is requested.
---

# Pragmatic maintainability review

Establish the requested scope and inspect current sources before recommending a design. For a diff, include relevant callers and tests; for a repository assessment, prioritize paths with observable maintenance costs. Preserve existing work and distinguish review from implementation.

## Project fit

Read [architecture](../../../docs/architecture.md) for the current layout. The main application is Python/pywebview with a React/TypeScript TipTap UI, local file persistence, FFmpeg workers and direct Gemini requests. Local startup/media serving supports the desktop app; it is not a reason to introduce cloud or enterprise service architecture. Consult manifests for current dependency versions rather than embedding them here.

Prefer existing controllers, services, hooks and pure utilities when their responsibilities fit. Introduce an abstraction when it simplifies actual callers, makes a fragile boundary testable or removes meaningful duplication. Preserve bridge payloads, session schemas and document semantics; use the relevant [review domain reference](../review/SKILL.md) when a proposal touches them.

## Evidence to look for

- Responsibilities that change for independent reasons, duplicated nontrivial logic, or a small change requiring coordinated edits across unrelated modules.
- Hidden ownership of editor instances, event listeners, subprocesses, file handles and asynchronous state; cleanup and stale-result handling should be understandable together.
- React state/effect chains that obscure transitions, unsafe render-time side effects, unvalidated bridge payloads and casts that hide actual incompatibility. Recommend memoization for an identified expensive or identity-sensitive path, not automatically for every computation.
- Python controllers doing unrelated business work, exception handling that hides failures, or worker lifecycles that are hard to cancel, recover or test.
- Core transformations tied unnecessarily to DOM, bridge or native globals when a pure boundary would support meaningful tests.

Length, prop count and hook count are inspection signals, not findings. Explain the concrete cost before recommending extraction. Respect deliberate UI differences, framework ownership and documented compatibility workarounds. Avoid broad cosmetic churn, blanket defensive catches and new layers for simple local operations.

## Deliverable

For each useful finding give its location, demonstrated maintenance cost, smallest effective improvement and behavior/tests that must remain intact. Include a code sketch only when it materially clarifies the proposal. Prioritize a few improvements by benefit, change risk and effort; identify existing patterns worth keeping. If implementation is requested, work within that scope and follow [verification guidance](../check/references/verification.md).
