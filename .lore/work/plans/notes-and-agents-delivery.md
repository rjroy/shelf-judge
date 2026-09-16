---
title: "Lean delivery: notes, reflections, and analyst chat"
date: 2026-09-07
status: executed
tags: [plan, notes, reflections, analyst, delivery]
related:
  - .lore/work/specs/grounded-profile-reflections.md
  - .lore/work/plans/grounded-profile-reflections.md
  - .lore/work/specs/collection-analyst-chat.md
  - .lore/work/plans/collection-analyst-chat.md
---

# Lean delivery: notes, reflections, and analyst chat

## Goal and non-goals

Deliver owner-inspectable Reflection output and a usable read-only Analyst web
conversation. The owner starts Reflection work only by clicking **Refresh
reflections**. There is no scheduler, background trigger, proactive analysis,
or new agent subsystem.

Existing Reflection cards are sufficient. Do not add an inspectability framework,
evaluation packet, authorship/run schema, mandatory corpus, blinded review, or
usefulness rubric. The owner judges usefulness and may reject output; that is an
input to the next bounded fix, not a release gate.

## Delivery record

- Owner Game Notes, Grounded Profile Reflections, and Collection Analyst Chat
  completed their recorded final technical validations. The delivery order below
  is retained as historical planning evidence, not an open implementation queue.
- The shared daemon-owned pi-agent boundary, Reflection output, and Analyst web
  conversation were delivered. Later CLI-parity and final-validation items in
  the original sequence are closed, not deferred work.
- The binding current contracts are the relevant `.lore/reference/` material and
  delivered code. Do not rebuild delivered layers without a concrete defect.

## Ordered delivery

| Order | Existing issue                            | User-visible finish                                                                                                                 | Technical acceptance and scope boundary                                                                                                                                                                                                                                                                                                  |
| ----- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `shelf-judge-6wv.13`                      | In Optional reflections, the owner clicks Refresh and sees a cited answer, honest abstention, or explicit unavailable/failed state. | Use the configured provider through the existing UI. Success is a real provider attempt plus inspectable answered or abstained result. Configuration/provider failure records the concrete blocker and does not close the issue. Do not render raw rejected output. Capture local run instructions and status only, never private notes. |
| 2     | `shelf-judge-3p5.7`                       | No standalone screen, but the real analyst turn can obtain authorized evidence and return validated structured output.              | Narrowly extend shared `provider.ts` and the session factory for Analyst manifest-authorized read-only retrieval tools plus submission. Real-library retrieval-to-result test proves it; Reflection remains submission-only and extra tools/hooks fail closed. No new provider stack or persistent history.                              |
| 3     | `shelf-judge-3p5.8`                       | The daemon exposes configured Analyst turn, progress, cancellation, and citations.                                                  | Wire routes, composition, operations, configuration, and structured streaming. Preserve cancellation, privacy, citation, schema, and action-authority checks.                                                                                                                                                                            |
| 4     | `shelf-judge-3p5.12`                      | The owner can ask a first question and follow up in `/analyst`, see progress/citations, stop, retry, or start a new conversation.   | Use existing web stream contracts and ephemeral state. A configured-provider web smoke plus offline fixture/browser tests demonstrate the first usable web milestone. It does not wait for Reflection epic closure or CLI.                                                                                                               |
| later | `shelf-judge-3p5.9`, `.3p5.11`, `.6wv.14` | CLI parity and complete technical closure.                                                                                          | CLI remains approved backlog, not a prerequisite for the first web demo. Final tasks retain deterministic safety, privacy, cancellation, citation, schema, and accessibility evidence, not usefulness scoring.                                                                                                                           |

## Historical dependencies and next action

The dependency order was completed. `shelf-judge-3p5.10` remains retired and
creates no implementation or validation dependency.

No delivery action remains. Follow the current contracts and validation records
when repairing a concrete defect. Low usefulness was never a delivery failure.

## Iteration rule

Keep deterministic safety: closed evidence/schema validation, citation identity,
read-only authority, provider disclosure/privacy, capability isolation, and
cancellation. If a real run reveals a specific defect, create or update one
bounded defect item then fix that defect. Do not create speculative quality work
or treat all invalid model text as automatically safe to display.

## After delivery

- `shelf-judge-lwl` removed retired evaluation tooling after both final
  validations.
- `shelf-judge-u3g` simplified proven redundant delivered-flow layers after both
  final validations.
- `shelf-judge-f7o` is the documentation reconciliation handoff. It must retain
  archival evidence only when clearly labeled historical and must not restore
  usefulness scoring, corpus quotas, or review gates.
