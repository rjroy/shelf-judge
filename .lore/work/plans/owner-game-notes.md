---
title: "Implementation plan: owner game notes"
date: 2026-08-30
status: approved
tags: [plan, collection, game-detail, notes, privacy, concurrency]
modules: [shared, daemon, cli, web]
related:
  - .lore/work/specs/owner-game-notes.md
  - .lore/work/specs/useful-collection-profile.md
  - .lore/work/specs/grounded-profile-reflections.md
  - .lore/work/specs/collection-analyst-chat.md
  - .lore/work/design/manual-game-value-edit-lifecycle.md
  - .lore/work/specs/game-view-next-previous-navigation.md
---

# Implementation plan: owner game notes

## Goal

Implement the approved Owner Game Notes contract in `.lore/work/specs/owner-game-notes.md`: one durable, current-state-only, owner-authored plain-text note per game, with explicit web and CLI editing, note-local optimistic concurrency, and durable command replay. Notes remain local source data and do not become ratings, intentions, profile claims, generated content, or implicit model evidence.

This plan advances `collection.json` from schema version 5 to 6, separates durable games from note-free public projections, extends the global command-receipt namespace without retaining superseded note text, and preserves current Collection and Profile behavior. Plan approval and implementation remain separate decisions.

## Current system boundaries

- `packages/shared/src/types.ts` and `validation.ts` define schema version 5. `Game` currently serves both durable storage and public APIs, while `Collection.commandReceipts` accepts only `IntentionCommandReceipt`.
- `packages/daemon/src/services/collection-migration.ts` ends at `4 -> 5`. `storage-service.ts` recognizes versions 3 through 5 and atomically migrates `collection.json` before route startup.
- `packages/daemon/src/services/collection-mutation-service.ts` serializes collection mutations and advances revision only when a decision reports `changed: true`. A valid `already-clear` note command must therefore be a persisted change even though game and note state stay unchanged.
- `packages/daemon/src/services/intention-service.ts` assumes every command receipt contains intention request and result fields. `collection-profile-validation.ts` centralizes command-ID uniqueness and receipt-to-game validation.
- `packages/daemon/src/routes/games.ts` returns durable game objects through list, detail, add, and unrelated mutation responses. Its `toPublicGameWithScore` helper currently does not remove durable fields. Prediction, Tournament, and Profile also consume game-bearing values.
- `packages/daemon/src/services/game-service.ts` has two durable game constructors, manual/add and BGG import. Permanent deletion removes the game but does not yet filter another receipt family.
- The CLI has nested game command parsing, daemon-discovered help, runtime-structured errors, and a process-level lost-response precedent for intentions. Passing note text with `--text` can expose it through shell history and process arguments; the approved first release accepts that limitation and excludes stdin, files, and editors.
- The game-detail page already composes client mutation controls, ownership deletion, preserved navigation context, reducer-driven stale response protection, and responsive browser gates. The web daemon proxy already forwards GET, PUT, and DELETE.
- `docs/usage.md` documents migration and complete-data-directory recovery. Playwright is configured for Chromium at `375x812`, `768x1024`, `1440x900`, and a 200% desktop layout.

## Decisions made concrete for implementation

- Keep `Game` note-free as the common public and computation shape. Add `DurableGame extends Game` with `ownerNote`, use `DurableGame[]` in `Collection`, and add a `GameDetailGame` projection that deliberately includes the complete note. Runtime projection must physically omit `ownerNote`; TypeScript assignability is not a privacy boundary.
- Freeze independent version-5 schemas before activating strict version-6 aliases. Version 6 adds an honest `missing` note to every durable game and preserves all other validated fields.
- Preserve the current `IntentionCommandReceipt` representation. Add a structurally distinct, discriminated `OwnerGameNoteCommandReceipt` and a `CommandReceipt` union. This avoids rewriting intention receipts while preserving one global command-ID namespace.
- Store a lowercase SHA-256 fingerprint over a domain-separated canonical note command containing operation, route-owned game ID, expected version, and LF-normalized text for set. Store only text-free accepted metadata. Replays reconstruct `replayed: true` from the retried request and receipt.
- Add dedicated `GET`, `PUT`, and `DELETE` note routes below `/api/games/:id/note`, backed by stable operations `shelf.game.note.get`, `.set`, and `.clear`. Route identity owns the game ID; strict request bodies reject a supplied ID.
- Use the shared collection mutation coordinator for reads and mutations. New valid set and clear commands, including `already-clear`, persist one receipt and advance collection revision exactly once. Replays, stale commands, validation failures, overflow, and persistence failures do not write.
- Introduce one daemon projection module used by every game-bearing route and by Profile source capture. Broad outputs remain note-free; only game detail and dedicated note reads expose the complete note; mutation results expose metadata without text.
- Add a narrow note-mutation/deletion invalidation seam for future durable note-derived artifacts. The initial implementation registers no note-derived artifact and must not implement reflections, analyst chat, search, embeddings, prompts, providers, or model calls.
- Add the Owner note editor to the existing game-detail composition rather than replacing its navigation/client boundary. Keep authoritative baseline, draft, conflict state, and retry command identity separate.
- Use existing semantic colors and native controls. Every dirty, pending, success, error, and conflict state also has text and appropriate live-region behavior.

## Step 1: Define note, receipt, and projection contracts additively

**Files:**

- `packages/shared/src/types.ts`
- `packages/shared/src/validation.ts`
- New `packages/shared/src/owner-game-note.ts`
- `packages/shared/src/collection-profile-validation.ts`
- `packages/shared/src/index.ts`
- New `packages/shared/tests/owner-game-note.test.ts`
- New `packages/shared/tests/fixtures/owner-game-note-mutation.ts`
- `packages/shared/tests/validation.test.ts`
- `packages/shared/tests/useful-profile-contract.test.ts`
- `packages/shared/tests/current-axis-validation.test.ts`
- Other typed shared fixtures that embed current collections

**Changes:**

1. Add strict `missing`, `present`, and `cleared` note unions; note-free `Game`; `DurableGame`; `GameDetailGame`; dedicated read, set, clear, accepted-metadata, response, error, and receipt contracts.
2. Implement LF normalization, Unicode code-point counting, plain-text validation, and canonical request construction under the pinned ECMAScript runtime. Preserve every accepted code point except line-ending normalization; do not trim or normalize Unicode.
3. Freeze `CollectionGameV5Schema` and `CollectionSchemaV5`. Define future v6 durable schemas without activating current aliases until Step 3.
4. Add `CommandReceipt = IntentionCommandReceipt | OwnerGameNoteCommandReceipt`. Keep one global uniqueness check, narrow before intention-specific validation, reject orphan note receipts, and reject text-bearing note receipt fields.
5. Define strict public schemas for game, score, purchase-utilization, add, prediction, Tournament, unrelated mutation, and Profile-source boundaries. The Profile source type must not alias durable `Collection` after v6 activation.

**Validation gate:**

- Contract tests cover all note-state invariants, unknown fields, safe versions, offset-aware timestamps, metadata-only mutation results, receipt fingerprints, orphan receipts, and duplicate IDs within and across receipt families.
- Text tests cover CRLF, bare CR, LF, tabs, leading/trailing whitespace, Unicode whitespace-only input, combining characters, astral characters, exact 10,000/10,001 code-point boundaries, NUL, other C0 controls, and inert HTML/Markdown-like text.
- Public schemas reject `ownerNote`; detail and dedicated read schemas require it; mutation responses reject text.
- Shared typecheck, focused tests, lint, and changed-file formatting pass while v5 remains active.

## Step 2: Implement broad game and Profile projections additively

**Files:**

- New `packages/daemon/src/services/game-projection.ts`
- `packages/daemon/src/routes/games.ts`
- `packages/daemon/src/routes/prediction.ts`
- `packages/daemon/src/routes/tournament.ts`
- `packages/daemon/src/services/displayed-fitness-service.ts`
- `packages/daemon/src/services/prediction-service.ts`
- `packages/daemon/src/services/profile-service.ts`
- `packages/daemon/src/services/profile-source-coordinator.ts`
- `packages/daemon/src/services/collection-profile-engine.ts`
- `packages/daemon/tests/routes/games.test.ts`
- `packages/daemon/tests/routes/tournament.test.ts`
- Prediction route tests
- `packages/daemon/tests/services/profile-persistence.test.ts`
- `packages/daemon/tests/integration/useful-profile-persisted-flow.test.ts`

**Changes:**

1. Add validated runtime projection helpers that destructure durable-only fields rather than returning the original object under a narrower type.
2. Project note-free games from list, add, acquisition, ratings, manual values, ownership, plays, BGG IDs, dimensions, shelf assignment, refresh, prediction, and Tournament responses. Define and unit-test the dormant `DurableGame` to `GameDetailGame` projection, but do not wire complete-note detail responses while the active collection remains v5.
3. Prepare a serialized detail-snapshot API that can capture a durable game, note, collection revision, and all collection-backed displayed-fitness inputs from one immutable v6 collection snapshot. Adapt `displayed-fitness-service.ts` and `prediction-service.ts` to compute from a supplied note-free or durable snapshot rather than loading another collection. Keep existing v5 detail behavior active until Step 3 performs the coordinated cutover.
4. Project the loaded durable collection into a strict note-free Profile source before snapshot validation or computation. Adapt `displayed-fitness-service.ts`, `prediction-service.ts`, and `collection-profile-engine.ts` to accept that strict source or a smaller note-free computation source, with no cast back to durable `Collection`. Keep Profile identity based on collection ID, schema version, and revision, but prevent note text from entering engine or cache inputs.
5. Add sentinel-note serialization tests for every broad response family and Profile cache. Validate request/result correspondence so a schema-valid response for another game or command cannot cross a route boundary.

**Validation gate:**

- Broad route JSON remains unchanged and satisfies strict note-free schemas; dormant detail projection tests require the complete validated note from a `DurableGame` fixture without changing the live v5 detail route.
- Profile output and arithmetic are unchanged for collections that differ only in note state, `profile.json` contains no note field or text, and all Profile snapshot consumers typecheck and execute from the note-free source without casts to durable `Collection`.
- Existing game, prediction, Tournament, Collection, and Profile tests pass against explicit projections before the v6 cutover.

## Step 3: Activate schema version 6 and migrate storage atomically

**Files:**

- `packages/shared/src/types.ts`
- `packages/shared/src/validation.ts`
- `packages/shared/src/index.ts`
- `packages/daemon/src/services/collection-migration.ts`
- `packages/daemon/src/services/storage-service.ts`
- `packages/daemon/src/services/collection-artifacts.ts`
- `packages/daemon/src/services/collection-mutation-service.ts`
- `packages/daemon/src/services/game-service.ts`
- `packages/daemon/src/services/game-projection.ts`
- `packages/daemon/src/services/displayed-fitness-service.ts`
- `packages/daemon/src/routes/games.ts`
- New `packages/daemon/tests/fixtures/collection-schema-v5-owner-notes.json`
- `packages/daemon/tests/services/collection-migration.test.ts`
- `packages/daemon/tests/services/storage-collection-migration.test.ts`
- `packages/daemon/tests/services/storage-service.test.ts`
- `packages/daemon/tests/services/collection-artifacts.test.ts`
- Every current v5 collection constructor and fixture

**Changes:**

1. Activate schema version 6, `DurableGame[]`, and the command-receipt union in one coordinated cutover. Replace literal current-version checks with `CURRENT_COLLECTION_SCHEMA_VERSION` where possible.
2. Add pure `5 -> 6` migration from the frozen v5 schema. Add exactly `{ state: "missing", version: 0, updatedAt: null }` to every game without reading or copying BGG descriptions/comments, wishlist data, axes, ratings, plays, ownership, or other prose.
3. Initialize the same missing state in manual/add and BGG-import constructors. Keep temporary BGG prediction games note-free.
4. Preserve ordered artifact invalidation and atomic temp-write/rename behavior. Version 6 invalidates disposable Profile and prediction artifacts but never treats them as note sources.
5. Rename schema-specific revision helpers such as `schemaV4RevisionStrategy` to version-neutral names without changing revision behavior.
6. At the same cutover, activate the complete-note game-detail projection and serialized detail-snapshot operation prepared in Step 2. Assemble note, `Game.updatedAt`, score, purchase-utilization data, and collection identity from one immutable accepted v6 snapshot; do not synthesize note state from a v5 game.

**Validation gate:**

- Direct `5 -> 6`, all supported chained migrations, v6 no-op reload, repeat migration, malformed partial input, and future v7 rejection pass.
- A prose-rich v5 fixture proves every game becomes honestly missing and every prior field and intention receipt remains valid without copied note text.
- Real-filesystem tests interrupt artifact invalidation, temp write, and rename, then restart and retry while the last valid collection remains loadable.
- Game-detail contract tests now require the complete note and prove all fields are assembled from one accepted immutable v6 snapshot without synthesizing note state.
- A source audit updates all current schema-version fixtures without weakening frozen historical schemas.

## Step 4: Implement daemon note lifecycle, replay, and invalidation seam

**Files:**

- New `packages/daemon/src/services/owner-game-note-service.ts`
- `packages/daemon/src/services/collection-mutation-service.ts`
- `packages/daemon/src/services/intention-service.ts`
- `packages/daemon/src/services/profile-source-coordinator.ts`
- New `packages/daemon/tests/services/owner-game-note-service.test.ts`
- `packages/daemon/tests/services/collection-mutation-service.test.ts`
- `packages/daemon/tests/services/intention-service.test.ts`
- `packages/daemon/tests/integration/intention-concurrency.test.ts`

**Changes:**

1. Add daemon-owned `get`, `set`, and `clear` methods with injected clock, logger, hashing seam, collection mutation service, and a narrow pre-publication invalidation hook. Do not inject BGG, network, Profile narration, or model clients.
2. Execute reads through the serialized boundary as side-effect-free decisions. Return cloned current state without changing timestamps, revision, receipts, files, or derived artifacts.
3. For new set/clear commands, search command IDs across all receipt families before game/version checks. Replay a canonically identical note command; reject any changed note command or intention/note cross-family reuse.
4. Enforce stale expected versions, note-version overflow, collection-revision overflow, daemon timestamps, exact game timestamp rules, and one atomic persisted candidate containing note state, receipt, revision, and collection timestamp.
5. Treat valid `already-clear` as `changed: true` at the collection boundary so its text-free receipt and collection revision persist while note and game metadata remain byte-identical.
6. Call the invalidation hook inside the accepted mutation boundary before success can be observed. Initially it has no note-derived artifacts; tests prove ordering so future reflections can register purge behavior without changing note semantics.
7. Narrow receipt types in `intention-service.ts` before reading intention fields and reject a note-owned command ID as command reuse without changing existing intention replay.
8. Log attempt and outcome with operation, trigger, game ID, expected/resulting versions, command ID, replay/already-clear state, revision, and persistence result, never text or request fingerprints.

**Validation gate:**

- Lifecycle tests cover missing→present, present→present including equal normalized text, present→cleared, cleared→present, clear missing, clear cleared, reads, restarts, and exact timestamp/version/revision behavior.
- Replay tests cover LF-equivalent requests, changed text, operation, game, expected version, cross-family command IDs, lost responses, and restart with no duplicate version or revision.
- Failure and race tests cover stale clients, note/collection overflow, validation, persistence, concurrent unrelated mutations, queue recovery, and no receipt on rejection.
- A race between the serialized detail snapshot and set/clear proves every returned detail is internally consistent with one accepted v6 collection revision.
- Persisted collection, receipts, logs, errors, temporary-file aftermath, Profile, and registered durable artifacts contain no superseded note text.

## Step 5: Expose strict daemon routes and operation discovery

**Files:**

- `packages/daemon/src/routes/games.ts`
- `packages/daemon/src/operations.ts`
- `packages/daemon/src/routes/help.ts`
- `packages/daemon/src/app.ts`
- `packages/daemon/src/index.ts`
- `packages/daemon/tests/helpers/test-app.ts`
- New `packages/daemon/tests/routes/owner-game-note-routes.test.ts`
- `packages/daemon/tests/routes/games.test.ts`
- `packages/daemon/tests/routes/help.test.ts`

**Changes:**

1. Add `GET /api/games/:id/note`, `PUT /api/games/:id/note`, and `DELETE /api/games/:id/note`. Parse strict bodies, reject body-supplied game IDs, and validate every service response before serialization.
2. Map field validation to 400, missing games to 404, stale versions and command reuse to 409, overflow to one documented stable client-error status, and persistence failure to 500. Return 200 for replay and `already-clear`.
3. Verify route ID, request command ID, and returned identities match before responding. Stale errors include the complete current note; successful mutation responses contain no text.
4. Register `shelf.game.note.get`, `.set`, and `.clear` with complete reachable errors and metadata-only examples. Describe replay idempotency without claiming a repeated command performs a second mutation.
5. Wire one service instance through production and test application construction. Preserve the serialized game-detail snapshot activated in Step 3 rather than independently loading a durable game and note.

**Validation gate:**

- Route tests cover every success/error variant, strict unknown-field rejection, route-owned identity, malformed service output, cross-game injection, side-effect-free GET, and text-free mutation JSON.
- Help tests prove all operations and errors are discoverable and no example, description, log, or schema leaks note prose.
- Daemon focused tests, typecheck, lint, and changed-file formatting pass.

## Step 6: Preserve notes through lifecycle operations and delete atomically

**Files:**

- `packages/daemon/src/services/game-service.ts`
- `packages/daemon/src/services/purchase-utilization-service.ts`
- `packages/daemon/src/services/bgg-xml-parser.ts`
- `packages/daemon/tests/services/game-service.test.ts`
- `packages/daemon/tests/services/game-service-bgg.test.ts`
- `packages/daemon/tests/services/import.test.ts`
- `packages/daemon/tests/fixtures/collection-bloodmage.xml`
- Relevant acquisition, ownership, rating, play, shelf, and refresh tests

**Changes:**

1. Preserve `ownerNote` byte-for-byte through BGG refresh/ID changes, rating, manual values, acquisition, plays, dimensions, shelf assignment, ownership transitions, re-ownership, scoring, and unrelated mutations.
2. Keep the BGG parser from accepting collection comments or private-note-like fields as owner notes. New imports start missing; skipped existing games retain their note.
3. Preserve the existing intention-history deletion blocker. When deletion is otherwise eligible, remove the game and every associated note receipt in the same collection candidate, with no tombstone or archive.
4. Make deletion failure atomic across game, note, receipts, revision, and persistence. Runtime validation rejects orphan receipts.

**Validation gate:**

- Matrix tests cover manual/BGG-linked and owned/previously-owned games across every unrelated mutation and restart.
- Import fixtures containing comments prove no external prose enters notes and existing note states remain exact.
- Deletion tests prove intention history still blocks, note presence alone does not block, accepted deletion removes all note data and receipts, and failure preserves all of it.
- Network instrumentation proves note operations work offline and no unrelated BGG call is introduced.

## Step 7: Add CLI parity and process-level replay evidence

**Files:**

- `packages/cli/src/index.ts`
- `packages/cli/src/commands/game.ts`
- `packages/cli/src/commands/help.ts`
- `packages/cli/src/client.ts`
- `packages/cli/src/errors.ts`
- `packages/cli/src/output.ts`
- `packages/cli/tests/index.test.ts`
- `packages/cli/tests/commands/game.test.ts`
- `packages/cli/tests/commands/help.test.ts`
- New `packages/cli/tests/process/owner-game-note-replay.test.ts`
- New `packages/cli/tests/helpers/owner-game-note-replay-daemon-fixture.ts`

**Changes:**

1. Add exact nested commands `game note get|set|clear` and command-local parsing for `--expected-version`, `--text`, and `--command-id`. Accept version 0 and reject unsafe or malformed values.
2. Runtime-validate every response. Human get distinguishes never-authored, present, and explicitly cleared; JSON returns the dedicated contract; mutation output remains text-free.
3. Generate and print `Command ID: <uuid>` to standard error before any set/clear request when omitted. Preserve explicit IDs for retries and return structured failures on standard error with nonzero status.
4. Ensure unrelated commands that fetch game detail, including `game value --json` and score helpers, project away notes rather than turning detail into an accidental note API.
5. Add help mappings from daemon operation IDs without sample owner text. Document that `--text` may be visible in shell history/process arguments and that stdin, files, and editors are out of scope.

**Validation gate:**

- Parser and command tests cover multiline text, every note state, human/JSON output, generated/explicit IDs, strict responses, stale/reuse/overflow/persistence/transport failures, and absent text from mutation and unrelated output.
- A process test drops a response after durable acceptance, restarts the daemon, retries with the preflight ID, and proves exact replay without another note version or collection revision.
- CLI typecheck, focused tests, help semantic audit, lint, and changed-file formatting pass.

## Step 8: Add the game-detail Owner note editor and deletion disclosure

**Files:**

- `packages/web/lib/api.ts`
- `packages/web/lib/browser-mutations.ts`
- `packages/web/app/games/[id]/page.tsx`
- New `packages/web/components/owner-game-note-editor.tsx`
- `packages/web/components/game-actions.tsx`
- `packages/web/app/globals.css`
- New `packages/web/tests/owner-game-note-editor.test.tsx`
- New `packages/web/tests/game-actions.test.tsx`
- `packages/web/tests/game-detail-api.test.ts`
- `packages/web/tests/browser-mutations.test.ts`
- Relevant game-detail and responsive structure tests

**Changes:**

1. Parse complete notes only from game detail and dedicated reads. Parse broad API responses with strict note-free schemas. Add note mutation clients that accept caller-owned command IDs and verify route/request/result coherence.
2. Add a separately labeled Owner note panel for owned and previously owned games, visually and semantically distinct from imported BGG description. Render through a controlled textarea and React text nodes only.
3. Track authoritative baseline, draft, normalized code-point count, dirty state, pending operation, retry command identity, validation/status feedback, and stale current state independently. Use explicit save and confirmed clear; never autosave.
4. Preserve the draft through validation, transport, persistence, and stale failures. During conflict, show complete local and saved text, disable save, and require **Keep my draft** or **Load saved note**. Keeping adopts the displayed server version and clears the old command identity; loading confirms before discarding differing text.
5. Retain the exact command ID after an ambiguous transport failure, but allocate a new ID after canonical request changes. Warn on dirty `beforeunload` where supported.
6. Restore focus to the note region after mutation, associate descriptions/counters/errors, announce statuses, and make states non-color-only. Preserve line breaks and wrap unbroken content without active markup or links.
7. Extend permanent-delete confirmation to disclose irreversible note deletion only when current note content exists. Ownership changes remain non-destructive and preserve the note.

**Validation gate:**

- Reducer/component tests cover all states, exact code-point counting, dirty/pending/success/error/replay/already-clear, clear confirmation, transport retry, stale conflict, both resolutions, command-ID renewal, focus recovery, live regions, and inert hostile-looking text.
- API tests reject malformed or incoherent contracts and prove unrelated web consumers remain note-free.
- Accessibility assertions cover labels/descriptions, field errors, keyboard operation, focus visibility, non-color state text, and deliberate draft-discard confirmation.
- Web TypeScript, focused tests, production build, lint, and changed-file formatting pass.

## Step 9: Add real-browser responsive, accessibility, and concurrency gates

**Files:**

- `packages/web/e2e/fixture-daemon.ts`
- New `packages/web/e2e/owner-game-notes.spec.ts`
- `packages/web/playwright.config.ts`
- `packages/web/app/globals.css`

**Changes:**

1. Extend the deterministic fixture daemon with missing/present/cleared state, note receipts, revisions, external updates, delayed/failing/lost responses, and deletion blockers. Keep fixture list, Profile, Tournament, prediction, and unrelated mutation payloads note-free.
2. Exercise create, edit, equal-text save, clear, retry, stale two-client conflict, both conflict choices, navigation warning, ownership transition, previously-owned editing, deletion disclosure, and restart-backed replay through the production proxy.
3. Run automated layout coverage at `375x812`, `768x1024`, and `1440x900`. Rename the existing `720x450` plus `deviceScaleFactor: 2` project to identify it as layout-equivalent coverage, not browser zoom. Separately record a manual current-Chromium run at a `1440x900` desktop window with browser page zoom set to 200%, including the visible zoom setting and measured document/note-region widths. Do not accept device scale factor as literal-zoom evidence.
4. Verify keyboard flow, visible focus, live status, error association, 44px controls, 16px mobile textarea text, wrapped 10,000-code-point unbroken content, complete conflict text, and no hover-only behavior.

**Validation gate:**

- The full browser matrix has no horizontal overflow, clipping, hidden note/conflict content, undersized target, mobile input zoom, focus loss, inaccessible confirmation, or markup execution.
- Recorded literal 200% browser-zoom evidence passes the same complete-content, action, focus, target-size, and overflow checks as the automated matrix.
- Browser traces prove stale and delayed completions cannot overwrite a newer draft and a dropped accepted response replays with the retained command ID.
- The suite uses no BGG, provider, or model network access.

## Step 10: Document migration, privacy, backup, and CLI limits

**Files:**

- `docs/usage.md`
- CLI help text and operation descriptions from prior steps

**Changes:**

1. Document schema v6 automatic migration, stopped-daemon complete-data-directory backup before upgrade, complete-directory recovery, derived-cache recreation, and unsupported downgrade after a successful v6 write.
2. State that notes are local durable collection data included in raw backups, that no first-class export/restore exists, and that BGG import/export does not carry notes.
3. Explain current-state-only retention, clear and permanent deletion limits, command fingerprint caveats, local-client access, no authentication/encryption/secure-erasure guarantee, and no automatic model/network use.
4. Document exact CLI commands and the `--text` shell-history/process-argument exposure without adding unapproved stdin/file/editor behavior.

**Validation gate:**

- A documentation walkthrough stops the daemon, backs up/replaces the complete data directory, restarts, and verifies note state and replay receipts.
- Help and docs agree with operation discovery, schemas, migration behavior, privacy boundaries, unsupported downgrade, and out-of-scope features.

## Step 11: Complete persisted-flow, privacy, and parity coverage

**Files:**

- New `packages/daemon/tests/integration/owner-game-notes-persisted-flow.test.ts`
- Shared note fixtures consumed by daemon, CLI, and web tests
- Existing Collection, Profile, game, BGG, prediction, Tournament, intention, migration, logging, and browser suites

**Changes:**

1. Add one real-filesystem flow starting at v5: migrate, author on manual and BGG games, save equal text, mutate unrelated fields, change ownership twice, lose and replay a response across restart, reject a stale client, clear, and re-author. Use one game with intention history to prove deletion remains permanently blocked and preserves the game, note, and receipts. Use a separate otherwise-eligible game to prove permanent deletion atomically removes its note and note receipts. Do not add or simulate an intention-history removal operation.
2. Use canonical contracts across daemon routes, CLI JSON, and web clients so each boundary validates identical states, errors, and accepted metadata.
3. Scan serialized broad payloads, logs, errors, operation discovery, `profile.json`, wishlist artifacts, temp-file aftermath, and snapshots for a unique sentinel note and superseded text.
4. Instrument model and network seams during note reads/mutations, Collection/Profile reads and recomputation, BGG refresh, and idle time. Prove note text is never transmitted and no model operation occurs.
5. Audit production imports and response schemas for durable `Game` leakage, direct collection-file edits, note interpretation, note badges/search/filter/order, generated content, and unregistered durable note-derived artifacts.

**Validation gate:**

- The persisted flow proves migration, lifecycle, replay, stale protection, unrelated preservation, backup/restart, deletion, and cross-surface parity end to end.
- Leakage scans find the sentinel only in the current durable note and approved detail/dedicated owner-requested output while present, and nowhere durable after clear/deletion except owner-created backup copies outside the application contract.
- Collection and Profile outputs remain behaviorally unchanged apart from revision-driven safe cache invalidation.

## Step 12: Final validation against the approved specification

1. Run `bun run typecheck`, `bun run typecheck:browser`, `bun run lint`, changed-file Prettier checks, `bun run test`, `bun run build`, and `bun run test:browser` under the declared Bun 1.4.0/runtime assumptions.
2. Run root `bun run format:check` and distinguish the recorded 42-file pre-existing baseline from feature-introduced failures. Every changed file must pass.
3. Execute all 20 AI Validation groups from the source specification and attach each to automated evidence or recorded real-browser/manual recovery evidence.
4. Run tests in aggregate and varied order to catch leaked browser globals, fixture state, command IDs, clocks, and mutation queues.
5. Ask a fresh reviewer to explain missing versus cleared, owner testimony boundaries, stale and lost-response protection, broad response privacy, migration, backup, and permanent deletion from code and tests rather than the plan.
6. Ask a fresh reviewer to trace `REQ-GAME-NOTE-1` through `REQ-GAME-NOTE-26` to implementation and passing evidence, including deferred LLM/search/export scope.
7. Mark this plan `executed` and the source specification `implemented` only after every gate passes. Implementation must not begin while this plan remains `draft`.

## Dependency order and implementation task boundaries

1. Step 1 is the shared-contract task and blocks all implementation tasks.
2. Step 2 is the public-projection and Profile-isolation task. It depends on Step 1 and must land before durable v6 notes can enter route objects.
3. Step 3 is one coordinated migration/cutover task. It depends on Steps 1 and 2 and must not be split from current constructors, storage recognition, and fixture updates.
4. Step 4 is the daemon lifecycle/replay task. It depends on the v6 cutover. Step 5 is its route/operation task and follows it.
5. Step 6 is the lifecycle-preservation/deletion task. It depends on Steps 3 and 4 and can proceed in parallel with Step 5 after service contracts stabilize.
6. Step 7 is the CLI task and Step 8 is the web component task. Both depend on Step 5 and may proceed in parallel; Step 8 also needs Step 6 deletion semantics.
7. Step 9 is the browser task and depends on Step 8. Step 10 can proceed after CLI and daemon operation semantics stabilize.
8. Step 11 integrates every producer and consumer. Step 12 is terminal.

Do not activate v6 aliases before strict projections exist. Do not store set request text or full note mutation results in receipts. Do not make `already-clear` a coordinator no-op. Do not add note UI or CLI behavior before the daemon contract is authoritative. Do not implement reflections, analyst chat, model-provider architecture, note search, or first-class export as part of this plan.

## Requirement coverage

| Requirement      | Implementation steps | Primary validation                                    |
| ---------------- | -------------------- | ----------------------------------------------------- |
| REQ-GAME-NOTE-1  | 1, 3                 | State invariant and durable schema tests              |
| REQ-GAME-NOTE-2  | 3, 6                 | Migration and constructor/import fixtures             |
| REQ-GAME-NOTE-3  | 1, 4                 | Normalization, set lifecycle, timestamp/version tests |
| REQ-GAME-NOTE-4  | 1, 4, 7, 8           | Text boundary and field-error tests                   |
| REQ-GAME-NOTE-5  | 4, 8                 | Clear and `already-clear` atomicity tests             |
| REQ-GAME-NOTE-6  | 4, 11                | Receipt/artifact/log leakage and purge-order tests    |
| REQ-GAME-NOTE-7  | 2, 6, 11             | Unrelated behavior and interpretation audits          |
| REQ-GAME-NOTE-8  | 1, 4, 5              | Strict contracts and coordinator boundary tests       |
| REQ-GAME-NOTE-9  | 1, 4, 7              | Global reuse, stale, replay, and process tests        |
| REQ-GAME-NOTE-10 | 3, 4                 | Atomic persistence, overflow, and restart tests       |
| REQ-GAME-NOTE-11 | 1, 4, 6              | Text-free receipt, orphan, and deletion tests         |
| REQ-GAME-NOTE-12 | 1, 2, 5, 11          | Projection inventory and sentinel scans               |
| REQ-GAME-NOTE-13 | 8, 9                 | Editor lifecycle and browser flow tests               |
| REQ-GAME-NOTE-14 | 8, 9                 | Two-client conflict and resolution tests              |
| REQ-GAME-NOTE-15 | 7                    | CLI parser/output/help/process replay tests           |
| REQ-GAME-NOTE-16 | 3, 6, 11             | Game-kind, ownership, import, refresh, offline matrix |
| REQ-GAME-NOTE-17 | 6, 8, 11             | Preservation and atomic deletion tests                |
| REQ-GAME-NOTE-18 | 3, 10, 11            | Real-filesystem migration/recovery evidence           |
| REQ-GAME-NOTE-19 | 10                   | Documentation and recovery walkthrough                |
| REQ-GAME-NOTE-20 | 2, 4, 5, 11          | Logs/help/payload/fixture leakage scans               |
| REQ-GAME-NOTE-21 | 4, 6, 9, 11          | Network/model instrumentation                         |
| REQ-GAME-NOTE-22 | 1, 7, 8, 9           | Inert output and hostile-content tests                |
| REQ-GAME-NOTE-23 | 8, 9                 | Component and browser accessibility gates             |
| REQ-GAME-NOTE-24 | 8, 9                 | Chromium viewport and 200% zoom matrix                |
| REQ-GAME-NOTE-25 | 4, 5, 11             | Side-effect-free read tests                           |
| REQ-GAME-NOTE-26 | 2, 6, 11             | Collection/Profile parity and scope audit             |

## AI Validation coverage

| Source validation group                      | Plan evidence                              |
| -------------------------------------------- | ------------------------------------------ |
| 1, 20: semantic trace and fresh explanation  | Steps 11-12 and requirement coverage audit |
| 2-4: states, text, lifecycle                 | Steps 1, 3-4, 8                            |
| 5-6: stale clients and lost response         | Steps 4, 7-9, 11                           |
| 7-8: retention, overflow, persistence        | Steps 3-4, 11                              |
| 9: historical migration and interruption     | Steps 3, 10-11                             |
| 10-12: lifecycle preservation, BGG, deletion | Steps 6, 8, 11                             |
| 13-14: projection and surface parity         | Steps 2, 5, 7-8, 11                        |
| 15-16: accessibility and responsive Chromium | Steps 8-9                                  |
| 17: backup and recovery                      | Steps 10-11                                |
| 18: network/model isolation                  | Steps 4, 6, 9, 11                          |
| 19: repository quality gates                 | Step 12                                    |
