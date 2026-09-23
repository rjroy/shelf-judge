---
title: Expanded Profile attention rollback record
date: 2026-09-20
status: complete
bead: shelf-judge-1l7.4
---

# Expanded Profile attention rollback record

The user rejected the governance-oriented design. This completed work records the rollback and simplification.

## Remove

- The discarded multi-source evidence design (the deleted design document), `accepted-play-sources.ts`, and its validation and migration tests.
- Version 8 collection migration work and Profile/cache version changes in `collection-profile-validation.ts`, `validation.ts`, and related fixtures. Restore schema/Profile contract versions 7/9 and advance the Profile algorithm to 12 so version-11 caches are discarded.
- Durable feedback events, reasons, history, commands, routes, CLI, UI, and the associated shared/daemon tests.
- Rating, goal, suppression, AI/provider, provenance, and other new state or policy work.

## New boundary

Reuse the existing current Profile play-count projection. For a currently owned active `want-to-play` intention, valid current count exactly zero selects the specific unplayed question. Every other active intention, including historical `first-play` and `replay`, keeps the generic question. This is one daemon-owned, read-only presentation choice per existing intention; identity, actions, lifecycle, completion, warnings, ordering, and history remain unchanged.

## Completed rollback and simplification

- Removed the rejected accepted-source, feedback, and attention-evidence modules, V8 schema/migration, related durable fields, exports, validation, deletion behavior, and dedicated rejected tests.
- Restored Collection/Profile contracts to schema 7, contract 9, and algorithm 12. The algorithm version invalidates version-11 cached generic cards.
- The existing Profile engine now chooses `unplayed-owner-wanted` only for owned active `want-to-play` intentions with valid current play evidence exactly zero. It keeps all other cards generic and preserves existing evidence warnings, identity, actions, ordering, and read-only behavior.
- Added focused Profile-engine coverage for zero/nonzero/missing/invalid/stale evidence, first-play/replay fallback, one card per intention, stable IDs/actions, schema validity, and no mutation.

## Validation

- Focused tests: 92 passed: `bun test packages/shared/tests/useful-profile-contract.test.ts packages/daemon/tests/collection-profile-engine.test.ts packages/daemon/tests/profile-service.test.ts`.
- Full suite: 3,006 passed, 1 skipped: `bun test`.
- `bun run typecheck`, `bun run lint`, and `bun run build` passed.
- Changed-file `prettier --check` and `git diff --check` passed.
