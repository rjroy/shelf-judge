---
title: "Commission: Restructure MVP spec: separate design from requirements"
date: 2026-04-05
status: dispatched
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "The MVP spec at `.lore/specs/mvp.md` has a structural problem: it's light on requirements and heavy on design. The design content is good, but it needs to be separated from the spec so the spec stands on its own as a requirements document.\n\n**Task: Two-part restructuring.**\n\n### Part 1: Extract design content to `.lore/designs/`\n\nMove the following sections out of the spec and into design documents under `.lore/designs/`:\n\n- **Data Model** (Game, BggGameData, Axis, Collection, Storage Format) → `.lore/designs/mvp-data-model.md`\n- **Fitness Score Model** (the math, score breakdown interface, example) → `.lore/designs/mvp-fitness-model.md`\n- **BGG Integration** (token, endpoints, rate limiting, caching, XML parsing, library decision) → `.lore/designs/mvp-bgg-integration.md`\n- **API Surface** (operations tables, request/response shapes, service layer) → `.lore/designs/mvp-api-surface.md`\n- **Web UI** (screens, navigation) → `.lore/designs/mvp-web-ui.md`\n- **CLI Surface** (binary, commands, output, daemon management) → `.lore/designs/mvp-cli.md`\n\nEach design doc should reference the spec requirements it satisfies, and link back to the spec. Use appropriate frontmatter.\n\n### Part 2: Beef up the spec requirements\n\nThe current requirements are 7 one-line bullets. That's not enough to serve as a contract. Expand them so the spec stands on its own without the design documents. A developer reading only the spec should understand what the system must do, even if they haven't read the designs.\n\nRequirements to add or expand (these are currently buried in design sections as implicit decisions):\n\n- **Behavioral requirements:** What happens when BGG token is missing? When a game has zero rated axes? When the user deletes an axis that has ratings? When BGG returns an error during import? When a duplicate game is imported?\n- **Validation and boundaries:** Rating scale bounds and enforcement. Weight range and what happens at edges (all weights zero, single axis).\n- **Resilience:** System must function without BGG connectivity (manual game entry, personal axes only). BGG failures must not crash the daemon.\n- **Score transparency:** Every displayed score must include its full breakdown. This is a hard requirement from the vision (Principle 2), not a design choice.\n- **Data freshness:** BGG cache behavior as a requirement (data must be refreshable, stale data is acceptable).\n\nLoad your `specify` skill first to ensure the expanded requirements follow the standard format. Keep the deferred list, constraints, open questions, success criteria, exit points, and context sections. The spec should reference the design documents in its Context section.\n\nThe goal: the spec is the contract, the designs are the proposed implementation. A different designer could satisfy the same spec with different designs."
dependencies: []
linked_artifacts: []

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
current_progress: ""
projectName: shelf-judge
---
