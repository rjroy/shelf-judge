---
title: Model-directed evidence tool flow
date: 2026-09-11
status: complete
source: shelf-judge-rcr
modules: [daemon, grounded-analysis, collection-analyst, profile-reflections]
---

# Model-directed evidence tool flow

## Shared provider loop

Analyst and explicit Reflection refreshes register the exact four read-only
collection tools (`top`, `grep`, `readGames`, and `summarize`) together with
`submit_grounded_analysis`. The grounded provider binds the pi session,
activates only the feature manifest, and sends the model request. A model tool
request executes the feature-owned evidence handler; its bounded serialized
result becomes a tool-result message in the next provider request. The model
then completes only through the structured submission tool. Free-form terminal
text and missing or invalid submissions fail closed.

Analyst and Reflection both use `createCollectionTools` for tool schemas,
argument validation, cancellation, serialization, and the 64 KiB response and
192 KiB turn budgets. Feature adapters inject snapshot fingerprints and retain
their authorization and privacy differences: Analyst emits audit diagnostics
and removes snapshot fingerprints, while Reflection also removes note
dependencies and canonical summaries. Analyst captures a turn snapshot before
tool registration and revalidates its citation registry after submission.
Reflection has one model-directed refresh path: it starts an evidence turn,
uses the four tools, finishes that turn after model work, validates against the
returned evidence package, then revalidates before cache publication. The
obsolete retrieval-only Analyst manifest and Reflection submission-only path
were removed.

## Passive-read boundary

`GET /api/profile` remains metadata-only. `GET /api/profile/reflections` loads
deterministic reflection state but does not start a model session or read owner
notes. Reflection provider work occurs only during an explicit refresh.
Owner-note access occurs only when the model selects note-backed evidence
through `readGames`.

## Verification

The deterministic local Ollama HTTP/SSE tests use the production pi session
factory and extension without module mocks. The Analyst entry-point test invokes
`createAnalystTurnService`; the model requests its real `readGames` handler and
the next network request must contain its server-issued citation before the
model's citation-valid structured submission is accepted by Analyst validation.
The Reflection entry-point test invokes the explicit refresh route with the
real provider; it requests the real `top` handler, derives a citation from the
returned result in the next request, and accepts and persists the validated
structured Reflection output. The separate Profile regression continues to
prove that passive reads do not invoke the provider or owner-note service.
