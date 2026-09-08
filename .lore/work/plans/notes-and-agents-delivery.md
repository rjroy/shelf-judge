---
title: "Lean delivery: notes, reflections, and analyst chat"
date: 2026-09-07
status: draft
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

## Current facts

- Owner Game Notes is delivered: all 14 children are closed and `.1d4.14`
  records accepted final validation. Closing its epic is administrative rollup,
  not a new runtime claim.
- Reflection has 12 of 14 children complete. `.6wv.13` is the visible-output
  milestone; `.6wv.14` is later technical closure and must not hide output.
- Analyst contracts, non-note projections, ephemeral conversations, note
  evidence, and the shared provider foundation are closed. Do not rebuild them
  without a concrete defect.

## Ordered delivery

| Order | Existing issue                            | User-visible finish                                                                                                                 | Technical acceptance and scope boundary                                                                                                                                                                                                                                                                                                  |
| ----- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `shelf-judge-6wv.13`                      | In Optional reflections, the owner clicks Refresh and sees a cited answer, honest abstention, or explicit unavailable/failed state. | Use the configured provider through the existing UI. Success is a real provider attempt plus inspectable answered or abstained result. Configuration/provider failure records the concrete blocker and does not close the issue. Do not render raw rejected output. Capture local run instructions and status only, never private notes. |
| 2     | `shelf-judge-3p5.7`                       | No standalone screen, but the real analyst turn can obtain authorized evidence and return validated structured output.              | Narrowly extend shared `provider.ts` and the session factory for Analyst manifest-authorized read-only retrieval tools plus submission. Real-library retrieval-to-result test proves it; Reflection remains submission-only and extra tools/hooks fail closed. No new provider stack or persistent history.                              |
| 3     | `shelf-judge-3p5.8`                       | The daemon exposes configured Analyst turn, progress, cancellation, and citations.                                                  | Wire routes, composition, operations, configuration, and structured streaming. Preserve cancellation, privacy, citation, schema, and action-authority checks.                                                                                                                                                                            |
| 4     | `shelf-judge-3p5.12`                      | The owner can ask a first question and follow up in `/analyst`, see progress/citations, stop, retry, or start a new conversation.   | Use existing web stream contracts and ephemeral state. A configured-provider web smoke plus offline fixture/browser tests demonstrate the first usable web milestone. It does not wait for Reflection epic closure or CLI.                                                                                                               |
| later | `shelf-judge-3p5.9`, `.3p5.11`, `.6wv.14` | CLI parity and complete technical closure.                                                                                          | CLI remains approved backlog, not a prerequisite for the first web demo. Final tasks retain deterministic safety, privacy, cancellation, citation, schema, and accessibility evidence, not usefulness scoring.                                                                                                                           |

## Dependencies and next action

`.6wv.13` and `.3p5.7` are ready in parallel. `.3p5.8` follows `.3p5.7`;
`.3p5.12` follows `.3p5.8`. `.3p5.9` remains after `.3p5.8`; `.3p5.11` remains
full-scope technical closure after its factual implementation dependencies.
The obsolete `.3p5.10` evaluation corpus is retired and no longer blocks `.11`.

Next: run the existing Optional reflections UI against an operator-configured
provider. If unavailable, record the exact non-secret configuration/provider
blocker and leave `.6wv.13` open. Low usefulness is still a delivered result.

## Iteration rule

Keep deterministic safety: closed evidence/schema validation, citation identity,
read-only authority, provider disclosure/privacy, capability isolation, and
cancellation. If a real run reveals a specific defect, create or update one
bounded defect item then fix that defect. Do not create speculative quality work
or treat all invalid model text as automatically safe to display.

## After delivery

- `shelf-judge-lwl`: remove retired evaluation tooling after both final validations.
- `shelf-judge-u3g`: simplify only proven redundant delivered-flow layers after both final validations.
- `shelf-judge-f7o`: reconcile cleanup-era docs and links after those cleanups.
