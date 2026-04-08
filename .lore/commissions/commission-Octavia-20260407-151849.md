---
title: "Commission: Plan: Utility Curves Implementation"
date: 2026-04-07
status: completed
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Read `.lore/specs/utility-curves.md` and prepare an implementation plan at `.lore/plans/utility-curves.md`.\n\nUse `/lore-development:prep-plan` to build the plan. The spec is your primary input. Also read the project CLAUDE.md and relevant design docs (`.lore/designs/`) to understand the architecture and data model.\n\nThe plan should break the spec into ordered, commissionable phases that Dalton can execute. Each phase should be a coherent unit of work with clear inputs, outputs, and verification criteria."
dependencies: []
linked_artifacts:
  - .lore/plans/utility-curves.md

activity_timeline:
  - timestamp: 2026-04-07T22:18:49.083Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-07T22:18:49.085Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-07T22:18:49.106Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-07T22:18:54.969Z
    event: progress_report
    reason: "Reading the utility curves spec and relevant design docs to prepare the implementation plan."
  - timestamp: 2026-04-07T22:19:30.147Z
    event: progress_report
    reason: "Finished reading all relevant source files: types, validation, fitness service, axis service, routes, web UI, CLI. Now reading the game detail page and checking for existing plans to understand conventions before invoking prep-plan."
  - timestamp: 2026-04-07T22:20:00.937Z
    event: progress_report
    reason: "Context gathering complete. Read: utility-curves spec (28 requirements), data model design, fitness model design, shared types, validation schemas, fitness-service, axis-service, axis routes, score routes, web UI (axes page, game detail), CLI (axis + score commands), tournament-ranking plan (for format reference), and compendium entries on planning and commission prompts. Invoking prep-plan to draft the implementation plan."
  - timestamp: 2026-04-07T22:21:46.127Z
    event: progress_report
    reason: "Prior work search complete. Found: brainstorm Approach 4 (ancestor), deferred issue (resolved), spec review meeting notes, MVP fitness model design. No curve logic exists in code yet. Now drafting the implementation plan."
  - timestamp: 2026-04-07T22:26:24.089Z
    event: progress_report
    reason: "Plan drafted and saved to .lore/plans/utility-curves.md. 7 phases, 28 requirements mapped, 6 suggested commissions. Running fresh-eyes plan review."
  - timestamp: 2026-04-07T22:29:00.050Z
    event: progress_report
    reason: "Plan review complete. 1 CRITICAL finding (short-circuit contradiction in Phase 3), 3 WARNs, 4 NOTEs. Addressing the critical finding and top-priority improvements now."
  - timestamp: 2026-04-07T22:31:31.269Z
    event: result_submitted
    reason: "Implementation plan created at `.lore/plans/utility-curves.md` (617 lines, draft status).\n\n**Structure**: 7 phases covering all 28 REQ-CURVE requirements, with requirement-to-phase traceability matrix.\n\n**Phases**:\n1. Shared types and validation (extend Axis with curve config, expand FitnessBreakdownEntry/FitnessResult)\n2. Curve engine (pure math module following elo-engine.ts pattern, power-curve with per-side exponent for sweet spot, tolerance calibration from spec anchors)\n3. Fitness service integration (replace resolveBggRating with raw native-scale values + curve transform, veto handling with hypothetical scores)\n4. API and service layer (axis create/update accept curve config, cross-field validation)\n5. Web UI (shape selector, sweet spot controls with live curve preview via client-side math in curve-math.ts, veto config with confirmation, expanded breakdown, vetoed game display)\n6. CLI (new flags for curve config, expanded breakdown formatting, veto display)\n7. Integration verification (full test suite, spec compliance review by Thorne)\n\n**Technical decisions**: 6 documented (power curve math, tolerance calibration, native scale as derived not stored, veto on FitnessResult, curve config as optional Axis fields, bggOriginal semantics change).\n\n**Suggested commission cadence**: 6 commissions (Phase 1+2 bundled, Phase 3 alone, Phase 4 alone, Phase 5 alone, Phase 6 parallel with 5, Phase 7 as review).\n\n**Fresh-eyes review**: Plan-reviewer found 1 CRITICAL (Phase 3 short-circuit contradiction, fixed), 3 WARNs (collection table veto display, score-breakdown broken rendering, veto confirmation testing), 4 NOTEs. All priority items addressed in the plan."
  - timestamp: 2026-04-07T22:31:34.955Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Plan review complete. 1 CRITICAL finding (short-circuit contradiction in Phase 3), 3 WARNs, 4 NOTEs. Addressing the critical finding and top-priority improvements now."
projectName: shelf-judge
---
Implementation plan created at `.lore/plans/utility-curves.md` (617 lines, draft status).

**Structure**: 7 phases covering all 28 REQ-CURVE requirements, with requirement-to-phase traceability matrix.

**Phases**:
1. Shared types and validation (extend Axis with curve config, expand FitnessBreakdownEntry/FitnessResult)
2. Curve engine (pure math module following elo-engine.ts pattern, power-curve with per-side exponent for sweet spot, tolerance calibration from spec anchors)
3. Fitness service integration (replace resolveBggRating with raw native-scale values + curve transform, veto handling with hypothetical scores)
4. API and service layer (axis create/update accept curve config, cross-field validation)
5. Web UI (shape selector, sweet spot controls with live curve preview via client-side math in curve-math.ts, veto config with confirmation, expanded breakdown, vetoed game display)
6. CLI (new flags for curve config, expanded breakdown formatting, veto display)
7. Integration verification (full test suite, spec compliance review by Thorne)

**Technical decisions**: 6 documented (power curve math, tolerance calibration, native scale as derived not stored, veto on FitnessResult, curve config as optional Axis fields, bggOriginal semantics change).

**Suggested commission cadence**: 6 commissions (Phase 1+2 bundled, Phase 3 alone, Phase 4 alone, Phase 5 alone, Phase 6 parallel with 5, Phase 7 as review).

**Fresh-eyes review**: Plan-reviewer found 1 CRITICAL (Phase 3 short-circuit contradiction, fixed), 3 WARNs (collection table veto display, score-breakdown broken rendering, veto confirmation testing), 4 NOTEs. All priority items addressed in the plan.
