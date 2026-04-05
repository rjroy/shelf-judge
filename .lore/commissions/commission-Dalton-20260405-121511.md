---
title: "Commission: Phase 1: Project Scaffolding and Data Model"
date: 2026-04-05
status: dispatched
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phase 1 of the MVP plan at `.lore/plans/mvp.md`.\n\nRead the full plan first, then focus on Phase 1: \"Project Scaffolding and Data Model.\" Also read the referenced design documents:\n- `.lore/designs/mvp-data-model.md`\n- `.lore/designs/mvp-fitness-model.md` (for FitnessResult/FitnessBreakdownEntry types)\n- `.lore/reference/architecture-pattern.md`\n- `.lore/specs/mvp.md` (for requirements REQ-MVP-20, REQ-MVP-21)\n\nPhase 1 has three steps:\n\n**1.1 Project scaffolding** — Create the monorepo workspace structure (root, packages/shared, packages/daemon, packages/web placeholder, packages/cli placeholder). Configure TypeScript strict mode, ESLint flat config with typescript-eslint, Prettier, .gitignore. Install dependencies per the plan.\n\n**1.2 Shared types and validation** — Define core types in `packages/shared/src/types.ts` matching the data model design exactly. Create Zod schemas in `packages/shared/src/validation.ts`. Barrel export from `packages/shared/src/index.ts`. Write validation tests.\n\n**1.3 Storage service** — Implement `StorageService` with DI factory pattern in `packages/daemon/src/services/storage-service.ts`. Implement `fileOps` abstraction. Create mock fileOps for testing. Write all tests listed in the plan (load, save, atomic write, round-trip, malformed JSON).\n\nVerification criteria:\n- `bun install` succeeds\n- `bun test` passes all tests\n- Types importable from `@shelf-judge/shared`\n- Storage atomic write verified via mock fileOps call sequence\n- Default collection includes two BGG-derived axes (Community Rating, Complexity) per REQ-MVP-3\n\nFollow the technical decisions in the plan (sections 1-9). Do not deviate from the project structure defined in the plan."
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-05T19:15:11.721Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-05T19:17:59.189Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
