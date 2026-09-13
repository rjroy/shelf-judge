---
title: Reflection tool-owned completion implementation notes
date: 2026-09-12
status: complete
tags: [reflection, grounded-analysis, implementation]
source: conversation
modules: [daemon, reflection-refresh]
---

# Reflection tool-owned completion implementation notes

Phase gate: **complete**. Overall status: **complete**.

| Source obligation                                                                                                                                                        | Executable evidence                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The Pi prompt tells the model to retrieve evidence through collection tools and submit its final result with `submit_grounded_analysis`; assistant narration is ignored. | `packages/daemon/tests/services/reflection-refresh-service.test.ts`: the local SSE tool-loop regression retrieves evidence, submits an abstained result, and saves it.                                                                    |
| A rejected tool call is correctable rather than terminal.                                                                                                                | `packages/daemon/tests/services/reflection-refresh-service.test.ts`: invalid-then-valid submission regression saves exactly once.                                                                                                         |
| A submission is valid only against retrieved registry authority.                                                                                                         | `packages/daemon/tests/services/reflection-refresh-service.test.ts`: unknown citations are rejected; accepted citations are hydrated from registry metadata.                                                                              |
| The assistant turn's cumulative usage belongs to the accepted save.                                                                                                      | `packages/daemon/tests/services/reflection-refresh-service.test.ts`: accepted submission persists the completed-turn cumulative usage snapshot.                                                                                           |
| A result is not published until current source/provider fences accept it.                                                                                                | `packages/daemon/tests/services/reflection-refresh-service.test.ts`: stale-source and provider-configuration revalidation failures prevent publication.                                                                                   |
| Cancellation before terminal reservation can stop an attempt; reservation before `completeAttempt` makes a later cancellation return `false`, not a race.                | `packages/daemon/tests/services/reflection-refresh-service.test.ts`: `keeps a committed non-final publication when cancellation arrives after commit begins` and `keeps a committed result when cancellation arrives during publication`. |
| A stream observer is not an owner of the admitted daemon job.                                                                                                            | `packages/daemon/tests/services/reflection-refresh-service.test.ts`: `keeps an admitted job alive when its stream observer disconnects`.                                                                                                  |

## Decision

The structured submission tool has a typed acceptance callback. Reflection owns that callback:
it completes the evidence package, validates and resolves citations, reserves terminal
publication, revalidates current sources, and saves once before the tool reports success. The
Pi session records cumulative assistant usage at `message_end`, before tool execution, and
exposes that completed-turn snapshot to the callback. The source identity in each saved citation
mirrors the authoritative registry entry. Analyst retains its provider-return output path.

Before terminal reservation, cancellation and source/provider fences can prevent a save. Once
the reservation precedes `completeAttempt`, a later cancellation is rejected and observer,
transport, or cleanup failure cannot reclassify or erase the committed cache. Stream narration
and current UI controls remain observers of this daemon-owned completion, not publication gates.

The implementation removes the duplicate post-provider validator/save path and the
rejected-attempt poison state. Submission metadata is the authoritative completion entry. It
also removes the former arbitrary answer-policy gates; structural submission validation,
per-question abstention reasons, evidence lookup, and source revalidation remain enforced.

## Changed manifest

This simplification's implementation paths are
`packages/daemon/src/services/reflection-refresh-service.ts`,
`packages/daemon/src/services/reflection-result-validator.ts`,
`packages/daemon/src/services/grounded-analysis/structured-submission.ts`, and their directly
affected daemon tests. This note and `docs/usage.md` are the documentation changes for this
simplification. Other dirty paths shown by the repository-wide diff are pre-existing or outside
this documentation handoff and are not part of this manifest.

## Terminal acceptance

Terminal review was accepted with no material findings. The accepted implementation keeps
reflection completion tool-owned: `submit_grounded_analysis` invokes Reflection's typed
acceptance callback, which resolves registry-backed citations, reserves terminal publication,
revalidates source and provider fences, and saves exactly once. Pi records completed-turn
cumulative assistant usage before tool execution; narration and stream observers remain
non-owning. Analyst retains its provider-return completion path.

Validation evidence accepted at terminal review:

- full typecheck: `2976` passing, `1` skipped;
- prior focused validation: lint, formatting, browser typecheck, and isolated browser suite
  (`41` passing, `3` skipped).

No runtime change was made after terminal acceptance. The accepted working-tree/index manifest
is recorded externally at `/tmp/opencode/shelf-judge-reflection-tool-owned-completion-manifest-2026-09-12.txt`
after this final note and tracker update, so the snapshot does not hash itself.
