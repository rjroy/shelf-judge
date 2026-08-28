---
title: "Implementation plan: useful collection profile"
date: 2026-08-27
status: approved
tags: [plan, collection, profile, identity, attention, intentions]
modules: [shared, daemon, cli, web]
related:
  - .lore/work/specs/useful-collection-profile.md
  - .lore/work/brainstorm/collection-profile-decision-taxonomy.md
  - .lore/specs/collection/collection-profiling.md
  - .lore/work/notes/trusted-collection-insights-consumers.md
  - .lore/work/specs/collection-purchase-utilization.md
---

# Implementation plan: useful collection profile

## Goal

Replace the current metrics-first Profile Overview with the two approved answers in `.lore/work/specs/useful-collection-profile.md`:

1. What does my collection reveal about me?
2. What deserves my attention or a decision now?

The identity answer rates BGG mechanics, designers, and artists from reproducible current-fitness evidence. The attention answer contains only explicit owner-created first-play and replay intentions. The implementation must preserve the approved three-game support threshold, include vetoed games at their displayed fitness of `0`, and keep every active intention visible without dates, aging, urgency, overdue language, or time-based ordering.

This plan removes the superseded profile contract and its consumers rather than maintaining compatibility with it. Purchase utilization and redundancy remain in their independently approved destinations. Plan approval and implementation remain separate decisions.

## Current system boundaries

- `packages/shared/src/types.ts` and `packages/shared/src/validation.ts` define collection schema version 3, profile contract version 6, and profile algorithm version 7. The persisted game model has mechanics but no designer or artist links, class completeness, intentions, resolution history, command receipts, or collection revision.
- `packages/daemon/src/services/collection-migration.ts` owns pure version-stepped migrations. `storage-service.ts`, `collection-artifacts.ts`, and `file-ops.ts` validate and atomically replace `collection.json`, invalidating `profile.json` before migration persistence. Collection writes are atomic per file but independent service read-modify-write cycles are not serialized.
- `packages/daemon/src/services/bgg-xml-parser.ts`, `bgg-client.ts`, and `game-service.ts` fetch and persist BGG thing metadata. The parser can extract link IDs and names but currently discards designers and artists, does not deduplicate links, and cannot distinguish complete-empty class results from unfetched data.
- Current displayed fitness is assembled across `fitness-service.ts`, `prediction-service.ts`, and route-local redundancy logic in `routes/games.ts`. Profile computation does not currently consume the same canonical displayed score as game detail.
- `packages/daemon/src/services/profile-engine.ts` and `profile-service.ts` compute and cache the superseded axis, clustering, divergence, outlier, suggestion, and narration model. Timestamp-only invalidation can race with collection mutation and cannot prove the cache corresponds to one source revision.
- `packages/daemon/src/routes/profile.ts`, `packages/cli/src/commands/profile.ts`, and `packages/web/app/page.tsx` pass through and render the complete validated profile contract. The web root is the Profile Overview. There are no entity or axis drilldown routes and no intention operations.
- `packages/web/app/games/[id]/page.tsx` renders superseded profile-specific divergence, outlier, and suggestion cards. It is also the appropriate destination for intention creation, resolution, evidence correction, and resolved history.
- The repository has no browser test runner. Static render and CSS-source tests cannot satisfy the required Chromium viewport, zoom, keyboard, focus, target-size, contrast, and overflow release gates.

## Decisions made concrete for implementation

- Bump the durable collection schema from version 3 to version 4. Add collection-level intention history, command receipts, and a monotonic `revision`. Add per-game BGG entity metadata for mechanics, designers, and artists as one exhaustive shared record keyed by entity class, with complete data, refresh-needed, and unrefreshable states plus last refresh failure. Do not infer complete-empty designer or artist data during migration.
- Keep resolved intentions and accepted command receipts indefinitely in `collection.json`, committed atomically with each accepted transition. A receipt stores command ID, canonical request identity, and the exact accepted mutation result needed for replay after a lost response or daemon restart. The first release has no receipt expiration or eviction because the approved replay contract defines no retry window; any future retention limit requires a specification change and migration.
- Add one daemon-owned collection mutation coordinator below game, ownership, BGG, purchase-utilization, and intention services. It serializes every collection read-modify-validate-save cycle, allocates the next collection revision, and makes linked transitions in one collection write. Service-local queues may remain only if they delegate the write to this coordinator.
- Treat a composite identity of collection revision plus canonical validated hashes of Tournament, redundancy-settings, and prediction-settings artifacts as the profile source identity. A daemon-wide profile-source coordinator serializes every mutation of those inputs with profile snapshot capture, cache publication, and return of an accepted profile. Persist the complete identity and profile contract/algorithm versions in `profile.json`; never accept or serve a cache from mixed or superseded inputs.
- Centralize canonical displayed-fitness assembly below route code. Profile identity uses the same prediction-enabled mode as web game detail, including current Tournament and redundancy behavior; any predicted contribution makes that game ineligible. The result must include the final displayed score, veto evidence, and predicted-contribution flag. Entity computation uses this result directly, includes vetoed zeroes, and excludes predictions.
- Model BGG metadata readiness independently for each entity class while refreshing all three classes from one successful thing response in one game mutation. A failed refresh preserves last-valid complete metadata and records a warning. Metadata does not expire by age. Games without a BGG ID are unrefreshable and expose no refresh or correction action because no existing-game BGG-ID correction operation exists in this release.
- Use BGG link ID as entity identity. Deduplicate same-ID links within one game during parsing and validate uniqueness again at persistence and profile boundaries. When complete game records disagree on the current name for one ID, select the name from the newest class observation; break equal-time ties by NFC-normalized Unicode code-point name and then stable game ID. Validate this projection so a BGG rename cannot split identity or make ordering input-dependent.
- Keep entity computation and attention projection pure, deterministic, local, and synchronous. They receive validated snapshots and make no network, model, clock, or persistence calls.
- Expose the full identity overview, full entity drilldown data, axis diagnostics, active attention, and insufficiency/error states in one replacement `CollectionProfile` contract. For each class, include every entity once plus validated entity-ID orderings for `rating`, `support`, and `name`; the web selects a supplied ordering without recomputing it. Web and CLI validate and pass through that complete contract without projecting away evidence.
- Add shared create, complete, and retire command/result/error unions. The daemon snapshots the authoritative play count and evidence time on creation, checks expected intention version on resolution, and returns the accepted durable intention plus any linked ownership transition. CLI and web generate command IDs and preserve structured conflicts.
- Add one explicit play-evidence correction contract owned by the game service. A manual correction stores a validated nonnegative safe-integer count with source `manual` and a daemon observation time. Each game also stores the latest play-count check outcome and observation time from a successful BGG collection response, including valid, missing, or invalid results. Valid evidence is stale exactly when a newer successful check did not yield a valid replacement; failed network refreshes do not advance this check.
- Invoke automatic completion only from a validated data mutation that observes current play evidence above baseline. Profile reads remain side-effect free. Missing, invalid, stale, equal, or lower evidence leaves the intention active.
- Reject permanent game deletion when any active or resolved intention references the game. The error directs the owner to retire an active intention and retain the game as previously owned so durable history and its game-detail destination remain valid. Deletion remains available for games with no intention history.
- Remove the profile narration route, operation, CLI command, client helpers, service wiring, web action, dependencies used only by narration, and profile-specific narration files. Do not retain a deprecated route or compatibility payload because no external compatibility requirement exists.
- Add Playwright with the repository-managed Chromium dependency and a deterministic fixture mode for profile/game-detail states. Browser acceptance must run without external BGG or model calls.

## Step 1: Define replacement shared contracts additively

**Files:**

- `packages/shared/src/types.ts`
- `packages/shared/src/validation.ts`
- `packages/shared/src/index.ts`
- New `packages/shared/tests/useful-profile-contract.test.ts`
- `packages/shared/tests/validation.test.ts`
- Replace `packages/shared/tests/fixtures/trusted-profile.ts` with useful-profile fixtures

**Changes:**

1. Define exhaustive `mechanic | designer | artist` entity-class types, BGG entity links, class metadata states, refresh-failure provenance, and valid correction destinations.
2. Define durable intention, resolution, version, command receipt, canonical command request, mutation result, validation error, not-found, ineligible, active-conflict, stale-version, command-reuse, and persistence-failure unions.
3. Define identity class results with independent result state, metadata readiness, exclusions, comparator cohort, entity evidence, aggregate fields, stable/limited support, and complete entity-ID orderings for rating, support, and name. Validate that each ordering contains every entity exactly once in the specified deterministic order.
4. Define active attention items and resolved game-detail history with every field in the Attention Item Contract. Do not expose deadline, age, urgency, overdue, elapsed-time rank, or inferred-intention fields.
5. Define the future useful-profile shape alongside the active old `CollectionProfile`. Retain axis distributions only as diagnostic drilldown data and omit fields for axis weights, clustering, utility declarations, divergence, outliers, suggestions, narration, global rated-game count, variance, rarity, absence, and collection averages.
6. Add cross-record Zod refinements that reproduce entity and comparator counts, means, population standard deviations, ranges, differences, game memberships, class exclusions, and support labels from complete evidence. Reject non-finite values, duplicate entity identities, duplicate game contributions, and contradictory states.
7. Validate intention lifecycle invariants, one active intention per game, unique intention IDs, monotonic versions, kind/baseline compatibility, resolution consistency, attention-to-source correspondence, deterministic active ordering, and command-receipt request/result consistency.
8. Keep current collection/profile aliases and version constants active in this additive step so the repository continues to build. Export explicitly named future source/profile schemas for Steps 3 and 8 to activate at their coordinated cutovers.

**Validation gate:**

- Shared tests reproduce canonical mechanic, designer, and artist arithmetic from complete evidence, including duplicate links, vetoed zero, predicted exclusion, sparse support, ties, and mixed class readiness.
- Mutation schema tests cover both intention kinds, every lifecycle state and error variant, duplicate active records, mismatched baselines, contradictory resolutions, stale versions, and changed-payload command reuse.
- Contract tests inject `NaN`, infinities, mismatched counts, altered evidence scores, duplicate IDs, wrong comparator membership, and impossible attention cards and verify rejection.
- A source/type audit confirms the future profile contract contains no superseded family or urgency field while existing producers still typecheck against the current active aliases.
- Shared typecheck, focused tests, lint, and changed-file formatting pass.

## Step 2: Establish one collection mutation and revision boundary

**Files:**

- New `packages/daemon/src/services/collection-mutation-service.ts`
- `packages/daemon/src/services/storage-service.ts`
- `packages/daemon/src/services/game-service.ts`
- `packages/daemon/src/services/purchase-utilization-service.ts`
- `packages/daemon/src/services/axis-service.ts`
- `packages/daemon/src/services/shelf-service.ts`
- `packages/daemon/src/app.ts`
- `packages/daemon/src/index.ts`
- New `packages/daemon/tests/services/collection-mutation-service.test.ts`
- `packages/daemon/tests/services/storage-service.test.ts`
- `packages/daemon/tests/services/axis-service.test.ts`
- `packages/daemon/tests/shelf-service.test.ts`

**Changes:**

1. Add one process-wide serialized mutation API that loads the latest validated collection, applies a pure mutation, validates the complete result, and atomically saves once. Make revision advancement an injected strategy that is inactive for schema v3 and activated with v4 in Step 3.
2. Return explicit changed/no-op and domain-result values. A rejected mutation or failed persistence must leave the active file and in-memory accepted state unchanged.
3. Move `game-service.ts`, `axis-service.ts`, `purchase-utilization-service.ts`, and `shelf-service.ts` through this boundary so intention changes cannot be overwritten by concurrent ownership, BGG, axis, rating, acquisition, benchmark, shelf, import, or correction writes. Wire one coordinator instance through both `index.ts` and services constructed inside `app.ts`.
4. Preserve injectable `fileOps`, clocks, ID generators, and loggers. Do not hide lost updates behind last-writer-wins behavior.
5. Log mutation attempt and outcome at the boundary with operation, trigger, schema-appropriate collection identity before/after, affected game/intention IDs, and persistence result, without logging unrelated collection contents.
6. Restrict runtime access to `StorageService.saveCollection()` to the coordinator. Migration/bootstrap may use a separate explicit persistence method; no ordinary route or domain service may bypass serialization.

**Validation gate:**

- Deterministic concurrent tests interleave intention, ownership, BGG, rating, purchase, axis, and shelf mutations and prove no accepted update is lost.
- Failure tests cover domain rejection, validation failure, temporary-file write failure, rename failure, and retry without revision gaps or duplicate transitions.
- Existing collection mutation suites pass after all writers use the coordinator; a production-code search finds no direct collection read-modify-save outside migration/bootstrap and the coordinator.
- Logging tests assert attempts, accepted/no-op/rejected outcomes, trigger, IDs, and schema-appropriate identity while excluding unrelated game data.

## Step 3: Migrate collection schema version 3 to version 4

**Files:**

- `packages/daemon/src/services/collection-migration.ts`
- `packages/daemon/src/services/collection-artifacts.ts`
- `packages/daemon/src/services/storage-service.ts`
- `packages/shared/src/types.ts`
- `packages/shared/src/validation.ts`
- `packages/shared/src/index.ts`
- Every current collection/game constructor and typed fixture
- `packages/daemon/tests/services/collection-migration.test.ts`
- `packages/daemon/tests/services/storage-collection-migration.test.ts`
- `packages/daemon/tests/services/collection-artifacts.test.ts`
- New `packages/daemon/tests/fixtures/useful-profile-schema-v3.json`
- Typed collection fixtures affected by the schema cutover

**Changes:**

1. Activate the future durable source types from Step 1, bump only the collection schema constant to v4, update every current constructor/fixture in the same cutover, and enable coordinator revision advancement.
2. Add a pure `3 -> 4` migration that initializes revision deterministically, creates no intentions, resolutions, or command receipts, adds latest-play-check state without inventing an observation, and preserves existing play evidence without treating it as intent.
3. Migrate every existing BGG entity class to refresh-needed when historical storage cannot establish complete-empty versus unfetched data. Preserve old mechanic links as non-eligible legacy observations for display only; do not relabel them complete. Mark games without BGG IDs unrefreshable with a nullable correction destination set to `null`.
4. Keep version 0 through 3 schemas frozen and chain every supported prior version through v4.
5. Invalidate profile artifacts before persisting migrated source, using the existing ordered artifact manifest. Profile caches are disposable and are discarded, never migrated.
6. Preserve atomic, repeatable migration behavior. Interruption leaves the last valid collection loadable; repeating from the same source produces the same v4 artifact with no duplicate history or semantic drift.

**Validation gate:**

- Direct and chained fixtures cover `0 -> 1 -> 2 -> 3 -> 4`, each other supported starting version, current v4 no-op load, malformed partial input, and repeated migration.
- Fixtures prove existing collections gain no intentions, resolutions, command receipts, or fabricated complete designer/artist/mechanic metadata.
- Real-filesystem tests interrupt invalidation, temp write, and rename stages, then restart and safely retry while preserving the prior valid collection.
- Tests prove old profile v6/v7 artifacts are discarded before any v4 consumer can read them.

## Step 4: Persist complete BGG entity metadata and refresh states

**Files:**

- `packages/daemon/src/services/bgg-xml-parser.ts`
- `packages/daemon/src/services/bgg-client.ts`
- `packages/daemon/src/services/game-service.ts`
- `packages/daemon/src/routes/games.ts`
- `packages/daemon/tests/services/bgg-xml-parser.test.ts`
- `packages/daemon/tests/services/bgg-client.test.ts`
- `packages/daemon/tests/services/game-service-bgg.test.ts`
- BGG XML fixtures for zero, one, duplicate, and multiple links

**Changes:**

1. Parse mechanic, designer, and artist links from each successful BGG thing response, requiring positive integer IDs and nonempty current names. Deduplicate by ID per class and choose the deterministic current response name.
2. Mark all three classes complete, including complete-empty, from the same successful response and one observation time. Persist all classes in one coordinated collection mutation.
3. On refresh failure, retain every complete last-validated class as eligible and record exact refresh-failed warning provenance. Keep migrated refresh-needed classes ineligible. Do not expire complete metadata from age alone.
4. Persist unrefreshable state for games without BGG IDs with a nullable correction destination set to `null`. Explain the missing BGG identity but expose neither refresh nor correction action because this release adds no existing-game BGG-ID mutation.
5. Make BGG throttling safe across concurrent owner requests with one shared request queue while preserving retry and outcome logging.

**Validation gate:**

- Parser fixtures cover complete-empty, one and many designers/artists/mechanics, duplicate IDs, renamed IDs, malformed IDs/names, partial XML, and one common observation time.
- Add, import, single refresh, batch refresh, and prediction-preview tests prove all three classes propagate correctly and update atomically.
- Failed-refresh tests preserve complete last-valid metadata and warnings; migrated data remains refresh-needed; no-BGG-ID games remain unrefreshable with no false action or dead destination.
- Injected-clock tests prove age alone does not alter readiness or eligibility.
- Concurrent BGG tests prove requests honor the shared throttle and collection updates do not overwrite each other.

## Step 5: Centralize canonical displayed fitness

**Files:**

- `packages/daemon/src/services/fitness-service.ts`
- `packages/daemon/src/services/prediction-service.ts`
- New `packages/daemon/src/services/displayed-fitness-service.ts`
- `packages/daemon/src/routes/games.ts`
- `packages/daemon/src/services/profile-service.ts`
- `packages/daemon/tests/services/fitness-service.test.ts`
- `packages/daemon/tests/services/prediction-service.test.ts`
- `packages/daemon/tests/services/redundancy-integration.test.ts`
- `packages/daemon/tests/routes/games.test.ts`

**Changes:**

1. Move final score assembly out of route-local helpers into one reusable service that applies current axes, Tournament contribution, prediction, veto, and redundancy exactly once.
2. Return final displayed fitness, complete supporting breakdown, veto and hypothetical evidence, redundancy evidence, and an explicit predicted-contribution flag.
3. Make game list/detail, purchase utilization, and profile identity consume this same result. Profile identity explicitly requests the prediction-enabled game-detail mode and excludes any result containing prediction; other approved consumers retain their documented mode.
4. Keep vetoed current fitness at displayed `0`; never substitute `hypotheticalScore` in identity evidence.

**Validation gate:**

- Parity tests cover ordinary, Tournament-influenced, derived-axis, personal override, predicted, vetoed, annotated redundancy, and integrated redundancy results across prediction-enabled game detail and profile inputs, including prediction-setting changes.
- Tests prove a vetoed non-predicted game is eligible at `0`, a predicted contribution is excluded even when the final score is finite, and hypothetical score never enters entity arithmetic.
- Existing purchase-utilization and game response tests remain green without duplicate client-side score assembly.

## Step 6: Implement durable intention lifecycle and linked transitions

**Files:**

- New `packages/daemon/src/services/intention-service.ts`
- `packages/daemon/src/services/game-service.ts`
- `packages/daemon/src/routes/games.ts`
- `packages/daemon/src/operations.ts`
- `packages/daemon/src/app.ts`
- `packages/daemon/src/index.ts`
- New `packages/daemon/tests/services/intention-service.test.ts`
- `packages/daemon/tests/services/game-service-bgg.test.ts`
- New `packages/daemon/tests/services/play-evidence-mutation.test.ts`
- `packages/daemon/tests/ownership-routes.test.ts`
- `packages/daemon/tests/routes/games.test.ts`
- `packages/daemon/tests/routes/help.test.ts`

**Changes:**

1. Implement create, complete, and retire through the collection mutation coordinator. Creation validates current ownership and play evidence, derives kind eligibility, snapshots authoritative count/time, allocates a stable intention ID and version, and rejects a second active intention.
2. Implement manual completion source `owner-confirmed` and retirement source `owner-retired`. Check intention ID and expected version before every resolution.
3. Canonicalize each command payload. Persist its receipt in the same write as the transition; same ID and payload returns the original accepted result, while changed payload returns the shared command-reuse error.
4. Add a coordinated manual play-evidence mutation with stable operation ID `shelf.game.plays.set`. It accepts a nonnegative safe-integer count, records source `manual` and daemon observation time, returns the resulting intention transition when one occurs, and is the correction destination for active attention warnings.
5. Persist each successful BGG collection play-count check as valid, missing, or invalid with its observation time. A newer valid result replaces current evidence; a newer missing or invalid check leaves prior valid evidence stored but marks it stale. A failed network request does not create a successful check or make evidence stale.
6. During every accepted manual correction or BGG play-evidence update, complete an active intention only when valid non-stale current count is strictly above baseline. Record `observed-play-increase` in that same write. Missing, invalid, stale, equal, lower, or corrected-below-baseline evidence cannot complete it.
7. During currently-owned to previously-owned mutation, retire an active intention in the same collection write and return/disclose the linked transition. Re-ownership preserves history and creates nothing.
8. Reject permanent deletion with a shared history-conflict result when the game has an active or resolved intention. Permit deletion only when no intention history references the game.
9. Register discoverable `shelf.game.intention.set`, `.complete`, `.retire`, and `shelf.game.plays.set` operations with exact request, response, conflict, and persistence-error metadata. Log every attempted transition, trigger, IDs, prior state/version, and outcome.

**Validation gate:**

- Lifecycle tests cover none to active, leave active across repeated reads and arbitrary clock advancement, complete, retire, automatic completion, ownership retirement, re-ownership, and explicit new intention with a new ID/baseline.
- Creation tests cover first-play zero, replay positive, invalid/missing/stale evidence, mismatched kind, unowned game, duplicate active intention, and daemon-owned baseline snapshots.
- Play-evidence tests cover manual games, valid manual correction, successful BGG checks with valid/missing/invalid values, failed refresh, exact stale predicate, correction below baseline, and a later valid increase above baseline.
- Replay tests cover same command/same payload before and after restart, same command/changed payload, persistence failure followed by retry, and no duplicate intentions or resolutions.
- Concurrency tests race complete, retire, play update, and ownership update and prove exactly one valid transition wins; stale clients receive current state without overwrite.
- Deletion tests cover no history, active intention, and resolved history across route, coordinator, and restart boundaries; history-conflict cases preserve the complete game and collection.
- Logging and operation-discovery tests verify the required seam data and no unrelated collection contents.

## Step 7: Build the deterministic useful-profile engine

**Files:**

- Replace `packages/daemon/src/services/profile-engine.ts`
- `packages/daemon/tests/profile-engine.test.ts`
- New shared deterministic profile fixtures as needed

**Changes:**

1. Build one class-specific comparator cohort from currently owned games with complete metadata and finite canonical non-predicted fitness, counting each game once. Group every exclusion by the exact contract reason and retain linked game evidence.
2. Deduplicate each game's links, select the canonical cross-game display name by newest class observation then normalized name and game ID, and aggregate every entity's count, unrounded arithmetic mean, population standard deviation, minimum, maximum, comparator mean, and signed difference.
3. Mark one- and two-game entities limited and three-or-more supported. Rank overview entities by unrounded mean descending, support descending, NFC-normalized name by Unicode code-point order, then numeric BGG ID, capped at three per class.
4. Produce every complete drilldown entity once plus complete entity-ID orderings for rating, support, and name. Keep classes separate and phrase all output as collection association, not causation, significance, universal quality, or creator responsibility.
5. Derive independent result, metadata-readiness, exclusions, refresh warnings, nullable unrefreshable correction destinations, empty-collection, and whole-profile error states without allowing one dimension to overwrite another.
6. Project exactly one attention item from each active explicit intention, attach current evidence/warning/destinations, and order by NFC-normalized game name in Unicode code-point order then stable game ID. Never infer cards or rank from another metric or time.
7. Retain axis distributions only as diagnostics under identity. Make no network, model, persistence, or clock call.

**Validation gate:**

- Deterministic fixtures cover all three classes; zero, one, two, and three associated games; duplicate links; conflicting names for one ID at newer and equal observation times; ties; normalized and supplementary Unicode names; vetoes; predictions; previously owned games; complete-empty, partial, refresh-needed, unrefreshable, and refresh-failed metadata.
- Every aggregate and comparator is independently reproduced from emitted evidence and parsed through the shared runtime schema.
- Attention fixtures cover active, warning, nothing-to-decide, empty collection, and unavailable states. Arbitrary clock advancement changes no card, wording, ordering, or status.
- Production-code and snapshot audits find no inferred intention, urgency language, old profile family, network call, model call, or profile-read mutation.

## Step 8: Replace profile caching and daemon profile routes

**Files:**

- `packages/daemon/src/services/profile-service.ts`
- New `packages/daemon/src/services/profile-source-coordinator.ts`
- `packages/daemon/src/services/storage-service.ts`
- `packages/daemon/src/services/collection-artifacts.ts`
- `packages/daemon/src/services/collection-mutation-service.ts`
- `packages/daemon/src/services/tournament-service.ts`
- `packages/daemon/src/services/prediction-service.ts`
- `packages/daemon/src/routes/redundancy.ts`
- `packages/daemon/src/routes/profile.ts`
- `packages/daemon/src/app.ts`
- `packages/daemon/src/index.ts`
- `packages/daemon/package.json`
- `bun.lock`
- Delete `packages/daemon/src/services/narration-service.ts`
- `packages/daemon/tests/profile-service.test.ts`
- `packages/daemon/tests/profile-stale-detection.test.ts`
- `packages/daemon/tests/services/profile-persistence.test.ts`
- `packages/daemon/tests/services/tournament-service.test.ts`
- `packages/daemon/tests/services/prediction-service.test.ts`
- Redundancy route/settings tests
- `packages/daemon/tests/routes/profile.test.ts`
- Delete `packages/daemon/tests/narration-service.test.ts`
- Delete `packages/daemon/tests/routes/profile-narrate.test.ts`
- `docs/usage.md`

**Changes:**

1. Activate the future profile aliases from Step 1, advance profile contract and algorithm constants, and cache the replacement with the complete composite source identity. Reject and delete every old or malformed cache.
2. Define one stable canonical JSON serializer and SHA-256 identity for validated Tournament, redundancy-settings, and prediction-settings artifacts.
3. Add one profile-source coordinator around collection mutation, Tournament mutation, redundancy-settings mutation, prediction-settings mutation, and `getProfile()`. It serializes source snapshot capture, profile computation/cache publication, final identity validation, and return of the accepted profile against all source writers. Domain services perform no nested lock acquisition; the coordinator owns the outer operation and delegates to unlocked persistence primitives.
4. Compute only from the immutable collection/Tournament/redundancy/prediction values captured inside that boundary. Keep the boundary until a validated cache is atomically saved and the matching profile value is returned to the route. This provides one linearization point; a later mutation may make the response historical after return, but no superseded tuple is accepted or served as current.
5. Invalidate or bypass the cache after ownership, metadata, displayed-fitness input, play evidence, intention, collection schema, Tournament data/settings, redundancy settings, prediction settings, profile contract, or algorithm changes. Use complete identity equality rather than timestamp ordering as the correctness condition.
6. If recomputation or validation fails, return profile unavailable with retry. Never serve a stale profile as current and never reinterpret failure as empty identity or nothing-to-decide.
7. Keep `GET /api/profile` as the sole validated daemon profile read. It contains all entities, all three validated orderings, and axis diagnostics; entity and axis drilldowns are web routes over that complete response, not optional daemon endpoints.
8. Remove `POST /api/profile/narrate`, `shelf.profile.narrate`, narration service wiring, narration-only daemon dependencies from `packages/daemon/package.json`, and their lockfile entries after an import audit.
9. Update `docs/usage.md` with the replacement profile/CLI operations and a v4 upgrade note covering backup, automatic migration, cache recreation, and unsupported downgrade after a successful v4 write.

**Validation gate:**

- Persistence tests discard v6/v7 and malformed/non-finite caches, reload a current cache exactly, and prove every collection, Tournament, redundancy, or prediction input change alters the composite identity and recomputes.
- Race tests pause at snapshot, final validation, atomic save, and return points while independently mutating collection, Tournament, redundancy, and prediction settings. They prove the shared coordinator has no unlocked publication window and no mixed or superseded source tuple is accepted or served as current.
- Failure tests distinguish transport, validation, recomputation, and per-class insufficiency without changing durable intentions.
- Route and help tests expose only approved profile and intention operations; narration is absent. Package and lockfile audits find no narration-only dependency.

## Step 9: Add CLI intention parity and remove narration

**Files:**

- `packages/cli/src/index.ts`
- `packages/cli/src/client.ts`
- `packages/cli/src/commands/game.ts`
- `packages/cli/src/commands/profile.ts`
- `packages/cli/src/commands/help.ts`
- CLI output/error helpers
- `packages/cli/tests/index.test.ts`
- `packages/cli/tests/client.test.ts`
- `packages/cli/tests/commands/game.test.ts`
- `packages/cli/tests/commands/profile.test.ts`
- `packages/cli/tests/commands/help.test.ts`
- `packages/cli/tests/helpers/mock-client.ts`

**Changes:**

1. Extend command matching to support `game intention set`, `game intention complete`, and `game intention retire` without breaking existing commands.
2. Use exact retry-capable syntax: `game intention set <game-id> <first-play|replay> [--command-id <uuid>]`, `game intention complete <game-id> <intention-id> --expected-version <n> [--command-id <uuid>]`, and the equivalent `retire` form. When omitted, generate the UUID and write `Command ID: <uuid>` to standard error before sending the request so it survives a lost response without corrupting JSON standard output.
3. Add `game plays set <game-id> <count>` as the equivalent manual evidence-correction operation. Render the validated updated evidence and any linked automatic completion returned by the daemon.
4. Runtime-validate all command results and errors. Write the complete structured error to standard error and exit nonzero for validation, conflict, stale-version, command-reuse, history-conflict, and persistence failures.
5. Keep `shelf-judge profile` JSON equal to the complete validated daemon profile, including identity insufficiency and active evidence warnings. Do not rebuild profile arithmetic or omit evidence.
6. Remove `profile narrate`, narration client types/methods, help, and tests.

**Validation gate:**

- Parser and command tests cover all intention and play-correction operations, generated and supplied command IDs, missing/extra arguments, every result/error union, stale refresh-and-review guidance, and nonzero exit behavior.
- A process-level lost-response test captures the preflight command ID from standard error, retries with `--command-id`, and receives the original accepted JSON without a duplicate transition.
- Profile JSON deep-equals the daemon fixture for supported, limited, mixed-readiness, active, warning, nothing-to-decide, empty, and unavailable responses.
- Help and command audits contain no narration, urgency, inferred intention, or superseded profile family.

## Step 10: Replace the web Profile Overview and add drilldowns

**Files:**

- `packages/web/app/page.tsx`
- `packages/web/lib/api.ts`
- New `packages/web/app/profile/entities/page.tsx`
- New `packages/web/app/profile/axes/page.tsx`
- New `packages/web/components/profile/identity-section.tsx`
- New `packages/web/components/profile/entity-card.tsx`
- New `packages/web/components/profile/entity-evidence.tsx`
- New `packages/web/components/profile/attention-section.tsx`
- Remove superseded files under `packages/web/components/profile/`
- `packages/web/app/globals.css`
- Profile web tests under `packages/web/tests/`

**Changes:**

1. Make the page title followed by exactly the two headline-question sections. Render mechanics, designers, and artists separately with up to three supported associations each and links to complete evidence.
2. Build entity drilldown controls that select the contract-supplied `rating`, `support`, or `name` entity-ID ordering and render the same complete records without client arithmetic or sorting. Expose every sparse association, comparator cohort, supporting game score/veto state, class exclusion, readiness, refresh warning, and correction/refresh destination.
3. Move axis distributions from overview cards to the diagnostic drilldown under identity. Do not present them as identity claims or attention.
4. Render every active intention with neutral question/why/evidence/responses/resolution/destination content. Keep evidence warnings attached and render the successful nothing-needs-attention state only after a valid profile with no active intentions.
5. Keep empty collection, limited evidence, no eligible ratings, evaluated-empty class, partial metadata, refresh-needed metadata, active warning, nothing-to-decide, and whole-profile unavailable states visibly distinct. Add an actual retry control for unavailable state.
6. Remove narration, axis weights, utility curves, standalone BGG clusters, divergence, comparator-backed questions, outliers, suggestions, rated-game count, and collection-wide metric summaries from overview/API consumption.
7. Use semantic `h1`/`h2`/`h3` order, `aria-labelledby` evidence regions, linked game evidence, native controls, visible focus, existing semantic color tokens, and non-color-only status text.

**Validation gate:**

- Rendered integration tests cover every state and exact two-section hierarchy, full evidence links, all three supplied drilldown orderings, sparse labels, retry, and no client-side aggregate or ordering computation.
- Accessibility-focused component tests verify heading relationships, accessible names/descriptions, keyboard-operable native controls, focus styles, non-color status text, and contrast-token usage.
- Source/render audits prove every removed surface is absent and purchase utilization/redundancy remain available only in their independent pages.
- Run `bunx tsc --noEmit -p packages/web/tsconfig.json` and `bun run --cwd packages/web build` before moving to game-detail controls.

## Step 11: Add game-detail intention controls and history

**Files:**

- `packages/web/app/games/[id]/page.tsx`
- New `packages/web/components/intention-controls.tsx`
- New `packages/web/components/intention-history.tsx`
- `packages/web/components/game-actions.tsx`
- `packages/web/lib/api.ts`
- `packages/web/app/globals.css`
- New `packages/web/tests/intention-controls.test.tsx`
- New `packages/web/tests/intention-history.test.tsx`
- `packages/web/tests/game-links.test.tsx`

**Changes:**

1. Add create controls that offer first-play only for valid non-stale zero evidence and replay only for valid non-stale positive evidence. Explain ineligible ownership/evidence states and link to the manual play-count correction control or valid BGG refresh operation.
2. Add complete and retire controls using intention ID and expected version. On stale conflict, retain entered state, refresh current intention, and ask the owner to review instead of retrying blindly.
3. Announce success and failure through appropriate live regions, associate field errors with controls, preserve or deliberately move focus after updates, and prevent stale asynchronous responses from overwriting a newer or reopened form state.
4. Display resolved history ordered by resolution time descending then intention ID, including kind, baseline, creation provenance, resolution source, and time. Keep it off Profile Overview.
5. Update ownership controls to disclose linked intention retirement returned by the daemon.
6. Add a manual play-count correction control for owned games, including manual/no-BGG games, and announce any automatic completion returned by the same mutation. Show the exact latest-check warning when older valid evidence became stale after a successful missing/invalid BGG response.
7. Render the shared history-conflict response when permanent deletion is blocked; direct the owner to retire active intent and use previously-owned status without offering history deletion.
8. Remove profile-specific divergence, outlier, and suggestion loading/rendering from game detail while leaving score breakdown, purchase utilization, and redundancy destinations intact.

**Validation gate:**

- Reducer/component tests cover create, complete, retire, leave-active, manual play correction, valid/missing/invalid/stale evidence, server field errors, stale-version conflict, delayed stale response, focus retention, live announcements, automatic completion, linked ownership retirement, and blocked deletion.
- History tests cover stable ordering, restart-backed data, new IDs after resolution, and absence from overview.
- Keyboard and touch semantics use native controls with accessible names and no hover-only action.
- Game detail tests prove all superseded profile cards are gone and independent purchase/redundancy content remains.

## Step 12: Add real-browser accessibility and responsive release gates

**Files:**

- `packages/web/package.json`
- Root package scripts and lockfile
- New `packages/web/playwright.config.ts`
- New `packages/web/e2e/useful-profile.spec.ts`
- Deterministic web/daemon fixture support for browser tests
- `packages/web/app/globals.css`

**Changes:**

1. Add Playwright and repository-managed Chromium with a deterministic local fixture containing supported/limited identity, active/warning attention, empty states, mutation conflicts, and resolved history. Make the suite runnable in CI without BGG or model access.
2. Test Profile Overview, entity drilldown, axis diagnostics, and game-detail intentions at `375x812`, `768x1024`, and `1440x900` CSS pixels plus 200% desktop zoom.
3. Measure document and component scroll widths rather than relying on `overflow-x: hidden`. Remove masking CSS where it conceals overflow; wrap names, evidence, and actions without hiding content.
4. Exercise keyboard-only navigation, visible focus, drilldown controls, mutation focus retention, live status announcements, field-error association, and touch targets of at least `44x44` CSS pixels.
5. Assert mobile form text is at least `16px`, no evidence or response disappears, no content requires hover, and approved foreground/background pairs meet WCAG 2.1 AA contrast.

**Validation gate:**

- The complete Chromium viewport and zoom matrix passes with no horizontal page overflow, clipped evidence, inaccessible action, focus loss, hidden hover-only content, undersized target, or mobile input zoom regression.
- Browser tests distinguish unavailable from empty and verify a real create/complete/retire flow plus stale-conflict recovery through the web proxy.
- CI and local scripts install and run the pinned browser reproducibly.

## Step 13: Complete persisted-flow, parity, removal, and scope regression coverage

**Files:**

- New `packages/daemon/tests/integration/useful-profile-persisted-flow.test.ts`
- New `packages/daemon/tests/integration/intention-concurrency.test.ts`
- Shared profile fixtures consumed by daemon, CLI, and web tests
- Existing profile, ownership, BGG, purchase-utilization, redundancy, and migration suites
- Remove obsolete narration/trusted-insight tests and fixtures after replacement coverage exists

**Changes:**

1. Add one persisted flow starting at schema v3: migrate, refresh complete entity metadata, compute supported/limited identity, create both intention kinds, restart, preserve a warning after a newer missing play check, correct evidence manually, observe automatic completion, reject deletion with history, retire through ownership, re-own, create a new intention, delete profile cache, and reload exact durable history and command receipts.
2. Use shared canonical responses across daemon route, CLI JSON, and web boundary tests so no consumer can drift in states, evidence, ordering, or wording.
3. Simulate interleaved mutation, lost response, stale expected version, changed command payload, collection/Tournament/redundancy cache recompute races, and persistence interruption.
4. Audit production code and active tests for every removed profile field, computation, route, operation, CLI command, web component, narration dependency, and game-detail surface. Delete dead files rather than leaving unreferenced superseded implementations.
5. Audit identity language for causation/significance claims and attention language/data for dates, age, urgency, overdue, failure, neglect, or inferred intent.
6. Verify purchase utilization and redundancy did not become profile card sources and retain their approved independent behavior.

**Validation gate:**

- The persisted flow proves migration, restart, cache deletion, command replay, automatic completion, ownership-linked retirement, re-ownership, history, and profile recomputation are durable and idempotent.
- Daemon, CLI, and web parse and preserve the same canonical profile and mutation results.
- A production import/search audit has no superseded profile or narration surface and no deferred prediction-residual, outlier-attention, category/family/subdomain rating, or inferred-intention work.
- Every requirement has passing named evidence in the coverage map below.

## Step 14: Final validation against the approved specification

1. Run `bun run typecheck`, `bunx tsc --noEmit -p packages/web/tsconfig.json`, `bun run lint`, changed-file Prettier checks, `bun run test`, `bun run build`, and the Playwright Chromium suite.
2. Run root `format:check` and distinguish the recorded 42-file pre-existing formatting baseline from changed-file failures. Every changed file must pass.
3. Execute all 19 AI Validation items from the source specification and attach each to automated evidence or recorded real-browser evidence.
4. Inspect v0-v4 migration fixtures and a current persisted collection on disk, restart, and verify strict schema validity, no fabricated intentions, metadata readiness, command receipts, and cache source revision.
5. Ask a fresh reviewer to explain both headline answers, sparse evidence, veto treatment, missing play evidence, intention resolution, and every removed surface from the implementation without relying on the spec.
6. Ask a fresh reviewer to trace REQ-USEFUL-PROF-1 through REQ-USEFUL-PROF-50 to implementation and passing tests and to audit deferred-scope boundaries.
7. Mark this plan `executed` and the source spec `implemented` only after every gate passes. Implementation must not begin while this plan remains `draft`.

## Dependency order

1. Step 1 establishes the replacement contracts.
2. Step 2 depends only on the additive mutation result types from Step 1, remains compatible with schema v3, and must precede all new mutation behavior.
3. Step 3 depends on Steps 1 and 2 and performs one coordinated activation of the v4 source aliases, version constant, revision strategy, historical schemas, migration, current constructors, storage, and fixtures.
4. Steps 4 and 5 depend on the v4 collection shape and may proceed in parallel after Step 3.
5. Step 6 depends on Steps 2 through 4 because automatic completion and ownership retirement share the metadata/play update boundary.
6. Step 7 depends on Steps 4 through 6 for canonical metadata, fitness, and intentions.
7. Step 8 depends on Step 7 and establishes the authoritative daemon profile and cache behavior.
8. Steps 9 and 10 depend on Step 8 and may proceed in parallel. Step 11 depends on Step 6 and the web API work in Step 10.
9. Step 12 depends on Steps 10 and 11. Step 13 depends on all producer and consumer work. Step 14 is terminal.

Do not activate v4 types or constants in Step 1. Do not split the Step 3 schema migration from required current-schema constructors and fixtures. Do not add intention mutations before Step 2 serializes every collection writer. Do not begin web or CLI profile projections before Step 8 makes the daemon contract authoritative.

## Requirement coverage

| Requirement        | Implementation steps | Primary validation                                          |
| ------------------ | -------------------- | ----------------------------------------------------------- |
| REQ-USEFUL-PROF-1  | 1, 7, 10             | Three-class contract, engine, and rendered hierarchy tests  |
| REQ-USEFUL-PROF-2  | 4, 5, 7              | Eligibility and canonical displayed-fitness fixtures        |
| REQ-USEFUL-PROF-3  | 5, 7                 | Predicted-contribution exclusion tests                      |
| REQ-USEFUL-PROF-4  | 5, 7                 | Vetoed-zero evidence and no-hypothetical tests              |
| REQ-USEFUL-PROF-5  | 1, 4, 7              | Parser, persistence, and aggregate deduplication tests      |
| REQ-USEFUL-PROF-6  | 1, 7                 | Reproducible entity arithmetic contract tests               |
| REQ-USEFUL-PROF-7  | 1, 7                 | Shared comparator cohort evidence tests                     |
| REQ-USEFUL-PROF-8  | 7, 10                | Sparse/support threshold engine and drilldown tests         |
| REQ-USEFUL-PROF-9  | 7, 10                | Unrounded ranking and overview cap tests                    |
| REQ-USEFUL-PROF-10 | 1, 7, 10             | Complete drilldown ordering/evidence tests                  |
| REQ-USEFUL-PROF-11 | 7, 10, 13            | Language snapshots and causation audit                      |
| REQ-USEFUL-PROF-12 | 1, 4                 | BGG link identity/completeness/provenance tests             |
| REQ-USEFUL-PROF-13 | 3, 4                 | v3 migration and refresh-needed tests                       |
| REQ-USEFUL-PROF-14 | 4                    | Atomic three-class refresh and failure-retention tests      |
| REQ-USEFUL-PROF-15 | 1, 7, 10             | Axis diagnostic route and identity hierarchy tests          |
| REQ-USEFUL-PROF-16 | 1, 10, 13            | Removed-field contract/render/import audits                 |
| REQ-USEFUL-PROF-17 | 1, 7, 10             | Independent state-dimension fixtures                        |
| REQ-USEFUL-PROF-18 | 7, 13                | Pure-engine seam and no-network/model audit                 |
| REQ-USEFUL-PROF-19 | 1, 7, 8              | Runtime corruption and persistence rejection tests          |
| REQ-USEFUL-PROF-20 | 8, 9, 10, 13         | Daemon/web/CLI canonical response parity                    |
| REQ-USEFUL-PROF-21 | 10, 12               | Semantic, keyboard, focus, cue, and contrast tests          |
| REQ-USEFUL-PROF-22 | 10, 12               | Chromium viewport and 200% zoom matrix                      |
| REQ-USEFUL-PROF-23 | 1, 3, 8              | Version bump, stale discard, composite-identity tests       |
| REQ-USEFUL-PROF-24 | 1, 3, 4, 10          | Unrefreshable state and valid destination tests             |
| REQ-USEFUL-PROF-25 | 1, 6, 7              | Explicit two-kind source and projection tests               |
| REQ-USEFUL-PROF-26 | 1, 6                 | Creation eligibility and baseline snapshot tests            |
| REQ-USEFUL-PROF-27 | 7, 13                | No-inference engine and scope audits                        |
| REQ-USEFUL-PROF-28 | 1, 7, 10, 13         | Clock-advance, language, and ordering tests                 |
| REQ-USEFUL-PROF-29 | 1, 6, 7, 10, 11      | Exact stale predicate, warning, refresh/correction tests    |
| REQ-USEFUL-PROF-30 | 1, 6, 7, 9, 10, 11   | Attention contract and equivalent response-control tests    |
| REQ-USEFUL-PROF-31 | 7, 10                | NFC code-point and stable-ID ordering tests                 |
| REQ-USEFUL-PROF-32 | 1, 7, 13             | One-active-intention/one-card invariant tests               |
| REQ-USEFUL-PROF-33 | 1, 2, 6, 13          | Atomic durable resolution and restart tests                 |
| REQ-USEFUL-PROF-34 | 2, 6, 13             | Data-update completion and read-purity tests                |
| REQ-USEFUL-PROF-35 | 6, 9, 11             | Owner-confirmed mutation parity tests                       |
| REQ-USEFUL-PROF-36 | 1, 6, 11, 13         | New-ID-after-resolution and history tests                   |
| REQ-USEFUL-PROF-37 | 7, 10                | Nothing-needs-attention and no-substitution tests           |
| REQ-USEFUL-PROF-38 | 1, 7, 10, 11         | Active/warning/history/state distinction tests              |
| REQ-USEFUL-PROF-39 | 1, 10, 13            | Removed/deferred attention-source audit                     |
| REQ-USEFUL-PROF-40 | 1, 6, 8              | Operation discovery and replay tests                        |
| REQ-USEFUL-PROF-41 | 8, 9, 10, 11, 13     | Web/CLI mutations, structured errors, profile parity        |
| REQ-USEFUL-PROF-42 | 1, 2, 6, 9, 11       | Concurrent stale-version conflict tests                     |
| REQ-USEFUL-PROF-43 | 2, 6                 | Transition attempt/outcome logging tests                    |
| REQ-USEFUL-PROF-44 | 2, 3, 13             | Atomic repeatable migration and interruption tests          |
| REQ-USEFUL-PROF-45 | 1, 6, 7              | Shared lifecycle and attention invariant rejection tests    |
| REQ-USEFUL-PROF-46 | 11, 12               | Live status, field error, focus, keyboard, touch tests      |
| REQ-USEFUL-PROF-47 | 11, 12               | Chromium layout, target-size, and input-font tests          |
| REQ-USEFUL-PROF-48 | 8, 10, 13            | Unavailable-not-empty and durable-source preservation tests |
| REQ-USEFUL-PROF-49 | 2, 3, 8, 13          | Composite source-identity invalidation matrix               |
| REQ-USEFUL-PROF-50 | 2, 6, 11, 13         | Atomic ownership retirement and re-ownership tests          |

## AI Validation evidence map

| Spec validation                            | Planned evidence                                                |
| ------------------------------------------ | --------------------------------------------------------------- |
| 1. Owner-approved semantics                | Goal, decisions, requirement map, language/scope audits         |
| 2. Exactly two questions                   | Step 10 rendered hierarchy and Step 13 output audit             |
| 3. Deterministic entity fixtures           | Steps 1 and 7 shared/engine fixture matrix                      |
| 4. Aggregate reproduction and corruption   | Step 1 strict contract and Step 7 producer parse tests          |
| 5. Overview ranking                        | Step 7 unrounded tie-order tests and Step 10 rendering          |
| 6. BGG parsing/migration/refresh           | Steps 3 and 4 parser, migration, failure, and destination tests |
| 7. Full intention lifecycle                | Steps 6 and 13 service and persisted-flow tests                 |
| 8. Kind and baseline validation            | Steps 1 and 6 contract/service tests                            |
| 9. Gentle visibility over time             | Steps 7, 10, and 13 clock/language/order tests                  |
| 10. Automatic completion boundary          | Steps 6 and 13 play-evidence update and read-purity tests       |
| 11. Replay, conflicts, persistence failure | Steps 2, 6, and 13 concurrency/replay tests                     |
| 12. Web and CLI parity                     | Steps 9, 11, and 13 canonical fixture tests                     |
| 13. Distinct states                        | Steps 7, 8, 10, and 12 engine/API/render/browser tests          |
| 14. Removed profile surfaces               | Steps 8 through 13 route/import/render audits                   |
| 15. Accessibility                          | Steps 10 through 12 component and browser checks                |
| 16. Real Chromium layout                   | Step 12 viewport and zoom matrix                                |
| 17. Cache and migration                    | Steps 3, 8, and 13 filesystem/revision fixtures                 |
| 18. Repository gates                       | Step 14 commands and baseline distinction                       |
| 19. Fresh explanation review               | Step 14 fresh-context product and traceability reviews          |

## Rollout and recovery

- Ship the collection schema, migration, complete constructors, and profile version bump in one release. A v4 binary must never write a partially upgraded collection or accept an old profile cache.
- Treat `profile.json` as disposable. On first v4 load, invalidate it before migration persistence and recompute only after strict source validation.
- Keep `collection.json` as the rollback-critical artifact. Migration and mutation failures preserve the prior valid file; startup retries migration or reports a source error without fabricating a profile.
- Because v4 adds durable intentions and command receipts, downgrading to a v3 binary is not supported after the first successful v4 write. Document backup/restore behavior in `docs/usage.md` rather than silently dropping new fields.
- `docs/usage.md` is the release-facing destination for the backup, automatic migration, cache recreation, and unsupported-downgrade instructions.
- Browser fixtures and all automated tests use local deterministic data. BGG refresh remains owner-initiated and is not part of profile reads or startup rollout.

## Risks and review notes

- **Collection-wide concurrency is foundational.** A new intention-only queue would still lose transitions against ownership, BGG, rating, and purchase writers. Step 2 must cover every writer before lifecycle work begins.
- **Command receipts grow with accepted commands.** The first release retains them indefinitely to honor replay without an invented expiry. Any later compaction requires a separately approved retry contract and migration.
- **Canonical fitness is currently fragmented.** Entity evidence cannot claim parity until game list/detail, purchase utilization, and profile consume one final-score assembly path.
- **Historical metadata is unknowable.** Existing mechanic arrays may be factual, but old storage cannot establish all-class completeness. Migration must prefer refresh-needed over a misleading eligible cohort.
- **Refresh failure and staleness differ.** Last-valid complete entity metadata remains eligible with a warning, and age alone cannot invalidate it. Play evidence becomes stale only after a newer successful missing/invalid play-count check. Failed network refreshes do neither. Generic seven-day BGG freshness UI must not control profile eligibility.
- **Profile-source serialization spans four stores.** Collection, Tournament, redundancy, and prediction-setting writers plus profile publication must share one outer coordinator without nested-lock deadlocks. Composite hashes remain the restart-safe cache identity.
- **Permanent deletion conflicts with durable history.** This release rejects deletion after any intention exists rather than inventing tombstones or silently erasing owner intent.
- **Unicode ordering is contractual.** JavaScript `localeCompare` and UTF-16 unit order do not meet the specified NFC code-point ordering; use one shared comparator and test supplementary characters.
- **Removed profile code is broad.** Types, schemas, persisted fixtures, daemon operations, CLI dispatch, web components, CSS, tests, and narration-only dependencies all require explicit deletion or relocation.
- **Browser proof is new infrastructure.** Playwright installation and deterministic fixture startup are release dependencies, not optional follow-up work.
- **Global overflow masking is unsafe.** `overflow-x: hidden` cannot count as responsive evidence; browser tests must compare actual layout widths.
- **Old ownership lore conflicts with the approved spec.** The approved useful-profile requirement governs: only currently owned games contribute, and ending ownership atomically retires active intention.

## Fresh-eyes review

The initial review found six blockers: collection revision omitted Tournament and redundancy inputs; no play-correction owner or exact stale predicate existed; permanent deletion could orphan intention history; bounded command-receipt retention narrowed the approved replay contract; the first three steps activated schema v4 in a non-buildable order; and the plan invented a BGG-ID correction destination.

This revision uses a composite source identity with publication rechecks, adds manual play correction and latest successful check provenance, rejects deletion when intention history exists, retains receipts indefinitely, keeps Step 1 additive until coordinated cutovers, and makes no-BGG-ID destinations nullable with no false action. Targeted verification closed all six findings.

The terminal broad review found seven further issues: prediction settings and profile prediction mode were absent from cache identity; compare-before-save retained a publication race; collection-writer wiring was not exhaustive; cross-game names for one BGG ID lacked a canonical rule; drilldown sorting had no single contract; generated CLI command IDs were not recoverable after a lost response; and dependency/upgrade documentation files were unnamed.

This revision defines prediction-enabled profile scoring and a four-part source identity, serializes all source writes with profile publication, enumerates axis/shelf/application wiring, selects names by newest observation with deterministic ties, supplies all drilldown orderings in `GET /api/profile`, prints generated command IDs before transmission with exact retry syntax, and names package, lockfile, and `docs/usage.md` updates.

Targeted verification closed all seven terminal findings. The reviewer found no remaining issue in the corrected cache inputs/publication boundary, writer wiring, entity naming, drilldown contract, CLI replay interface, or rollout files. The owner approved the plan on 2026-08-27, authorizing implementation through separate tracked work.
