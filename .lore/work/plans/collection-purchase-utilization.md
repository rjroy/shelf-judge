---
title: "Implementation plan: collection purchase utilization"
date: 2026-08-25
status: approved
tags: [plan, collection, purchase-utilization, exact-arithmetic, provenance]
modules: [shared, daemon, web, cli]
related:
  - .lore/work/specs/collection-purchase-utilization.md
  - .lore/work/specs/derived-bgg-axes.md
  - .lore/specs/collection/collection-profiling.md
  - .lore/specs/features/previously-owned.md
---

# Implementation plan: collection purchase utilization

## Goal

Implement `.lore/work/specs/collection-purchase-utilization.md` (REQ-UTIL-1 through REQ-UTIL-36): optionally record each game's lifetime landed cost, configure one collection entertainment benchmark, calculate an explainable per-game purchase-value result from current fitness and modeled use, expose equivalent web and CLI results and editing, and add the two approved user-selected web collection sorts.

The source spec remains approved after the owner-directed revision to one implicit personal currency. This plan does not include collection aggregation, automatic ranking or judgment, notability, profile or fitness integration, or collection-brief work. Plan approval and implementation execution remain separate decisions.

## Current system boundaries

- `packages/shared/src/types.ts` defines `Collection` schema version 2, `Game`, `BggGameData`, `FitnessResult`, and `GameWithScore`. There is no acquisition, benchmark, field-level usage provenance, exact rational, amount, or utilization result contract.
- `packages/shared/src/validation.ts` owns strict current collection validation. Play count and duration validation does not yet enforce the safe-integer rules required by this feature.
- `packages/daemon/src/services/collection-migration.ts` owns the versioned `0 -> 1 -> 2` migration chain. `StorageService.loadCollection()` migrates before strict current-schema validation and atomically persists migrated collections.
- BGG thing and collection calls are separate. `bgg-xml-parser.ts` already parses and persists full suggested-player bucket labels and vote counts in `BggGameData.suggestedPlayerCounts`; its compatibility `bestPlayerCount` projection accepts lower-bound buckets and keeps the first distinct tie, while absent, empty, and unusable poll evidence all collapse to `[]`. `game-service.ts` can retain an old play count while replacing the broad `bggData.fetchedAt`, so that timestamp cannot serve as play-count provenance.
- Fitness can be ordinary, predicted, tournament-influenced, vetoed, or redundancy-adjusted. `packages/daemon/src/routes/games.ts` applies prediction and redundancy after `GameService` scoring, so utilization cannot be calculated inside `GameService` if it must use the score shown by the response.
- `GET /games` and `GET /games/:id` already return `GameWithScore`. Web collection sorting is client-side in `packages/web/lib/collection-utils.ts`. The game detail page is a server component with focused client forms for mutations.
- CLI registration and argument parsing are centralized in `packages/cli/src/index.ts`; game commands live in `commands/game.ts`. There is no collection command module.

## Decisions made concrete for implementation

- Add an additive shared exact-rational implementation backed internally by normalized `bigint` numerator and denominator values. Raw `bigint` values never cross JSON boundaries. Exact API values serialize as decimal numerator and denominator strings. Potentially unbounded whole-play values and sort keys serialize as unsigned decimal integer strings and use a shared exact string comparator rather than unsafe numbers.
- Treat amounts as exact integer hundredths in one implicit personal currency. Input accepts decimal strings with zero, one, or two fractional digits and rejects excess precision or unsafe stored values without rounding. The first release renders `$` and stores no currency code, exchange rate, exponent, symbol setting, or registry metadata.
- Persist `Game.acquisition` as a discriminated union: `unknown`, `gift`, `purchase`, or `invalid`. A purchase contains cumulative lifetime landed cost, `source: "manual"`, and `confirmedAt`. The invalid variant preserves the raw malformed payload for web and CLI correction without allowing it into calculations.
- Persist `Collection.entertainmentBenchmark` as a valid manual amount, a preserved invalid payload, or `null`. `null` is the unknown state. Clearing never writes zero; a valid benchmark must be positive.
- Add a schema version 3 migration. Version 2 games migrate to unknown acquisition and the collection migrates with no benchmark. Existing duration, play count, player range, and suggested-player evidence migrates with `source: "legacy-unknown"` and no invented observation time.
- Keep strict runtime types while adding a tolerant version-3 storage decoder at the load boundary. It converts malformed acquisition or benchmark payloads into the current invalid variants before `CollectionSchema` validation, so malformed amounts remain loadable and correctable.
- Persist independent usage evidence for play count, published duration, and min/max player range. Each field uses a valid, missing, or invalid evidence variant; invalid evidence preserves a JSON-safe raw envelope without entering calculations. Stable source identifiers are `manual`, `bgg-collection`, `bgg-thing`, `bgg-suggested-player-poll`, `bgg-player-range`, `current-fitness`, and `legacy-unknown`; each observation carries `observedAt: string | null`.
- Reuse the suggested-player buckets already parsed and persisted as `BggGameData.suggestedPlayerCounts`. In schema version 3, replace that array with one canonical `suggestedPlayerPoll` object containing the same buckets plus `absent | empty | unusable | usable | legacy-unknown` state, source, and observation time. `legacy-unknown` is migration-only when version 2 discarded the distinction. Do not retain a second bucket copy in utilization evidence. Resolve the utilization modeled player count from this canonical poll on read without changing the compatibility `bestPlayerCount`/`bestPlayers` projections or Player Count Fit axis semantics.
- Derive utilization for game list/detail API responses instead of persisting it. Define a distinct `GameWithPurchaseUtilization` API type so internal `GameWithScore` constructors and unrelated responses do not fabricate the field. One daemon response-assembly helper enriches a game only after its final displayed fitness has been selected and redundancy applied. Web and CLI consume that result and never repeat formulas.
- Add one canonical one-decimal `displayScore` string to enriched game responses. Produce it by exact decimal rounding of the final raw score after integrated redundancy, use that same string as the utilization fitness input, and require web and CLI to render it instead of independently calling `toFixed`. This makes an integrated raw score such as `7.95` calculate and display from the same `8.0` contract.
- Model each result component as `calculated`, `unavailable`, `not-applicable`, or `unreachable`, with only relevant stable reasons. Include exact serialized values, formatted labels, evidence, and explicit web sort projections in the shared response contract.
- Add idempotent `PUT /api/games/:id/acquisition` with `{ state: "unknown" | "gift" | "purchase", amount?: string }`. Add `GET /api/collection/entertainment-benchmark`, `PUT /api/collection/entertainment-benchmark` with `{ amount: string }`, and `DELETE /api/collection/entertainment-benchmark`. Repeating an identical normalized mutation is a no-op that preserves confirmation/update timestamps and skips persistence.
- Add `includePredicted=true|false` to `GET /api/games/:id`, defaulting to `false` for compatibility. Web game detail and CLI `game value` request `true`, preserving today's predicted display for unrated or partially rated games. `GameWithPurchaseUtilization.displayScore` is `string | null`; each detail mode must match the corresponding list mode.
- Add web benchmark editing at `/settings#entertainment-benchmark`; currency-mismatch UI is not needed. Add CLI commands `game acquisition <game-id> unknown|gift|purchase [amount]`, `game value <game-id>`, and `collection benchmark get|set [amount]|clear`.
- Add collection sorts only to the web collection table. Utilization ties always use ascending NFC-normalized Unicode code-point game-name order and then ascending code-point stable ID, independent of primary direction.

## Step 1: Add exact rational and amount primitives

**Files:**

- New `packages/shared/src/exact-rational.ts`
- New `packages/shared/src/amount.ts`
- `packages/shared/src/index.ts`
- New `packages/shared/tests/exact-rational.test.ts`
- New `packages/shared/tests/amount.test.ts`

**Changes:**

1. Implement normalized exact rational construction, decimal parsing, addition, subtraction, multiplication, division, comparison, maximum, ceiling, and half-up rounding without floating-point arithmetic.
2. Parse a score's base-10 string exactly and add a canonical one-decimal fitness display projection that rounds the final raw score with decimal half-up semantics. This projection, not `String(score)` or client-side `toFixed`, is the later utilization input.
3. Parse amount input into safe integer hundredths. Accept `5`, `5.0`, and `5.00`; reject signs or precision outside the domain, non-decimal syntax, negative values, and unsafe integer overflow. Apply the separate positive-benchmark rule in domain validation rather than the generic parser.
4. Add exact amount display helpers for two-decimal `$` output, positive sub-cent output such as `<$0.01`, and half-up rounded-hundredths sort keys. Pin behavior immediately below, exactly at, and immediately above `$0.005`.
5. Keep internal `bigint` out of exported persisted and API payloads. Add an exact JSON projection using numerator and denominator decimal strings where later calculation evidence needs it, plus canonical unsigned-decimal-string validation/comparison for whole values above `Number.MAX_SAFE_INTEGER`.

**Validation gate:**

- Unit tests cover rational normalization, negative intermediate subtraction, comparison, exact ceiling, and half-up boundaries.
- Amount tests cover zero, one, and two fractional digits, excess precision, malformed strings, maximum safe stored hundredths, overflow, exact `$0.00`, and positive sub-cent display.
- Fitness projection tests cover scores with zero, one, and two decimal places, including integrated redundancy values such as `7.95`, and prove the same canonical one-decimal string is suitable for display and exact calculation.
- Amount tests immediately below, at, and above `$0.005` assert both display and rounded-hundredths sort keys. Unsigned integer-string tests compare values on both sides of `Number.MAX_SAFE_INTEGER` exactly.
- Shared tests, lint, formatting, and type checking pass without a third-party floating decimal package or `any`.

## Step 2: Capture trustworthy BGG result observations before persistence cutover

**Files:**

- `packages/shared/src/types.ts`
- `packages/daemon/src/services/bgg-xml-parser.ts`
- `packages/daemon/src/services/bgg-client.ts`
- `packages/daemon/src/services/game-service.ts`
- `packages/daemon/src/services/prediction-service.ts`
- `packages/daemon/tests/services/bgg-xml-parser.test.ts`
- `packages/daemon/tests/services/bgg-client.test.ts`
- `packages/daemon/tests/services/game-service-bgg.test.ts`

**Changes:**

1. Extend additive BGG result types to carry the injected-clock observation time of the request that produced each thing, collection-play, poll, and player-range field. Do not change the persisted `Game` contract in this step.
2. Refactor the existing `extractSuggestedPlayerCounts()` path into one internal parsed poll result containing the already-supported buckets plus `absent | empty | unusable | usable` state. Add that result as a daemon-only sidecar on `ThingItem`, which `BggClient` already consumes, without changing persisted `BggGameData` in this step. `parseThingResponse()` keeps its current `BggGameData[]` return and compatibility projection; both parser entry points call the same internal extractor once per item. Continue projecting buckets into current `BggGameData.suggestedPlayerCounts` until the Step 3 cutover.
3. Keep parser extraction factual: preserve every bucket label and its Best/Recommended/Not Recommended vote counts without applying utilization eligibility, tie, or range-fallback rules. Derive the existing compatibility `bestPlayerCount` from the already-extracted buckets with unchanged behavior; Step 4 owns the new utilization-specific selection semantics.
4. Carry each field's observation through search/add, single refresh, batch refresh, prediction preview, and BGG collection import. In import, preserve the first successful collection response's play-count observation even if the later batch fetch performs another absent or partial collection request.
5. Keep the old persisted field assignments temporarily compatible while exposing the complete additive result needed by Step 3. Do not synthesize timestamps in creation paths that did not receive a field.
6. Log BGG metadata and collection fetch attempts/outcomes with game/BGG IDs, fields returned, source request, observation time, and partial/absent response state.

**Validation gate:**

- `parseThingItems()` sidecar tests prove current bucket labels and vote counts are retained exactly and each future poll state is distinguishable. Compatibility tests prove `parseThingResponse()` retains its current shape and both entry points project identical buckets from the shared extractor. Existing `bestPlayerCount` behavior tests remain unchanged in this additive step.
- Injected-clock tests distinguish thing and collection observations and prove every result field carries only its producing request's time.
- Import tests cover the initial collection response followed by complete, absent, and partial secondary collection responses without discarding or misdating initial play evidence.
- Existing BGG add/import/refresh/prediction behavior and current persisted schema remain green, making this step independently closable before migration.

## Step 3: Introduce acquisition, benchmark, persisted evidence, and schema version 3

**Files:**

- `packages/shared/src/types.ts`
- `packages/shared/src/validation.ts`
- `packages/shared/src/index.ts`
- `packages/daemon/src/services/collection-migration.ts`
- `packages/daemon/src/services/storage-service.ts`
- `packages/daemon/src/services/game-service.ts`
- `packages/daemon/src/services/prediction-service.ts`
- `packages/shared/tests/validation.test.ts`
- `packages/daemon/tests/services/collection-migration.test.ts`
- `packages/daemon/tests/services/storage-collection-migration.test.ts`
- `packages/daemon/tests/services/storage-service.test.ts`
- `packages/daemon/tests/services/game-service-bgg.test.ts`
- Typed persisted and temporary collection/game fixtures affected by the version cutover

**Changes:**

1. Define persisted amount, acquisition, benchmark, observation, player-range evidence, and canonical suggested-player poll unions. Valid evidence has a validated payload; missing evidence has no payload; invalid evidence uses `{ presence: "missing" }` or `{ presence: "present", value: JsonValue }` so it is serializable and distinguishable. Keep invalid values inaccessible to calculation helpers.
2. Freeze independent version-0, version-1, and version-2 migration schemas before changing current schemas. Historical schemas must not derive from the new `GameSchema` or `CollectionSchema` in ways that inherit version-3 required fields.
3. Add required `Game.acquisition` and usage evidence fields plus `Collection.entertainmentBenchmark`; bump the strict current collection schema and `CURRENT_COLLECTION_SCHEMA_VERSION` to 3.
4. Add a pure `2 -> 3` migration that preserves every valid existing game field, adds unknown acquisition and no benchmark, maps play count, duration, and range values to evidence, and moves the existing `bggData.suggestedPlayerCounts` array into the single canonical `suggestedPlayerPoll.buckets` location with `source: "legacy-unknown"` and no timestamp. A valid empty legacy array receives state `legacy-unknown` because version 2 cannot distinguish absent, empty, or previously collapsed evidence. A valid nonempty array is `usable` when it contains an exact positive safe-integer bucket with positive Best votes and otherwise `unusable`. Do not copy the buckets into a second utilization field.
5. Define migration behavior for zero/negative/unsafe duration, play count, player bounds, reversed ranges, malformed poll buckets, and malformed `bestPlayers`. Replace a malformed compatibility field with its strict-schema-safe value, normally `null` or `[]`, while retaining the exact original JSON in the corresponding invalid evidence envelope. Play-count and duration evidence preserve malformed `numPlays` and `playingTime`; canonical poll invalid evidence preserves malformed suggested-player buckets; player-range invalid evidence preserves malformed bounds. Preserve malformed compatibility `bestPlayers` separately without treating it as canonical poll input.
6. Add the tolerant version-3 storage decoder for acquisition and benchmark. Use own-property checks to distinguish absent from explicit null or malformed content, recognize already-normalized invalid variants without nesting them, preserve JSON-safe raw values, log IDs/field names but not entered values, then run strict current validation.
7. Update fresh collection creation, game add/import/refresh, prediction preview, and every persisted or temporary `Game` constructor to version-3 types. Persist Step 2 poll buckets, state, and observation once in `suggestedPlayerPoll`; retain old evidence unchanged when a response omits that field.
8. Ensure migration and invalid normalization are idempotent and use the existing atomic collection persistence boundary. An unrelated save must not rewrite or lose invalid payloads.

**Validation gate:**

- Direct and chained fixtures cover `0 -> 1 -> 2 -> 3`, `1 -> 2 -> 3`, and `2 -> 3`; every older fixture reaches the same strict version-3 shape.
- Valid version 2 fields remain byte-equivalent outside the new fields. Every migrated poll has `source: "legacy-unknown"` and null observation time, while its state follows the deterministic empty/usable/unusable rules above. Malformed compatibility fields become strict-safe while their exact original JSON remains in the named invalid evidence envelope.
- Migration tests prove every valid version-2 suggested-player bucket appears exactly once under `suggestedPlayerPoll.buckets`; cover deterministic `legacy-unknown` empty, usable nonempty, unusable nonempty, malformed poll, zero/negative duration, invalid play counts, zero/negative/unsafe/reversed player ranges, unsafe `bestPlayers`, and missing properties.
- Valid gift, zero purchase, positive purchase, benchmark, and Step 2 BGG observations round-trip through storage.
- Decoder tests cover absent property, explicit null, wrong discriminator, malformed nested amount, already-normalized invalid data, unrelated save/reload, and correction without repeated wrapping.
- Strict runtime validation rejects raw malformed amount/evidence outside the storage decoder. Shared and daemon suites plus root type checking pass after the coordinated schema/fixture cutover.

## Step 4: Implement the shared utilization engine and result contract

**Files:**

- New `packages/shared/src/purchase-utilization.ts`
- `packages/shared/src/types.ts`
- `packages/shared/src/index.ts`
- New `packages/shared/tests/purchase-utilization.test.ts`

**Changes:**

1. Define the JSON-safe utilization response with independent components for cost per recorded play, modeled player-hours, cost per modeled player-hour, adjusted benchmark, multiplier/status, value remaining, and estimated additional plays. Finite additional-play values and keys are canonical unsigned decimal integer strings, not numbers.
2. Implement the spec's precedence exactly: no owner cost is not applicable; valid fitness zero sets adjusted benchmark and multiplier to zero, full remaining cost, overall not-met, and unreachable additional plays; zero plays then produces zero modeled hours/multiplier and full remaining cost without duration or player count; ordinary positive-play calculation follows only with valid inputs.
3. Resolve modeled player count from the canonical Step 3 poll object without reparsing XML or reading compatibility `bestPlayerCount`/`bestPlayers`. Accept only exact positive safe-integer bucket labels with positive Best votes, ignore `N+` and invalid labels, choose the greatest Best vote count, average all distinct tied winning counts exactly, then fall back to the valid player-range midpoint. Attach poll state, source, observation time, tie/fallback details, all inputs, and only component-relevant stable reasons.
4. Calculate all formulas with Step 1 rationals. Compare exact values before display rounding, clamp remaining value at exact zero, and use exact ceiling for additional plays without a safe-integer ceiling assumption.
5. Produce required labels, adaptive multiplier precision when two decimals obscure status, two-decimal amount displays, sub-cent remaining display, and explicit assumptions/disclaimer data for clients.
6. Produce web sort projections: rounded-hundredths remaining key; finite, unreachable, unavailable, or not-applicable estimated-play category; finite whole-play key. Do not produce collection rank, interpretation, aggregate, or brief fields.

**Validation gate:**

- The `$60` canonical example returns 60 modeled player-hours, `$1.00` per modeled player-hour, `8.00x`, met, `$0.00` remaining, and 0 additional plays.
- The `$20` canonical example returns `0.80x`, `$4.00` remaining, and 1 additional play.
- Tests cover exact fitness scaling at 0, 1, 3, 6, 9, and 10; exact threshold, immediately below, and immediately above; values immediately below, at, and above `$0.005`; and adaptive precision.
- Additional-play tests cover exact, fractional, overshoot, and greater-than-`Number.MAX_SAFE_INTEGER` results without numeric coercion.
- Modeled-player-count tests cover one winner, distinct tied winners and exact average, duplicate buckets, `N+`, zero Best votes, every poll state, valid range fallback, invalid range, and no evidence while proving compatibility `bestPlayers` is not read or changed.
- Zero-play matrix tests vary missing/malformed fitness, benchmark, duration, and player count. Fitness-zero matrix tests prove the benchmark is `$0.00` without a configured benchmark and only additional plays are unreachable.
- Tests cover unknown/invalid acquisition, gift, zero purchase, missing/invalid benchmark, missing/invalid use evidence, and cost-per-recorded-play independence.
- Result snapshots contain the exact required labels and no resale, investment, buy, keep, sell, or avoid judgment.

## Step 5: Add daemon mutation APIs and final-fitness response assembly

**Files:**

- New `packages/daemon/src/services/purchase-utilization-service.ts`
- `packages/daemon/src/services/game-service.ts`
- `packages/daemon/src/routes/games.ts`
- New `packages/daemon/src/routes/collection.ts`
- `packages/daemon/src/app.ts`
- `packages/daemon/src/index.ts`
- `packages/daemon/src/operations.ts`
- `packages/daemon/tests/helpers/test-app.ts`
- New `packages/daemon/tests/services/purchase-utilization-service.test.ts`
- New `packages/daemon/tests/routes/collection.test.ts`
- `packages/daemon/tests/routes/games.test.ts`

**Changes:**

1. Add acquisition set/clear service methods that validate the shared input, preserve invalid raw data until correction succeeds, update timestamps, and save once. Zero remains a valid known purchase; unknown and gift are distinct states. If the normalized state is unchanged, preserve all timestamps and skip the write.
2. Add benchmark get/set/clear service methods on the collection. Clearing writes `null`; set requires a positive amount; repeated identical operations are no-ops. Do not store the benchmark in integration `config.json`.
3. Add the concrete acquisition and benchmark routes from the Decisions section and register operation/help metadata with stable validation error responses.
4. Define `GameWithPurchaseUtilization` separately from internal `GameWithScore`, with `displayScore: string | null`. Centralize list/detail response enrichment after actual/predicted score selection, niche annotation, and integrated redundancy adjustment. Add canonical `displayScore`, calculate utilization from that exact string, and include previously owned games.
5. Add the detail `includePredicted` query contract from the Decisions section. `false` returns actual fitness, `true` returns the prediction-enriched score when available, and both modes apply the same redundancy stage as their matching list branch before enrichment. Web detail and CLI `game value` request `true`; no client fetches a second prediction to replace the enriched response.
6. Log mutation attempts and outcomes with game/collection ID, state transition, changed field names, and validation codes. Log list/detail calculation outcome categories at the response boundary without logging entered amount values.

**Validation gate:**

- Route/service tests cover unknown, gift, zero purchase, positive purchase, correction from invalid, benchmark set/correct/clear, malformed input, missing game, and persistence failure with unchanged stored data. Repeated identical PUT/DELETE calls preserve confirmation, game, and collection timestamps and perform no write.
- Ordinary, predicted, tournament-influenced, vetoed, annotation-stage redundancy, and integrated redundancy tests prove utilization consumes `displayScore` from the same response and never feeds back into fitness. Include a raw integrated score such as `7.95` whose canonical display differs.
- Changing fitness or benchmark changes only derived response output; persisted acquisition and usage evidence remain unchanged.
- List/detail parity tests cover predicted on/off detail and the matching `/games` branch, redundancy enabled/disabled at annotation/integrated stages, ownership filters, previously owned games, and record-local expansion behavior.
- Type tests prove unrelated internal `GameWithScore` values and responses do not require or accidentally expose utilization.
- Operation discovery documents all new endpoints and stable error shapes.

## Step 6: Build web game-detail acquisition, utilization, and benchmark settings

**Files:**

- `packages/web/lib/api.ts`
- `packages/web/app/games/[id]/page.tsx`
- `packages/web/components/score-breakdown.tsx`
- New `packages/web/components/acquisition-form.tsx`
- New `packages/web/components/purchase-utilization-panel.tsx`
- New `packages/web/app/settings/page.tsx`
- New `packages/web/components/entertainment-benchmark-form.tsx`
- `packages/web/components/sidebar.tsx`
- `packages/web/app/globals.css`
- New `packages/web/tests/acquisition-form.test.tsx`
- New `packages/web/tests/purchase-utilization-panel.test.tsx`
- New `packages/web/tests/entertainment-benchmark-form.test.tsx`
- New `packages/web/tests/game-detail-utilization.test.tsx`

**Changes:**

1. Add typed daemon helpers for acquisition and benchmark reads/mutations without client-side amount arithmetic. Game detail requests `includePredicted=true` and stops making a separate prediction substitution.
2. Put the utilization panel before calculation details on game detail. Lead with met, not-met, unavailable, or not-applicable and then render independent values, evidence sources/times, missing reasons, actual-session disclaimer, and future-play assumption.
3. Add a focused acquisition form for unknown, gift, and purchase states. Preserve entered text on errors, distinguish zero from clear, allow correction of invalid persisted payloads, refresh server data after success, and use the lifetime landed-cost explanation.
4. Add `/settings#entertainment-benchmark` with set/correct/clear behavior, the fitness-6 definition, and the `$16 / 2 hours = $8 per person-hour` example. Link missing-benchmark explanations to this anchor.
5. Keep current fitness and benchmark language explicit for previously owned games. Do not add recommendations or historical-value claims.
6. Render nullable daemon `displayScore` in the detail hero and score-breakdown heading/table. Remove independent `toFixed(1)` formatting from enriched detail paths and include a decimal-half-up edge fixture where JavaScript `toFixed(1)` differs.
7. Preserve the existing responsive visual language and verify both new forms and the result hierarchy at narrow and desktop widths.

**Validation gate:**

- Component tests cover all acquisition/result states, exact required labels, zero-play explanations, veto behavior, source/time rendering, disclaimers, invalid-data correction, request payloads, and mutation failures.
- Benchmark tests cover positive set, correction, clear-to-unknown, zero/excess-precision rejection, movie-ticket explanation, and game-detail link target.
- Render tests prove game detail leads with outcome before arithmetic and web displays exactly the daemon-provided values.
- Browser smoke checks cover game detail and settings on mobile and desktop.
- Run `bunx tsc --noEmit -p packages/web/tsconfig.json` and `bun run --cwd packages/web build` in this step because root `typecheck` excludes web; do not defer web type failures to final validation.

## Step 7: Add deterministic utilization sorting to the web collection

**Files:**

- `packages/web/lib/collection-utils.ts`
- `packages/web/components/collection-table.tsx`
- `packages/web/tests/collection-table.test.ts`
- New `packages/web/tests/purchase-utilization-sorting.test.ts`

**Changes:**

1. Add built-in fields for Value Remaining and Estimated Additional Plays to Value Threshold, using only daemon-provided sort projections and labels.
2. Add dedicated comparators instead of forcing utilization categories through the generic nullable scalar path.
3. Sort remaining value by rounded hundredths. Treat zero-play and fitness-zero remaining values as calculated; exact zero and a sub-cent remainder share the zero key.
4. Sort estimated plays by finite/unreachable/no-sort-value category exactly as REQ-UTIL-36 specifies. Compare finite decimal integer strings exactly, including values above `Number.MAX_SAFE_INTEGER`. Keep unavailable and not-applicable results together at the end in both directions.
5. Apply ascending NFC-normalized code-point name and stable-ID tie-breaking in both primary directions. Implement the comparator by iterating Unicode code points, not UTF-16 code units, ordinary relational comparison, or locale-dependent `localeCompare`.
6. Show values or honest state labels in the selected score column without assigning purchase quality labels or changing default collection sort. Existing collection fitness cells render nullable `displayScore` from enriched list responses rather than formatting raw score independently.

**Validation gate:**

- Ascending and descending tests cover finite remaining values, rounded ties, exact-zero/sub-cent ties, zero-play, fitness-zero, finite additional plays, unreachable, unavailable, gifts, and zero-cost purchases.
- Tie tests cover NFC-equivalent names, BMP and supplementary-plane code-point ordering, equal names, stable IDs, and prove tie direction never reverses.
- Finite additional-play sort tests include values above `Number.MAX_SAFE_INTEGER` and prove no numeric coercion.
- Existing sort fields and stored sort-state behavior remain green.
- A production-code audit finds no aggregate, automatic rank, notability, judgment, or brief integration.

## Step 8: Add CLI acquisition, benchmark, and value commands

**Files:**

- `packages/cli/src/index.ts`
- `packages/cli/src/commands/game.ts`
- `packages/cli/src/commands/score.ts`
- New `packages/cli/src/commands/collection.ts`
- `packages/cli/src/commands/help.ts`
- `packages/cli/src/output.ts`
- `packages/cli/tests/index.test.ts`
- `packages/cli/tests/commands/game.test.ts`
- `packages/cli/tests/commands/score.test.ts`
- New `packages/cli/tests/commands/collection.test.ts`
- `packages/cli/tests/commands/help.test.ts`
- `packages/cli/tests/output.test.ts`

**Changes:**

1. Register and parse the concrete commands from the Decisions section. Keep amounts as strings through argument parsing so the daemon/shared parser remains authoritative and no precision is lost.
2. Implement acquisition state transitions and benchmark get/set/clear with actionable usage errors. Preserve complete daemon JSON under `--json`.
3. Render `game value` from the daemon utilization result with the same outcome, labels, values, reasons, evidence, observation times, and assumptions as web. It requests predicted detail mode to match web game detail.
4. Explain unknown, gift, zero-cost, missing benchmark, invalid persisted data, zero plays, and unreachable additional plays without adding judgment language.
5. Render nullable daemon `displayScore` in `game list`, `game value`, `score list`, and `score get` rather than formatting raw or redundancy-adjusted scores independently in command code or `output.ts`. Cover a decimal-half-up edge where JavaScript `toFixed(1)` differs.
6. Do not add CLI collection sorting in this release.

**Validation gate:**

- Parser/command tests cover every state/action, amount strings, missing/extra arguments, invalid amounts, request paths/methods/payloads, daemon errors, and human output.
- Human-output fixtures match web outcome semantics and required labels for both canonical examples and every special state.
- JSON output deep-equals the daemon response and retains exact values, reasons, sources, and observation times.
- Help documents implicit-currency amount semantics, lifetime landed cost, benchmark meaning, and all new commands without advertising collection sorts.

## Step 9: Complete persisted-flow, parity, and scope regression coverage

**Files:**

- New `packages/daemon/tests/integration/purchase-utilization-persisted-flow.test.ts`
- New `packages/daemon/tests/integration/purchase-utilization-response-parity.test.ts`
- New `packages/web/tests/purchase-utilization-parity.test.tsx`
- New `packages/cli/tests/purchase-utilization-parity.test.ts`
- `packages/daemon/tests/services/prediction-service.test.ts`
- `packages/daemon/tests/services/redundancy-integration.test.ts`
- `packages/daemon/tests/routes/games.test.ts`
- `packages/web/tests/collection-table.test.ts`
- `packages/cli/tests/commands/game.test.ts`

**Changes:**

1. Add one persisted end-to-end fixture that starts at schema version 2, migrates, records purchases and a benchmark, refreshes BGG evidence, computes ordinary and vetoed results, reloads, corrects malformed amount data, and confirms durable provenance.
2. Use shared canonical response fixtures in daemon, web, and CLI tests so clients cannot drift in labels, categories, exact values, or missing-reason interpretation.
3. Cover every AI Validation scenario from the source spec using the named evidence map below; update the map if implementation places a case elsewhere.
4. Audit production code for purchase-value input to fitness/prediction/profile, base-expansion joins, collection aggregation, automatic ordering/judgment, brief candidates, currency metadata/conversion, transaction history, and resale language. None may exist.
5. Verify collection sort behavior is web-only and does not alter daemon list order or CLI list behavior.

**Validation gate:**

- Persisted-flow tests prove migration, invalid recovery, correction, evidence freshness, recalculation, and reload are durable and idempotent.
- Web and CLI render the same daemon result for canonical, zero-play, vetoed, unavailable, gift, and zero-cost cases.
- Existing fitness, prediction, redundancy, profile, collection, BGG, and previously-owned suites remain green.
- The scope audit has no findings and all 36 requirements have named automated evidence.

## Step 10: Final validation against the approved specification

1. Run `bun run typecheck`, `bun run lint`, `bun run format:check`, `bun run test`, and `bun run build`.
2. Distinguish any repository-wide pre-existing formatting baseline from files changed by this implementation; all changed files must pass formatting.
3. Execute each item in the spec's AI Validation section and map it to passing automated evidence.
4. Inspect a migrated collection and malformed-amount fixture on disk, reload both, and verify current schema validation and correction behavior.
5. Exercise web acquisition, benchmark, value detail, and both collection sorts at mobile and desktop widths; exercise CLI acquisition, benchmark, and value commands in human and JSON modes.
6. Ask a fresh reviewer who has not read the Technical Contract to explain the benchmark, both canonical examples, value remaining, and additional plays from the user-facing implementation.
7. Ask a second fresh reviewer to map REQ-UTIL-1 through REQ-UTIL-36 to implementation and tests and to audit the deferred-scope boundary.
8. Mark this plan `executed` and the source spec `implemented` only after all gates pass.

## Dependency order

1. Steps 1 and 2 are additive, independently closable, and may proceed in parallel.
2. Step 3 depends on Steps 1 and 2 and is one coordinated schema-version cutover across frozen historical schemas, current shared types, migration, storage decoding, all game constructors, persistence, and fixtures.
3. Step 4 depends on Steps 1 and 3.
4. Step 5 depends on Step 4 and establishes the canonical daemon response and mutation contract.
5. Steps 6, 7, and 8 depend on Step 5. Web detail/settings, web sorting, and CLI can then proceed in parallel.
6. Step 9 depends on all client surfaces. Step 10 depends on Step 9.

Do not split the Step 3 schema migration from all required current-runtime fixture and creation-path updates. Do not begin client calculation or sorting before Step 5 makes the daemon response authoritative.

## Requirement coverage

| Requirement | Implementation steps | Primary validation                                          |
| ----------- | -------------------- | ----------------------------------------------------------- |
| REQ-UTIL-1  | 4, 5, 6, 8           | Canonical and outcome-state engine/API/client tests         |
| REQ-UTIL-2  | 4, 6, 8              | Positive-play, zero-play, and fitness-zero snapshots        |
| REQ-UTIL-3  | 1, 4                 | Exact boundary and adaptive-precision tests                 |
| REQ-UTIL-4  | 4, 6, 8              | Independent cost-per-play tests with missing modeled inputs |
| REQ-UTIL-5  | 4, 6, 8, 9           | Shared label fixtures and client parity tests               |
| REQ-UTIL-6  | 1, 4                 | Exact clamp and sub-cent remaining tests                    |
| REQ-UTIL-7  | 1, 4                 | Exact ceiling and overshoot tests                           |
| REQ-UTIL-8  | 4, 6, 8              | Met-result `$0.00` and zero-additional-play tests           |
| REQ-UTIL-9  | 4, 5                 | Fitness-zero precedence and final-fitness route tests       |
| REQ-UTIL-10 | 3, 5, 6, 8           | Benchmark persistence and mutation tests                    |
| REQ-UTIL-11 | 6, 8                 | Settings/help explanation snapshots                         |
| REQ-UTIL-12 | 1, 4                 | Exact linear fitness-scale tests                            |
| REQ-UTIL-13 | 6, 8                 | Movie-ticket example rendering tests                        |
| REQ-UTIL-14 | 5, 9                 | Ordinary/predicted/redundancy response tests                |
| REQ-UTIL-15 | 4                    | Benchmark-independent fitness-zero tests                    |
| REQ-UTIL-16 | 5, 9                 | Recalculation without persisted input mutation              |
| REQ-UTIL-17 | 3, 5, 6, 8           | Acquisition union and correction flow tests                 |
| REQ-UTIL-18 | 3, 6, 8              | Lifetime landed-cost copy and cumulative amount persistence |
| REQ-UTIL-19 | 4                    | Zero-play input matrix                                      |
| REQ-UTIL-20 | 2, 3, 4              | Positive-use validity and fitness-zero exception tests      |
| REQ-UTIL-21 | 3, 4, 6, 8           | Gift and zero-cost not-applicable tests                     |
| REQ-UTIL-22 | 1, 3, 9              | Implicit-currency schema and no-currency scope audit        |
| REQ-UTIL-23 | 2, 3, 4, 6, 8        | Provenance round-trip and input rendering tests             |
| REQ-UTIL-24 | 4, 6, 8              | Actual-session disclaimer snapshots                         |
| REQ-UTIL-25 | 4, 6, 8              | Future-play assumption snapshots                            |
| REQ-UTIL-26 | 6, 8, 9              | Copy and scope audit                                        |
| REQ-UTIL-27 | 6, 7, 8, 9           | Recommendation-language audit                               |
| REQ-UTIL-28 | 4, 5, 9              | Record-local expansion tests and join audit                 |
| REQ-UTIL-29 | 5, 9                 | Fitness dependency and production-code audit                |
| REQ-UTIL-30 | 7, 9                 | Web-sort-only and no-aggregate/brief audit                  |
| REQ-UTIL-31 | 6, 8                 | Result-first detail and CLI output tests                    |
| REQ-UTIL-32 | 5, 6, 8              | Equivalent web/CLI mutation flows                           |
| REQ-UTIL-33 | 3, 5, 6, 8           | Clear-to-unknown versus zero tests                          |
| REQ-UTIL-34 | 4, 5, 6, 8, 9        | Canonical daemon fixture parity                             |
| REQ-UTIL-35 | 4, 7                 | Rounded-hundredths web sort tests                           |
| REQ-UTIL-36 | 4, 7                 | Category, NFC code-point, and stable-ID sort tests          |

## AI Validation evidence map

| Spec validation                         | Planned automated evidence                                                                            |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 1. Repository gates                     | Step 10 root commands plus Step 6 web TypeScript/build commands                                       |
| 2. `$60` canonical example              | `packages/shared/tests/purchase-utilization.test.ts`; daemon/web/CLI parity tests                     |
| 3. `$20` canonical example              | `packages/shared/tests/purchase-utilization.test.ts`; daemon/web/CLI parity tests                     |
| 4. Fitness scaling                      | `packages/shared/tests/purchase-utilization.test.ts`                                                  |
| 5. Exact threshold and sub-cent display | `packages/shared/tests/exact-rational.test.ts`, `amount.test.ts`, and `purchase-utilization.test.ts`  |
| 6. Additional-play ceiling              | `packages/shared/tests/purchase-utilization.test.ts`                                                  |
| 7. Zero-play matrix                     | `packages/shared/tests/purchase-utilization.test.ts`                                                  |
| 8. Acquisition and benchmark states     | `packages/shared/tests/purchase-utilization.test.ts`; daemon service/route tests                      |
| 9. Fitness variants                     | `packages/daemon/tests/integration/purchase-utilization-response-parity.test.ts`                      |
| 10. Player-count evidence               | Existing parser bucket tests plus `packages/shared/tests/purchase-utilization.test.ts` resolver tests |
| 11. Amount parsing/storage              | `packages/shared/tests/amount.test.ts`; migration/storage tests                                       |
| 12. Provenance round-trip               | `packages/daemon/tests/integration/purchase-utilization-persisted-flow.test.ts`; web/CLI parity tests |
| 13. Web sorting                         | `packages/web/tests/purchase-utilization-sorting.test.ts`                                             |
| 14. Deferred-scope exclusion            | Step 9 production-code audit and regression suites                                                    |
| 15. Fresh explanation review            | Step 10 fresh user-facing reviewer                                                                    |

## Risks and review notes

- **Final fitness is currently assembled in multiple paths:** utilization must be added after prediction and redundancy in one canonical response helper, or web detail, web list, and CLI can disagree.
- **Malformed current-version data needs a deliberate boundary:** strict runtime schemas should remain strict. Only the storage decoder may preserve malformed amount payloads as invalid variants.
- **Field freshness is independent:** thing metadata and public collection plays come from separate requests. Never refresh one field's observation time because another request succeeded.
- **Suggested-player buckets already exist:** enrich and migrate the existing bucket list into one canonical poll object rather than adding utilization-owned buckets. Keep utilization resolution separate from compatibility `bestPlayerCount`/`bestPlayers` behavior unless all other consumers and tests are intentionally migrated.
- **Exact arithmetic and JSON conflict:** internal `bigint` must not leak into Hono responses, Next.js props, logs, or CLI JSON.
- **Result components are intentionally partial:** missing modeled-use data must not suppress a valid cost per recorded play, zero-play remaining value, or fitness-zero result.
- **Sort direction does not reverse ties:** dedicated utilization comparators must not inherit the generic comparator's direction multiplier for name and ID tie-breakers.
- **Fixture surface is broad:** schema version 3 makes new fields required. Update typed fixtures as part of the cutover without unrelated fixture refactors.

## Fresh-eyes review

The first review found that raw integrated fitness could differ from the one-decimal value clients display, the original schema/evidence step order was not independently closable, historical migration schemas inherited current schemas, malformed legacy evidence was underspecified, and adding utilization directly to `GameWithScore` would overreach unrelated paths. It also found gaps around JSON-safe invalid payloads, double-fetched import provenance, whole-play overflow, repeated PUT idempotency, true Unicode code-point comparison, the half-cent boundary, and web type checking.

This revision adds one canonical `displayScore`, makes BGG request observations additive before the version-3 cutover, freezes every historical schema, defines valid/missing/invalid evidence and JSON-safe raw envelopes, introduces `GameWithPurchaseUtilization`, preserves initial import observations, serializes unbounded whole values as decimal strings, makes identical mutations no-ops, requires code-point iteration, pins `$0.005`, and adds a web build gate.

The second review found a contradiction between malformed-field preservation and byte equivalence, an undefined actual/predicted detail mode, incomplete display-score consumer coverage, unnamed test ownership, and no executable web type command. This revision limits byte equivalence to valid fields, names each malformed evidence destination, defines `includePredicted` detail parity, enumerates web/CLI display consumers and concrete tests, maps all AI Validation scenarios, and names both web validation commands. A final review must verify these corrections before implementation begins.

The final verification found only that CLI `score list/get` also consume enriched game responses and independently format scores. Step 8 now includes both commands and their tests in the canonical nullable `displayScore` cutover. No reviewer found a remaining requirement omission, contradictory dependency, migration blocker, or deferred-scope leak.

Owner review then identified that Step 2 could be read as introducing suggested-player buckets that already exist. The revised plan makes `BggGameData.suggestedPlayerCounts` the explicit starting point, extracts each poll once, keeps parser output factual, migrates the buckets to one canonical poll object without a duplicate utilization copy, preserves compatibility best-player behavior, and moves all utilization-specific eligibility/tie/fallback rules into Step 4.
