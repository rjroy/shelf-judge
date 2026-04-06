---
title: "Commission: Restructure MVP spec: separate design from requirements"
date: 2026-04-05
status: completed
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "The MVP spec at `.lore/specs/mvp.md` has a structural problem: it's light on requirements and heavy on design. The design content is good, but it needs to be separated from the spec so the spec stands on its own as a requirements document.\n\n**Task: Two-part restructuring.**\n\n### Part 1: Extract design content to `.lore/designs/`\n\nMove the following sections out of the spec and into design documents under `.lore/designs/`:\n\n- **Data Model** (Game, BggGameData, Axis, Collection, Storage Format) → `.lore/designs/mvp-data-model.md`\n- **Fitness Score Model** (the math, score breakdown interface, example) → `.lore/designs/mvp-fitness-model.md`\n- **BGG Integration** (token, endpoints, rate limiting, caching, XML parsing, library decision) → `.lore/designs/mvp-bgg-integration.md`\n- **API Surface** (operations tables, request/response shapes, service layer) → `.lore/designs/mvp-api-surface.md`\n- **Web UI** (screens, navigation) → `.lore/designs/mvp-web-ui.md`\n- **CLI Surface** (binary, commands, output, daemon management) → `.lore/designs/mvp-cli.md`\n\nEach design doc should reference the spec requirements it satisfies, and link back to the spec. Use appropriate frontmatter.\n\n### Part 2: Beef up the spec requirements\n\nThe current requirements are 7 one-line bullets. That's not enough to serve as a contract. Expand them so the spec stands on its own without the design documents. A developer reading only the spec should understand what the system must do, even if they haven't read the designs.\n\nRequirements to add or expand (these are currently buried in design sections as implicit decisions):\n\n- **Behavioral requirements:** What happens when BGG token is missing? When a game has zero rated axes? When the user deletes an axis that has ratings? When BGG returns an error during import? When a duplicate game is imported?\n- **Validation and boundaries:** Rating scale bounds and enforcement. Weight range and what happens at edges (all weights zero, single axis).\n- **Resilience:** System must function without BGG connectivity (manual game entry, personal axes only). BGG failures must not crash the daemon.\n- **Score transparency:** Every displayed score must include its full breakdown. This is a hard requirement from the vision (Principle 2), not a design choice.\n- **Data freshness:** BGG cache behavior as a requirement (data must be refreshable, stale data is acceptable).\n\nLoad your `specify` skill first to ensure the expanded requirements follow the standard format. Keep the deferred list, constraints, open questions, success criteria, exit points, and context sections. The spec should reference the design documents in its Context section.\n\nThe goal: the spec is the contract, the designs are the proposed implementation. A different designer could satisfy the same spec with different designs."
dependencies: []
linked_artifacts:
  - .lore/specs/mvp.md

  - .lore/designs/mvp-data-model.md
  - .lore/designs/mvp-fitness-model.md
  - .lore/designs/mvp-bgg-integration.md
  - .lore/designs/mvp-api-surface.md
  - .lore/designs/mvp-web-ui.md
  - .lore/designs/mvp-cli.md
  - .lore/designs/mvp-data-model.md
  - .lore/designs/mvp-fitness-model.md
  - .lore/designs/mvp-bgg-integration.md
  - .lore/designs/mvp-api-surface.md
  - .lore/designs/mvp-web-ui.md
  - .lore/designs/mvp-cli.md
resource_overrides:
  model: opus

activity_timeline:
  - timestamp: 2026-04-05T01:49:30.703Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-05T01:49:30.705Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-05T01:49:30.717Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-05T01:49:36.919Z
    event: progress_report
    reason: "Starting commission: reading the MVP spec and checking existing lore structure before restructuring."
  - timestamp: 2026-04-05T01:50:11.403Z
    event: progress_report
    reason: "Created .lore/designs/ directory. Now writing the 6 design documents extracted from the spec, then the revised spec with expanded requirements."
  - timestamp: 2026-04-05T01:52:14.817Z
    event: progress_report
    reason: "All 6 design documents created. Now writing the restructured spec with expanded requirements (Part 2 of the commission)."
  - timestamp: 2026-04-05T01:53:49.717Z
    event: progress_report
    reason: "Spec and all 6 design documents written. Running fresh-eyes review on the restructured spec."
  - timestamp: 2026-04-05T01:56:39.005Z
    event: result_submitted
    reason: "Restructured the MVP spec into a proper requirements document with extracted design documents.\n\n**Part 1: Design extraction.** Created 6 design documents under `.lore/designs/`:\n- `mvp-data-model.md` (Game, BggGameData, Axis, Collection, Storage Format)\n- `mvp-fitness-model.md` (weighted average algorithm, score breakdown interface, Wingspan example)\n- `mvp-bgg-integration.md` (endpoints, rate limiting, caching, XML parsing, library decision)\n- `mvp-api-surface.md` (operations tables, request/response shapes, service layer)\n- `mvp-web-ui.md` (5 screens, navigation)\n- `mvp-cli.md` (commands, output format, daemon management)\n\nEach design doc has proper frontmatter, links back to the spec, and lists which requirements it satisfies.\n\n**Part 2: Spec requirements expansion.** Grew from 7 one-line bullets to 24 detailed requirements organized into 7 sections: Axes and Weights (3), Fitness Scoring (3), Game Management (3), BGG Integration (4), Score Behavior and Edge Cases (4), Data Freshness (2), Persistence (2), Interface (3). New requirements cover:\n- Behavioral edge cases: zero-rated games, all-zero weights, axis deletion cascade, duplicate detection\n- Validation: rating scale enforcement (1-10 integer), weight range (0-100)\n- Resilience: system functions without BGG (REQ-MVP-11), BGG failures don't crash daemon (REQ-MVP-13)\n- Score transparency: breakdown is mandatory on every displayed score (REQ-MVP-5, hardened from vision Principle 2)\n- Data freshness: cache TTL, manual refresh behavior, override preservation (REQ-MVP-18/19)\n- Atomic writes: crash safety for storage (REQ-MVP-21)\n\n**Post-review fixes.** Fresh-context spec reviewer caught 3 issues, all addressed:\n1. Fixed Wingspan math error in fitness model design (header said 7.65, math yields 7.87, now says 7.9)\n2. Promoted Open Question 3 (import conflict resolution) into REQ-MVP-10 since the answer was already decided\n3. Clarified REQ-MVP-19 to explicitly state that refresh re-derives non-overridden BGG axis ratings\nAlso fixed Satisfies attribution across design docs and resolved weight-range tension (0-100, not 1-100)."
  - timestamp: 2026-04-05T01:56:43.626Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Spec and all 6 design documents written. Running fresh-eyes review on the restructured spec."
projectName: shelf-judge
---

Restructured the MVP spec into a proper requirements document with extracted design documents.

**Part 1: Design extraction.** Created 6 design documents under `.lore/designs/`:

- `mvp-data-model.md` (Game, BggGameData, Axis, Collection, Storage Format)
- `mvp-fitness-model.md` (weighted average algorithm, score breakdown interface, Wingspan example)
- `mvp-bgg-integration.md` (endpoints, rate limiting, caching, XML parsing, library decision)
- `mvp-api-surface.md` (operations tables, request/response shapes, service layer)
- `mvp-web-ui.md` (5 screens, navigation)
- `mvp-cli.md` (commands, output format, daemon management)

Each design doc has proper frontmatter, links back to the spec, and lists which requirements it satisfies.

**Part 2: Spec requirements expansion.** Grew from 7 one-line bullets to 24 detailed requirements organized into 7 sections: Axes and Weights (3), Fitness Scoring (3), Game Management (3), BGG Integration (4), Score Behavior and Edge Cases (4), Data Freshness (2), Persistence (2), Interface (3). New requirements cover:

- Behavioral edge cases: zero-rated games, all-zero weights, axis deletion cascade, duplicate detection
- Validation: rating scale enforcement (1-10 integer), weight range (0-100)
- Resilience: system functions without BGG (REQ-MVP-11), BGG failures don't crash daemon (REQ-MVP-13)
- Score transparency: breakdown is mandatory on every displayed score (REQ-MVP-5, hardened from vision Principle 2)
- Data freshness: cache TTL, manual refresh behavior, override preservation (REQ-MVP-18/19)
- Atomic writes: crash safety for storage (REQ-MVP-21)

**Post-review fixes.** Fresh-context spec reviewer caught 3 issues, all addressed:

1. Fixed Wingspan math error in fitness model design (header said 7.65, math yields 7.87, now says 7.9)
2. Promoted Open Question 3 (import conflict resolution) into REQ-MVP-10 since the answer was already decided
3. Clarified REQ-MVP-19 to explicitly state that refresh re-derives non-overridden BGG axis ratings
   Also fixed Satisfies attribution across design docs and resolved weight-range tension (0-100, not 1-100).
