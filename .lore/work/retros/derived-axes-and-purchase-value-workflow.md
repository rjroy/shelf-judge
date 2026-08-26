---
title: Derived axes and purchase value workflow
date: 2026-08-25
status: open
tags: [workflow, specification, code-review, beads, subagents, validation]
modules: [shared, daemon, web, cli]
related:
  [
    .lore/work/specs/derived-bgg-axes.md,
    .lore/work/plans/derived-game-metadata-axes.md,
    .lore/work/notes/derived-game-metadata-axes.md,
    .lore/work/specs/collection-purchase-utilization.md,
  ]
---

# Derived Axes And Purchase Value Workflow

This record covers the OpenCode sessions from August 23 through August 25, 2026. The session transcripts came from the copied database at `tmp/opencode.db`. Beads records, lore artifacts, implementation notes, and git history supplied the corresponding project state.

## Derived Axes Plan

The derived-axes specification was followed by an implementation plan. The first plan review reported seven findings, including undefined numeric-tolerance math, incomplete prediction exclusion for disabled axes, no extensible cache invalidation mechanism, a variable-length feature-vector fallback, and incompatible profile scales. A second review reported eight remaining findings. A final review reported three findings, and a narrow verification then confirmed those three had been resolved.

The plan changed from a sequence of six dependent cutover steps to an independently closable additive foundation followed by one atomic runtime-cutover bead. Web and CLI work branched after the cutover. Cross-package regression and final validation followed both clients. This structure appears in the plan's dependency order and in beads `shelf-judge-2bb.5` through `shelf-judge-2bb.10`.

The planning session also created duplicate child beads for specification and planning work. Beads `shelf-judge-2bb.1`, `.2`, and `.3` were closed as completed duplicates or superseded by `shelf-judge-2bb.4`. Later in the same session, a dependency from the parent feature to its final child propagated through the hierarchy and blocked the foundation task. The dependency was removed because the child-to-child edges already represented execution order.

## Derived Axes Implementation

The runtime implementation used separate research, implementation, testing, review, correction, and validation subagents. Several of these sessions overlapped in time while working on the same implementation phase. For the shared registry foundation, implementation ran from 13:04 to 13:19, testing began at 13:11, and review began at 13:12. The same overlap occurred in later runtime phases. The implementation notes grew to 302 lines and recorded each review correction and gate result.

The web phase had 22 child-agent sessions. Seven had review in their titles, ten had fix, completion, or scoping work in their titles, and seven had test or validation work in their titles. The sequence included:

1. Initial implementation and validation.
2. A review that found disabled legacy ratings were submitted with unrelated rating saves, fractional effective ratings seeded invalid integer overrides, field errors and units were incomplete, and tests did not exercise production interactions.
3. A re-review that found veto repair could activate a preserved veto without confirmation, configuration summaries were missing, and unit labels remained incomplete.
4. A final review that found unit omissions, untested page-level workflows, incomplete override coverage, and inaccessible clickable spans.
5. A later acceptance review that reduced the findings to shared stale form errors.
6. A confirmation review that found resets did not protect against late asynchronous responses and raised the issue to a release-blocking error-state contamination defect.
7. A scoped request-generation fix and review with no release-blocking findings.
8. Chromium checks at mobile and desktop viewport sizes.

The disabled-rating submission and asynchronous response findings described user-visible failures. The former could prevent all rating saves in a collection with a disabled legacy axis. The latter could apply an old request's errors or success behavior to another form or to a reopened generation. Other rounds covered acceptance evidence, labels, units, and accessibility.

The main session called several rounds “final” before later reviews continued. After two correction rounds, it stated that it was stopping at an escalation boundary because the final review still found incomplete Step 7 coverage. The user then authorized one additional full correction cycle. That cycle continued through the stale-error and asynchronous-response findings before review returned no release-blocking findings.

## Final Validation

The final-validation bead ran the repository gates and audited requirements, help output, migration behavior, client workflows, and vector consumers. It found an unreachable CLI Play Time default, loss of the numeric override value in breakdowns, weak help coverage, and missing consumer evidence after all implementation beads had already passed their own review and tests.

The first final-validation handoff left the bead open because `format:check` reported 42 committed files that did not match Prettier. The owner directed the agent to fix them instead of treating the existing state as a blocker. The repository was formatted and the complete gates were rerun.

A subsequent review then required a recorded requirement-to-evidence map and a real-filesystem migration/reload test before lore statuses changed. Those checks were added. The final state recorded 1,531 passing tests, one skip, all repository gates passing, the plan marked `executed`, the spec marked `implemented`, and the feature and validation beads closed.

## Purchase Value Specification

The first purchase-utilization draft answered a narrower question than the owner intended. It retained cost per play, made modeled player-hour cost experimental, and rejected fitness-adjusted monetary value. Three review rounds made that draft increasingly precise and eventually returned no material findings.

In the following session, the owner said that the central goal was to determine whether a purchase had delivered good value, using fitness as part of that judgment. The spec was reset around an entertainment benchmark anchored at fitness 6 and a movie-ticket example. The formula became a comparison between purchase cost per modeled player-hour and `H * F / 6`.

The revised draft again received a detailed consistency review. Before the next correction completed, the owner stopped the process to discuss the writing style. The owner said the document was hard to follow and that its primary purpose was human verification, with agent implementation secondary. The agent answered that the personal writing guide requested plain language and had not caused the result. It described its own draft as optimized for exhaustive machine interpretation and structured like a legal contract.

The document was then rewritten rather than incrementally edited. The new order was goal, user-visible examples, benchmark explanation, visible behavior, important choices, special cases, requirements, and a Technical Contract. A reviewer was instructed to read only through the human-facing portion first and explain the feature, fitness-6 benchmark, and `$60` example before reading the contract. The reviewer reported that all three explanations were easy to derive.

The same review still found contradictory gift presentation, unexplained exact-versus-rounded classification, zero-play wording, fractional modeled attendance presentation, and legalistic requirements. These were corrected. The requirements stopped using repeated “shall” language, and implementation details remained in the later Technical Contract.

When value remaining, estimated additional plays, and collection sorting were added, the review sequence ran through five focused review or verification prompts. Each prompt narrowed to unresolved findings from the prior pass. The findings covered zero-play precedence, sorting scope, sub-minor-unit display, unreachable ordering, hidden sort precision, veto precedence, and agreement between human rules and the Technical Contract. The final narrow check reported no remaining high or medium contradiction.

The purchase-value work produced three closed child beads. The initial specification bead closed after the first draft. Two later beads captured the owner-directed product rewrite and the additional value-remaining outputs. Git history contains separate commits for the initial draft, modeled-value revision, and approved status.

## Beads And Session State

Beads preserved task status, dependencies, acceptance criteria, closed-task reasons, and two implementation decisions across sessions. New sessions could find the next ready task and recover the approved override semantics and formatting baseline through `bd prime`.

The workflow also produced tracker maintenance work during delivery. Planning created duplicate child beads before consolidating them. The parent-child dependency propagation briefly blocked all work. Passive JSONL exports could be stale relative to the Dolt database and were regenerated before commits. A commit hook regenerated the export after one commit, requiring a second commit for the closed-task state.

Several handoffs performed complete diff and tracker inspections after the user had already asked to commit completed work. During the web commit, the agent initially proposed excluding Beads configuration and a mixed issue export. The owner explicitly directed it to include the configuration and commit without another review of already completed work.
