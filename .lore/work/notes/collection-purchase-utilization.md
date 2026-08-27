---
title: "Implementation notes: collection purchase utilization"
date: 2026-08-26
status: in_progress
tags: [implementation, purchase-utilization, exact-arithmetic]
source: .lore/work/plans/collection-purchase-utilization.md
modules: [shared, daemon, web, cli]
---

# Implementation notes: collection purchase utilization

## Progress

- [x] Step 1: Add exact rational and amount primitives (`shelf-judge-mmr.7`)
- [x] Step 2: Capture trustworthy BGG observations (`shelf-judge-mmr.13`)
- [x] Step 3: Introduce schema version 3 (`shelf-judge-mmr.5`)
- [x] Step 4: Implement purchase utilization engine (`shelf-judge-mmr.14`)
- [x] Step 5: Add daemon APIs and response assembly (`shelf-judge-mmr.12`; terminal acceptance `ACCEPTED`)
- [x] Step 6: Build web detail and settings (`shelf-judge-mmr.11`; Beads `CLOSED`)
- [x] Step 7: Add deterministic web sorts (`shelf-judge-mmr.10`; terminal acceptance `ACCEPTED`)
- [x] Step 8: Add CLI commands (`shelf-judge-mmr.8`; terminal acceptance `ACCEPTED`)
- [ ] Step 9: Complete persisted-flow and parity coverage (`shelf-judge-mmr.9`)
- [ ] Step 10: Run final validation (`shelf-judge-mmr.6`)

## Step 1 Evidence Map

| Obligation                                                                                                               | Implementation surface                                     | Executable validation                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Normalized signed exact rationals with decimal parsing, arithmetic, comparison, maximum, ceiling, and half-up rounding   | `packages/shared/src/exact-rational.ts`                    | Rational unit tests covering normalization, negative subtraction, exact comparison/ceiling, division errors, and rounding boundaries |
| Canonical one-decimal fitness projection from a base-10 score representation                                             | `packages/shared/src/exact-rational.ts` and shared exports | Tests for zero, one, and two decimal places including `7.95 -> 8.0`                                                                  |
| Exact amount input represented as safe integer hundredths, accepting zero through two fractional digits without rounding | `packages/shared/src/amount.ts`                            | Amount parser tests for valid forms, malformed syntax, excess precision, maximum safe hundredths, and overflow                       |
| Two-decimal dollar display, positive sub-cent display, and rounded-hundredths sort keys                                  | `packages/shared/src/amount.ts`                            | Tests immediately below, at, and above `$0.005`, plus exact zero                                                                     |
| JSON-safe exact projection and exact canonical unsigned-decimal-string validation/comparison                             | Shared primitives and exports                              | Tests on both sides of `Number.MAX_SAFE_INTEGER`; no numeric coercion or exported `bigint` payload                                   |
| Shared package quality                                                                                                   | All changed Step 1 files                                   | Shared tests, changed-file formatting, ESLint, and shared/root type checking                                                         |

## Log

### 2026-08-26

- Claimed `shelf-judge-mmr.7`, the first dependency-root implementation bead.
- No plan task files or project-specific lore-agent registry exist, so the approved plan step is the phase boundary and general agents provide implementation, testing, and review roles.
- Lore research found no canonical reference entry. The approved purchase-utilization spec and plan control the implementation.
- Deliberate primitive contracts required by the artifacts: reject zero denominators and division by zero; canonical unsigned decimal strings are `0` or a nonzero digit followed by digits, with no leading zeros.
- Step 1 implementation changed only the planned shared source, export, and test files.
- Step 1 local gate passed: 20 focused tests, changed-file Prettier and ESLint, shared TypeScript, and root type checking.
- Fresh-context initial review found no non-conformances. Residual test opportunities are nested JSON-boundary serialization, a nonzero whole-cent half-up example, and broader signed multiplication/division/max cases; existing exact primitive behavior and types cover the approved gate.
- Terminal acceptance review reconciled every Step 1 obligation, ran the complete shared suite (241 passing), root ESLint, a public-barrel smoke check, and accepted the phase with no material findings.
- Closed `shelf-judge-mmr.7` after acceptance.
- Began Step 2 under `shelf-judge-mmr.13`. The additive implementation preserves the persisted schema and carries factual request observations through parser, client, game-service, prediction, refresh, and import paths.
- Step 2 behavioral validation is green: the focused parser/client/game-service set reached 59 passing tests with one skip, prediction-flow evidence passes, and the wider daemon suite reached 1001 passing tests with one skip.
- Review findings `BGG-REV-1` (untrusted secondary import overwrite) and `BGG-REV-2` (overclaimed XML fields) are corrected and verified.
- `BGG-REV-3` added structured attempt/outcome logging and its behavior tests pass, but remains blocked after two lint correction attempts. Current failure: `packages/daemon/tests/services/bgg-client.test.ts:127` reports `@typescript-eslint/no-unsafe-argument` in the typed structured-log assertion. Per the implementation escalation rule, no third correction was attempted.
- Owner authorized continued correction. The logger payload is now narrowed from `unknown` and asserted field-by-field; the lint blocker closed.
- Subsequent verification corrected malformed/empty XML presence, exact unique requested-ID coverage, duplicate response handling, and positive/negative classification coverage across enrichment, metadata, and collection seams.
- Step 2 final gate passed: 103 focused tests with one baseline skip, 1026 daemon tests with one baseline skip, changed-file Prettier and ESLint, shared/daemon/root TypeScript, diff checks, and persisted-schema scope checks.
- Terminal acceptance reconciled every Step 2 obligation and accepted the phase with no material findings. The existing skipped fetch-timeout suite remains the only residual test risk.
- Step 3 cut over persistence to schema version 3 with frozen historical schemas, strict acquisition/benchmark/evidence contracts, canonical suggested-player polls, tolerant load-boundary normalization, and updated constructors and fixtures.
- Review corrections addressed partial range preservation, refresh evidence idempotence, historical best-player fallback fidelity, malformed live poll/play evidence, strict-safe compatibility projections, and semantic poll states. Additional test-only permutations were treated as non-blocking unless they protected distinct behavior.
- Step 3 final gate passed: 340 focused tests with one baseline skip, 245 shared tests, 1060 daemon tests with one baseline skip, 65 web collection tests, root typecheck, changed-file ESLint/Prettier, notes formatting, and diff checks.
- Installed Bun was `1.3.11` while the repository declares `1.4.0`; no observed failure was version-related.
- Beads confirms Step 4 (`shelf-judge-mmr.14`) is closed with its shared engine and result contract validated, correcting the stale unchecked progress entry above.
- Step 5 defines `GameWithPurchaseUtilization` as the only response carrying `displayScore` and `purchaseUtilization`; persisted `Game`/`Collection`, internal `GameWithScore`, score endpoints, and mutation responses remain unenriched.
- Mutation requests use strict shared Zod schemas and exact `parseAmountInput`. The daemon service validates before taking a clock value, clones collections before changes, saves once, and returns without a clock or write for normalized no-ops.
- Game response assembly now selects actual or predicted records first, computes niche annotations from the owned predicted universe, applies redundancy without re-sorting, then enriches from one benchmark read. Detail uses the same assembly path as its matching list mode; previously owned records remain outside niche/redundancy universes while still receiving utilization.
- Canonical display projection happens once after final fitness settles. The shared calculation receives that exact nullable one-decimal string, including `7.95 -> 8.0`; no derived utilization data is persisted or fed back into fitness.
- Focused Step 5 tests passed: 44 service/game/collection tests. Adjacent response/discovery regression tests passed: 64 prediction, ownership, niche, redundancy, and help tests. Shared and daemon TypeScript passed before final formatting; broader post-format validation is recorded below.
- The first full-suite run exposed two dependency-minimal dimensions route tests whose mock could only serve `getGame`, not enumerate `listGames`. A temporary legacy detail path preserved those tests; correction round 3 removed that exception and updated the mock to exercise the common enriched assembly path.
- Independent testing reported blocking finding `STEP5-LOG-001`: benchmark mutation logs omitted the collection ID and prior/next semantic states. The correction adds safe collection-scoped transition logs, stable service rejection codes, changed fields, explicit persistence attempt/outcome events, and changed/unchanged mutation outcomes without logging entered or persisted amounts.
- The correction round converted remaining inspection-only acceptance areas into executable tests for benchmark persistence failure, tournament-influenced and vetoed final fitness, fitness-only recalculation with stable persisted inputs, integrated redundancy list/detail utilization parity, record-local base/expansion calculations, and aggregate response-log shape/redaction.
- Fresh review correction round 2 addressed `SJ-MMR12-001` through `SJ-MMR12-004`. The single purchase-utilization service instance now serializes its complete mutation load/clone/save cycles through a rejection-safe promise queue, preventing acquisition/acquisition and benchmark/acquisition lost updates without changing unrelated repository writers.
- Detail `includePredicted` now strictly accepts omitted, `true`, or `false` and returns stable code `invalid_include_predicted` otherwise. List parsing intentionally retains its existing loose semantics because the approved plan names the strict contract for detail while describing list behavior as the compatibility baseline; changing list rejection behavior would be an unplanned compatibility change.
- HTTP mutation validation now logs safe attempts and rejected outcomes with stable target IDs, requested semantic state, changed fields, and validation codes. Acquisition service persistence has separate attempt/completed/failed events, while route-level failures distinguish not-found, validation, and persistence outcomes. Route tests pass one injected logger through the HTTP and service seams and prove amount redaction.
- Operation metadata gained optional accepted-value and stable-error declarations. Existing operation definitions and consumers remain valid, while `/api/help` now exposes the detail query values and new-route validation response codes/shapes.
- Fresh review correction round 3 addressed `SJ-MMR12-ACC-001`, `SJ-MMR12-API-002`, and `SJ-MMR12-DISC-003`. Both service mutation methods now accept `unknown` and apply the exported strict shared schemas before queueing or any collection load, clock, or save effect; coded `PurchaseUtilizationValidationError` failures remain stable if the service is called without HTTP validation.
- `createGameRoutes` now requires an injected `PurchaseUtilizationService`, no longer constructs one conditionally, and has no plain `GameWithScore` list/detail fallback. All production and direct test compositions inject a real service, and the former dependency-minimal dimensions detail tests now assert the enriched response contract.
- Operation discovery now carries a JSON-safe request body contract separately from internal Zod schemas. `/api/help` describes strict unknown-key handling, all three acquisition alternatives and amount conditions, the benchmark's positive exact amount contract, detail `includePredicted` values, and additive `message`/`details` error fields.
- The user explicitly authorized correction round 4, limited to unresolved `SJ-MMR12-DISC-003`. Acquisition discovery now publishes three independently strict JSON Schema object branches, so each branch declares its own properties and `additionalProperties: false` instead of combining branch properties with a contradictory top-level restriction. Benchmark discovery remains a strict object and its amount pattern now excludes zero-valued decimals.
- Correction round 4 inventories every affected runtime error. Game detail publishes coded 400/404/500 responses; acquisition publishes both coded 400 variants plus coded 404/500 responses; benchmark GET, PUT, and DELETE publish their internal failures in addition to PUT validation. Targeted generic failures now return the stable redacted body `{ error: "Internal server error", code: "internal_error" }`, and game misses add `game_not_found` without changing their existing error text.
- Semantic help tests execute the published JSON Schema subset against valid and invalid acquisition/benchmark examples, including strict-property, conditional-amount, positivity, and maximum-safe-hundredths boundaries. Route parity tests force every documented validation, not-found, and internal branch and verify status/code and response-field parity with operation metadata.
- Terminal review accepted Step 5 after correction round 4. Status: `ACCEPTED`. Step 5 unlocks the pending web detail/settings, deterministic sort, and CLI child work; Steps 6 through 10 remain pending.
- Beads confirms Step 6 (`shelf-judge-mmr.11`) is closed after its web detail/settings implementation, tests, responsive smoke validation, and fresh review. The stale unchecked Step 6 progress entry is corrected above.
- Step 7 implementation adds only the two approved web collection sort fields. Dedicated comparators consume daemon `purchaseUtilization.sort` projections, use the shared exact unsigned-decimal comparator, and apply ascending NFC-normalized Unicode code-point name and stable-ID ties independently of primary direction.
- Collection list API, prediction, niche merge, table, row, and sorting utility types now retain `GameWithPurchaseUtilization`. Selected utilization cells render daemon component display labels, and collection fitness cells render nullable daemon `displayScore` rather than formatting raw final fitness.
- Step 7 local validation passed: 77 focused collection/sorting tests and the complete 185-test web suite; web production TypeScript, changed-file ESLint and Prettier, and the Next production build also pass. The repository's test-only web TypeScript config still reports unrelated pre-existing fixture errors in `axes-page-curve.test.ts`, `game-links.test.tsx`, and `shelf-assignment.test.tsx`; it reports no Step 7 file error.
- Independent testing and terminal review reconciled the Step 7 behavior and accepted the five-path product manifest below with no material findings. Terminal acceptance: `ACCEPTED`.
- Step 7 has no unresolved acceptance finding. Residual risks are limited to the known test-only TypeScript fixture baseline and the installed Bun version mismatch recorded below; neither produced a Step 7 diagnostic or observed failure.

## Step 1 Accepted Manifest

Porcelain status at acceptance:

```text
 M .beads/issues.jsonl
 M packages/shared/src/index.ts
?? .lore/work/notes/collection-purchase-utilization.md
?? packages/shared/src/amount.ts
?? packages/shared/src/exact-rational.ts
?? packages/shared/tests/amount.test.ts
?? packages/shared/tests/exact-rational.test.ts
```

The tracker export and this resumable notes file are workflow artifacts outside the accepted product-code surface. Product paths record index and working-tree identity separately:

| Path                                           | Index state                                | Working-tree SHA-256                                               |
| ---------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------ |
| `packages/shared/src/exact-rational.ts`        | absent                                     | `90676c70d08768e627e93693fd42eafeb5be3dc835008b71060d767767df5c2e` |
| `packages/shared/src/amount.ts`                | absent                                     | `5e796580cbda0bcfe7fc0e162c44923e8d202d06faf3b2ca51936f217c69d7a4` |
| `packages/shared/src/index.ts`                 | `5d33c7c8a33ff77acabd187815fc771029f3ff05` | `f36001568cdfc18c8d84b8ffec9302cbd14b3a8aadae680f58572cf622c7aa08` |
| `packages/shared/tests/exact-rational.test.ts` | absent                                     | `d4899e209584257230b9adcae137cc53ac2bffdcc155ae9e22d971ee7d22b28b` |
| `packages/shared/tests/amount.test.ts`         | absent                                     | `adb11c4f7c6941e4f340ba7830e12d73a4b7f4172d49bf69b96f6cbce6b83ff9` |

## Step 2 Accepted Manifest

Porcelain status at acceptance includes the accepted Step 1 surface and workflow artifacts:

```text
M  .beads/interactions.jsonl
M  .beads/issues.jsonl
A  .lore/work/notes/collection-purchase-utilization.md
MM packages/daemon/src/services/bgg-client.ts
MM packages/daemon/src/services/bgg-xml-parser.ts
M  packages/daemon/src/services/game-service.ts
M  packages/daemon/src/services/prediction-service.ts
MM packages/daemon/tests/services/bgg-client.test.ts
MM packages/daemon/tests/services/bgg-xml-parser.test.ts
M  packages/daemon/tests/services/game-service-bgg.test.ts
M  packages/daemon/tests/services/prediction-service.test.ts
A  packages/shared/src/amount.ts
A  packages/shared/src/exact-rational.ts
M  packages/shared/src/index.ts
M  packages/shared/src/types.ts
A  packages/shared/tests/amount.test.ts
A  packages/shared/tests/exact-rational.test.ts
```

Step 2 product paths record index and working-tree identity separately:

| Path                                                        | Index blob                                 | Working-tree SHA-256                                               |
| ----------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------ |
| `packages/shared/src/types.ts`                              | `0e2a4aa1d3f0c5af4bbf22c05210752c401a9449` | `cd2be9c4d80bf11ecffaf2a2025ad520287ba737cbe80f71ce6ad9c26a64e311` |
| `packages/daemon/src/services/bgg-xml-parser.ts`            | `a94e476c5f595181cf8f2e02b2848e213a227c0f` | `93e7993c3df1878e5f7f11378f3ee84d73b879da75868d3bb9d214105471854b` |
| `packages/daemon/src/services/bgg-client.ts`                | `63a5aaaf921087b49b3b056326af7a152f368167` | `1d00a0941abbc46b79eebdb2b681b2b41f348c0ec9cb0758ac92f3ae20cd4e7a` |
| `packages/daemon/src/services/game-service.ts`              | `0df1745e1fc5a761e6e18343a39cacdb795ae18e` | `4eff81de9d5567d68aac405ae073e3222ac36d05c6b7a1c0f6dc62938eaa0966` |
| `packages/daemon/src/services/prediction-service.ts`        | `37979d5bffd3d339ca077036fe3a2fd5c6311c9a` | `0b5933647e385714f5536f455bb9dd0f51fb34ac662060a6c734209ffe1db03e` |
| `packages/daemon/tests/services/bgg-xml-parser.test.ts`     | `689adfa6a468afa9a4fb08a5465855969220d4d2` | `d96c4d7c99361b6d93965b9569b35b542fbafdf368199d31830ae71daa009fd8` |
| `packages/daemon/tests/services/bgg-client.test.ts`         | `a97acb0e996c3e8e0ecb4ca1cf9dd8249817f8ba` | `b4fcba33a110b18f6aba26f2069b12b8146f4bf09b93b9e0b024a8f23fa027dc` |
| `packages/daemon/tests/services/game-service-bgg.test.ts`   | `c61f4133ef0269c04cd46f4194cfe87160e6ba2f` | `ce0a2a5250baea56c1986c96f8ff68368ad7165be679250c5c3ea531df5d6f81` |
| `packages/daemon/tests/services/prediction-service.test.ts` | `b2618cb2beecbec3b4768c7c7f2525c77c6aa2bd` | `756031c7985453122c49d9fdd936c4ed28134dfaafbb0e3e826fbc3a85c8b6d6` |

## Step 5 Evidence Map

| Obligation                                                  | Implementation surface                                                                  | Executable validation                                                                                                                                                     |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Separate enriched response and strict mutation contracts    | `packages/shared/src/types.ts`, `packages/shared/src/validation.ts`, and shared exports | Route/type checks prove enriched list/detail responses are additive while rating responses remain unenriched; direct malformed service calls prove zero pre-parse effects |
| Copy-on-write acquisition and benchmark mutations           | `packages/daemon/src/services/purchase-utilization-service.ts`                          | Service tests cover every state, invalid correction, exact amount parsing, no-op timestamps/writes, one clock value, missing games, persistence failure, and safe logs    |
| Acquisition and benchmark HTTP boundaries                   | `packages/daemon/src/routes/games.ts` and `packages/daemon/src/routes/collection.ts`    | Route tests cover malformed JSON, strict discriminated bodies, zero purchase, positive benchmark, precision/overflow, stable validation codes, and discovery metadata     |
| Final-fitness enrichment                                    | `packages/daemon/src/services/purchase-utilization-service.ts`                          | Service tests prove `7.95 -> 8.0`, null fitness, exact `displayScore` consumption, no fitness feedback, benchmark recalculation, and no persisted derived data            |
| Actual/predicted, niche, redundancy, and ownership assembly | `packages/daemon/src/routes/games.ts`                                                   | Game, prediction, ownership, niche, and redundancy suites cover list/detail parity, both prediction modes, annotation/integrated stages, and previously owned isolation   |
| Production and test registration                            | `packages/daemon/src/app.ts`                                                            | Collection route/help tests exercise the same `createApp()` composition used by production and `createTestApp()`                                                          |
| Service-boundary logging                                    | Purchase service plus mutation routes                                                   | Tests inspect safe structured logs; mutation logs omit entered/stored amounts and enrichment logs aggregate outcome categories                                            |

## Step 5 Accepted Product Manifest

Terminal review accepted exactly these 19 product and test paths:

```text
packages/shared/src/types.ts
packages/shared/src/validation.ts
packages/shared/src/index.ts
packages/daemon/src/services/purchase-utilization-service.ts
packages/daemon/src/routes/collection.ts
packages/daemon/src/routes/games.ts
packages/daemon/src/app.ts
packages/daemon/src/operations.ts
packages/daemon/tests/services/purchase-utilization-service.test.ts
packages/daemon/tests/routes/collection.test.ts
packages/daemon/tests/routes/games.test.ts
packages/daemon/tests/routes/prediction.test.ts
packages/daemon/tests/routes/help.test.ts
packages/daemon/tests/redundancy-integration.test.ts
packages/daemon/tests/dimensions-routes.test.ts
packages/daemon/tests/niche-settings-integration.test.ts
packages/daemon/tests/ownership-routes.test.ts
packages/daemon/tests/wishlist-routes.test.ts
packages/daemon/tests/helpers/test-app.ts
```

Current accepted product identities:

| Path                                                                  | Porcelain | Index blob or marker                       | Working-tree SHA-256 or marker                                     |
| --------------------------------------------------------------------- | --------- | ------------------------------------------ | ------------------------------------------------------------------ |
| `packages/shared/src/types.ts`                                        | ` M`      | `4873bc5753b1b7481a96a2050818982f4b9cc4ac` | `b7e92153a7194db4c5828f867c0101fb1f073af5ea358e382ac6a53fe7c69fd9` |
| `packages/shared/src/validation.ts`                                   | ` M`      | `19173e1caa125b15f853d207e27743c13dc15469` | `908d737d21abc5dd6feda9057e13defd5b03bd5f37b684399ae5675064e04c1a` |
| `packages/shared/src/index.ts`                                        | ` M`      | `abb75b39d7506fd2c171403dda2f038a76f2c4d5` | `a89a57d43283c51ee2282bbda342b89469e0854e42758c983c921a579b0d2322` |
| `packages/daemon/src/services/purchase-utilization-service.ts`        | `??`      | absent                                     | `e85fb0ec15ea783f73c469180a05823142ae8c7d602cd7337380c61b1e859b53` |
| `packages/daemon/src/routes/collection.ts`                            | `??`      | absent                                     | `1a5410b85e7e920b45705e518c0ed98084d22db1990f5d1517cea0a4ca6dbe32` |
| `packages/daemon/src/routes/games.ts`                                 | ` M`      | `aa7e95145828c1ed1ac10f7bccc11ba4a99da6d3` | `a991995fbb567c056efc6330cb743fbc9444097d917c9ab2159bea9afeab4969` |
| `packages/daemon/src/app.ts`                                          | ` M`      | `93375e882717b55cfd1478e1d0c1bb4408d2f48e` | `5f15e1a40ecbac353c56456954ba8f11bf1a76b4e25d401ec501c4d256931f3e` |
| `packages/daemon/src/operations.ts`                                   | ` M`      | `274a4de77111d4d439c7143945577bf221177b4b` | `32bfe4af4d1e2aa4ef25064977167d7b57c88ebbd3cde6c3093b2d1de17d7e93` |
| `packages/daemon/tests/services/purchase-utilization-service.test.ts` | `??`      | absent                                     | `f12d02f18b0db69cd6c5614a14c33c48d367186e9e59b3e97a516600980a8cc1` |
| `packages/daemon/tests/routes/collection.test.ts`                     | `??`      | absent                                     | `727321b5bea5f06d1700ad5083c044480b3842d54744028242684a23a27e04b9` |
| `packages/daemon/tests/routes/games.test.ts`                          | ` M`      | `56debe1b4b4537af5e2101e1f74490175237638a` | `0a55c7d0a8e4f2b86affd102e5d76dbeeba9fd6da9bb2db8c2aa074ced46975d` |
| `packages/daemon/tests/routes/prediction.test.ts`                     | ` M`      | `1a63e7f5d958b33f8793faeb2575dbb9c8445962` | `654c491729e3d1e36b3e32ab57694b63add2d2aa771b1160330d98da060d3137` |
| `packages/daemon/tests/routes/help.test.ts`                           | ` M`      | `b9527476e0d47c2c6d513202b03c913302ff56b2` | `4e926e1ec98bd96ac58c2cd6ea0ea979facfb4c879a1c3beccfdac29e1be5a90` |
| `packages/daemon/tests/redundancy-integration.test.ts`                | ` M`      | `a0e77c1aff8d8475f65e86db7fe4f92ba38702ee` | `eff52bf2110b65de83864f1bd26e67f99c805565df15f195d8382b2bd61d0ba5` |
| `packages/daemon/tests/dimensions-routes.test.ts`                     | ` M`      | `904e5bf2b67592293dd28040b97810c81989d604` | `041dc0d381f0817ab57220518ea0441c52f35e130a1accc8a7dc780d85bc996d` |
| `packages/daemon/tests/niche-settings-integration.test.ts`            | ` M`      | `30a5181bc66aec8a274daeefda59163c39f4a7f8` | `1c84637bd0c51b71052d7bc4526b612d6b46bcd75120c68910de156bad91ceec` |
| `packages/daemon/tests/ownership-routes.test.ts`                      | ` M`      | `b8ff3d7ba8d32a824682c22e93da3233eff7cf14` | `0cfc34861e97a1078c3fda69e7efce9d264ab240d85e430a501453d9eebc84f7` |
| `packages/daemon/tests/wishlist-routes.test.ts`                       | ` M`      | `e63e751a789f7a29bc5f5916f9a519cd388311a6` | `20dc0788f7b389c0ddfe8abce9a0fbc9c8dd89046d5c7c32af15395cbd36fc46` |
| `packages/daemon/tests/helpers/test-app.ts`                           | ` M`      | `5918506a0ad96b51287ac4a846be20ff3a9bd0b9` | `883a8cfcec0f1b78b3addacc3b361b80de71441a37563ff3f24b1dd5cef38940` |

`packages/daemon/src/index.ts` did not require edits. No accepted product path is deleted or unmerged.

### Workflow Status

Workflow files are deliberately excluded from the accepted product manifest and content hashing above:

```text
 M .beads/issues.jsonl
 M .lore/work/notes/collection-purchase-utilization.md
```

These statuses are reported for worktree completeness only. Neither file is a Step 5 product acceptance artifact, and this notes file is not self-hashed.

## Step 5 Acceptance Findings

| Finding             | Resolution status | Accepted resolution                                                                                                                                |
| ------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STEP5-LOG-001`     | Resolved          | Benchmark logs carry collection identity, semantic transitions, changed fields, persistence attempt/outcome, and safe rejection codes.             |
| `SJ-MMR12-001`      | Resolved          | A rejection-safe service-local queue serializes complete mutation load/clone/save cycles and prevents lost updates.                                |
| `SJ-MMR12-002`      | Resolved          | Detail `includePredicted` strictly accepts omitted, `true`, or `false` with a stable coded error for other values.                                 |
| `SJ-MMR12-003`      | Resolved          | HTTP and service persistence seams expose safe attempt, success, rejection, and failure logging without amount leakage.                            |
| `SJ-MMR12-004`      | Resolved          | Operation metadata exposes accepted query values and stable error declarations without breaking existing operation consumers.                      |
| `SJ-MMR12-ACC-001`  | Resolved          | Direct service mutations apply shared strict schemas before queueing, load, clock, or save effects and return stable validation codes.             |
| `SJ-MMR12-API-002`  | Resolved          | Game routes require enrichment composition; every game list/detail response uses `GameWithPurchaseUtilization`, with no plain-response fallback.   |
| `SJ-MMR12-DISC-003` | Resolved          | Round 4 fixed strict JSON Schema composition, exact safe amount bounds, complete runtime error metadata, and executable schema/error parity tests. |

## Step 5 Validation Status

- Terminal acceptance: `ACCEPTED`.
- Focused terminal set: 52 passing.
- Affected route suites: 167 passing.
- Daemon suite: 1097 passing, 1 skip.
- Full repository suite: 1708 passing, 1 skip.
- Root typecheck: passed.
- Repository-wide lint: passed.
- Changed-file Prettier: passed.
- Diff check: passed.
- Runtime caveat: installed Bun was `1.3.11`; the repository declares `1.4.0`. No accepted failure was attributed to the version difference.
- Format baseline caveat: root format checking retains the known 42 pre-existing unchanged-file findings; changed-file Prettier passed for the accepted Step 5 surface.

## Remaining Plan

- [x] Step 6: Build web detail and settings (`shelf-judge-mmr.11`; Beads `CLOSED`).
- [x] Step 7: Add deterministic web sorts (`shelf-judge-mmr.10`; terminal acceptance `ACCEPTED`).
- [x] Step 8: Add CLI commands (`shelf-judge-mmr.8`; terminal acceptance `ACCEPTED`).
- [ ] Step 9: Complete persisted-flow and parity coverage (`shelf-judge-mmr.9`).
- [ ] Step 10: Run final validation (`shelf-judge-mmr.6`).

## Step 7 Evidence Map

| Obligation                                                                                                | Implementation surface                                                       | Local executable evidence                                                                                                          |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Add only the two approved built-in web sorts while preserving defaults and stored state                   | `packages/web/lib/collection-utils.ts`                                       | Sort-field/default/localStorage tests in `purchase-utilization-sorting.test.ts`; existing collection tests remain green            |
| Sort rounded value-remaining hundredths, including zero-play, fitness-zero, exact-zero, and sub-cent ties | Dedicated `sortByValueRemaining()` comparator                                | Ascending/descending calculated-state tests and zero-key rounded-tie tests                                                         |
| Order finite, unreachable, unavailable, and not-applicable additional-play projections exactly            | Dedicated `sortByEstimatedAdditionalPlays()` comparator                      | Both-direction category tests covering finite, unreachable, unavailable, gift, and zero-cost fixtures                              |
| Compare canonical finite integer strings without numeric coercion                                         | Shared `compareUnsignedDecimals()` used by both dedicated comparators        | Boundary fixtures at and above `Number.MAX_SAFE_INTEGER`                                                                           |
| Apply ascending NFC Unicode code-point name and stable-ID ties in every direction/category                | `compareCodePoints()` and `compareUtilizationTie()`                          | NFC equivalence, BMP versus supplementary scalar order, equal-name ID, rounded, finite, and unavailable direction-invariance tests |
| Render only daemon labels and canonical fitness displays                                                  | `getScoreDisplay()` and `collection-table.tsx`                               | Label/displayScore tests plus web production typecheck/build                                                                       |
| Preserve enriched response fields through collection variants and merges                                  | `packages/web/lib/api.ts` and `packages/web/components/collection-table.tsx` | Web production TypeScript and Next build; niche merge spreads the enriched source record                                           |
| Exclude automatic ranking, aggregation, judgment, notability, recommendation, and brief integration       | New collection utility/table surface only                                    | Production diff and focused symbol audit; no such integration added                                                                |

## Step 7 Accepted Product Manifest

Terminal acceptance status: `ACCEPTED`, with no material findings. The accepted product surface is exactly:

```text
packages/web/lib/api.ts
packages/web/lib/collection-utils.ts
packages/web/components/collection-table.tsx
packages/web/tests/collection-table.test.ts
packages/web/tests/purchase-utilization-sorting.test.ts
```

Current accepted product identities:

| Path                                                      | Porcelain | Index blob or marker                       | Working-tree SHA-256 or marker                                     |
| --------------------------------------------------------- | --------- | ------------------------------------------ | ------------------------------------------------------------------ |
| `packages/web/lib/api.ts`                                 | ` M`      | `29fed8dde5aea18a869eda3b7400443997927c6e` | `48aef1a714fd3e5988bbd5f54d36f4a67da5a7ed81d8aa35b6de69fe0e4fea6e` |
| `packages/web/lib/collection-utils.ts`                    | ` M`      | `774a123314f80b792ee0f263a89e4843ceceaa07` | `e1ca3a9d415794350cc23631ee2b36f9efd5eaed89b055204deacac7df2352da` |
| `packages/web/components/collection-table.tsx`            | ` M`      | `5d05fd32e48bcfe68bf6459b3dda1d0c46f4c01f` | `4a843ed51d0b6f3361b42ea5703fe5e869788415383fc772685e943710560eb4` |
| `packages/web/tests/collection-table.test.ts`             | ` M`      | `a4b98d0bb1aa5cce452d8e3ad322742571a2e452` | `2ce8612ee23878f013d843bbad2654f14a26583ab4d8c14ce1ba7e24d0accdbd` |
| `packages/web/tests/purchase-utilization-sorting.test.ts` | `??`      | absent                                     | `faa900447acc6a78fb374afe6dfc8171f756bcf650d36abe22649ee7dc46fcc0` |

No accepted product path is deleted or unmerged.

### Step 7 Workflow Status

Workflow files are outside the accepted product manifest:

```text
 M .beads/issues.jsonl
 M .lore/work/notes/collection-purchase-utilization.md
```

`.beads/issues.jsonl` was already modified outside the Step 7 product surface and was not mutated during this documentation update. This notes file is not self-hashed.

## Step 7 Validation Status

- `bun test packages/web/tests/collection-table.test.ts packages/web/tests/purchase-utilization-sorting.test.ts`: 77 pass, 0 fail.
- `bun test packages/web/tests`: 185 pass, 0 fail.
- `bunx tsc --noEmit -p packages/web/tsconfig.json`: passed.
- `bunx eslint packages/web/lib/api.ts packages/web/lib/collection-utils.ts packages/web/components/collection-table.tsx packages/web/tests/collection-table.test.ts packages/web/tests/purchase-utilization-sorting.test.ts`: passed.
- `bunx prettier --check packages/web/lib/api.ts packages/web/lib/collection-utils.ts packages/web/components/collection-table.tsx packages/web/tests/collection-table.test.ts packages/web/tests/purchase-utilization-sorting.test.ts`: passed.
- `bun run --cwd packages/web build`: passed with all routes built.
- `bunx tsc --noEmit -p packages/web/tsconfig.test.json`: failed on the existing unrelated fixture diagnostics listed in the Step 7 log; no changed Step 7 file appears in the output.
- Installed Bun remains `1.3.11` while the repository declares `1.4.0`; no observed Step 7 failure was version-related.
- Terminal acceptance: `ACCEPTED`, no material findings.
- Known baseline: `bunx tsc --noEmit -p packages/web/tsconfig.test.json` still fails only in unchanged fixtures `axes-page-curve.test.ts`, `game-links.test.tsx`, and `shelf-assignment.test.tsx`; no accepted Step 7 path appears in those diagnostics.
- Residual runtime risk: validation used installed Bun `1.3.11` while the repository declares `1.4.0`; no Step 7 failure was attributed to that difference.
- Overall implementation remains `in-progress`; Steps 8 through 10 and final plan/spec completion remain pending.

## Step 8 Evidence Map

| Obligation                                                                                           | Implementation surface                                                                                      | Executable validation                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Register acquisition, value, and benchmark commands while preserving exact positional amount strings | `packages/cli/src/index.ts`, `packages/cli/src/commands/game.ts`, `packages/cli/src/commands/collection.ts` | Parser and direct-command tests cover every state/action, missing/extra/unknown input, unchanged strings, URL encoding, methods, paths, bodies, and daemon errors                                                    |
| Preserve complete daemon responses under JSON                                                        | Game acquisition/value and collection benchmark command handlers                                            | Deep-equality command tests retain exact fractions, reasons, evidence, sources, timestamps, assumptions, sort projections, and additive response fields                                                              |
| Render acquisition and benchmark states distinctly                                                   | `packages/cli/src/commands/game.ts`, `packages/cli/src/commands/collection.ts`                              | Human-output tests cover unknown, gift, zero-cost and positive purchases, configured/invalid/unknown benchmarks, correction, and clear-to-unknown                                                                    |
| Render daemon purchase-utilization results without client formulas                                   | `packages/cli/src/output.ts`, `packages/cli/src/commands/game.ts`                                           | Canonical `$60` and `$20` command fixtures plus special-state tests cover result-first output, every component label/display/reason, evidence/provenance/times, assumptions, and previous ownership                  |
| Use canonical nullable `displayScore` in only the four required consumers                            | `packages/cli/src/commands/game.ts`, `packages/cli/src/commands/score.ts`, `packages/cli/src/output.ts`     | Game list/value and score list/get tests cover null and raw `7.95` with daemon `8.0`; score JSON tests preserve their existing endpoint shapes                                                                       |
| Document amount, benchmark, correction, clear, and zero-cost semantics without CLI collection sorts  | `packages/cli/src/commands/help.ts`                                                                         | Help tests assert exact command syntax, implicit currency, amount grammar, lifetime landed cost, fitness-6 benchmark meaning, movie-ticket arithmetic, correction/clear distinction, and absence of collection sorts |

## Step 8 Implementation Log

### 2026-08-26

- Implemented the Step 8 CLI production and test surface for `shelf-judge-mmr.8` directly in the shared workspace.
- Amount arguments remain positional strings through dispatch. CLI validation is limited to state/action and argument shape; daemon/shared validation remains authoritative for amount syntax, precision, range, and benchmark positivity.
- Human score rendering now consumes daemon `displayScore` for game list/value and score list/get. Human score commands enrich score-endpoint data through `/api/games` or `/api/games/:id`, while score JSON responses return before enrichment and retain their prior shapes.
- `game value` renders daemon labels, displays, reasons, evidence and source identifiers, observation/confirmation times, assumptions, and the factual previously-owned explanation without client-side utilization arithmetic.
- The implementation handoff left Step 8 awaiting independent validation; no tests or review were run by the implementation agent before that handoff.
- Correction `S8-VAL-001` wraps each invalid argument vector as one typed Bun `test.each` callback argument, retaining every acquisition and benchmark missing/extra/unknown case.
- Correction `S8-SCORE-001` enriches human `score list` output through the existing `/api/games?ownership=all` contract, so previously owned score records receive the daemon's canonical `displayScore` while `/api/scores` JSON remains unchanged.
- Correction `S8-COV-001` adds factual human-output coverage for missing and invalid play-count evidence and invalid modeled-player-count evidence, including their daemon reason codes.
- Post-correction verification passed the targeted index/help set at 19/19, the focused Step 8 set at 141/141, and the complete CLI suite at 242/242.
- CLI TypeScript, changed-file ESLint, corrected-file Prettier, and `git diff --check` all passed.
- Findings `S8-VAL-001`, `S8-SCORE-001`, `S8-COV-001`, `S8-FMT-001`, `S8-CLI-001`, `S8-HELP-001`, and `S8-CORR-FMT-001` are closed. The verification review found no new material issue.
- Terminal acceptance completed with status `ACCEPTED` and no material findings. Step 8 is complete; the overall notes status remains `in_progress` because Steps 9 and 10 remain.

### 2026-08-27

- Terminal acceptance reconciled the Step 8 CLI surface and accepted it with no material findings.
- Validation passed at every recorded level: targeted 19 pass; focused 141 pass; full CLI 242 pass; repository 1,804 pass, 1 skip, 0 fail; root typecheck pass; root lint pass; all 14 changed Step 8 product/test/notes paths Prettier-clean; and diff check pass.
- Root `format:check` reported only three unchanged `.beads` state files. No Step 8 product, test, or notes path failed formatting.
- Scope review confirmed no CLI collection sort scope was introduced.
- Residual risks are the existing skipped daemon fetch-timeout test and validation under installed Bun `1.3.11` rather than the repository-declared `1.4.0`.

## Step 8 Accepted Manifest

Terminal acceptance status: `ACCEPTED`, with no material findings. `git status --short` and `git status --porcelain=v1` both reported this exact acceptance context:

```text
 M .beads/issues.jsonl
 M .lore/work/notes/collection-purchase-utilization.md
 M packages/cli/src/commands/game.ts
 M packages/cli/src/commands/help.ts
 M packages/cli/src/commands/score.ts
 M packages/cli/src/index.ts
 M packages/cli/src/output.ts
 M packages/cli/tests/commands/game.test.ts
 M packages/cli/tests/commands/help.test.ts
 M packages/cli/tests/commands/predict.test.ts
 M packages/cli/tests/commands/score.test.ts
 M packages/cli/tests/index.test.ts
 M packages/cli/tests/output.test.ts
?? packages/cli/src/commands/collection.ts
?? packages/cli/tests/commands/collection.test.ts
```

The accepted Step 8 product and test surface is exactly these 13 paths:

| Path                                             | Porcelain | Index blob or marker                       | Working-tree SHA-256 or marker                                     |
| ------------------------------------------------ | --------- | ------------------------------------------ | ------------------------------------------------------------------ |
| `packages/cli/src/commands/game.ts`              | ` M`      | `7c10fb5452fc34a173f4f92ccedfe6910fc7b6c3` | `603aa0aba39e49dc76e4c5ab380708c532b09ec4ccf4ce2b94decf2264265f94` |
| `packages/cli/src/commands/help.ts`              | ` M`      | `f9bbea0b25bea5aa4c6243947b2ae912d77b5414` | `99371e4de417ccbd910fcd413086daf250f16c0aaac9c9a2b210daa78d4aa74f` |
| `packages/cli/src/commands/score.ts`             | ` M`      | `c33dfc9880857bd7c56c481a2099c5d25ea7f709` | `baea7edcb242fca046a67afa48cc7334859509cfd03eddb1ba54e0476f6c446d` |
| `packages/cli/src/commands/collection.ts`        | `??`      | absent                                     | `e1170265bffc4170cd94786c1c924e8cf3d5f06eca1915b9c29769bc3a0832e0` |
| `packages/cli/src/index.ts`                      | ` M`      | `3621be925816904762f50c54dd9fba00a386b8e8` | `6ea9077844a20931c2d6b0c313fa07b54e76739db7e1837a1d7f99a3de684110` |
| `packages/cli/src/output.ts`                     | ` M`      | `b2770bb0ff8323a0287fedf9798a6f4b6eb67a49` | `0be62cc026f1b2a866be076a8068378ddc4ef5b8d13ab7b417fea752da1e4921` |
| `packages/cli/tests/commands/game.test.ts`       | ` M`      | `ebd61861a843ffcf0901be7e736a9a90a698d619` | `a7e6514816103140e9b5c2c797ce75cb17bc17b6b50b3c400c7ee0e6b0daa373` |
| `packages/cli/tests/commands/help.test.ts`       | ` M`      | `269786d1530b006140face8ce3eace0e898bb82b` | `fb23429d08e6c7384cecfd52652f706af7d4db6c11b39b920ff1020962a0e214` |
| `packages/cli/tests/commands/predict.test.ts`    | ` M`      | `f047432f3879458387a55662cb959c9518e2eb4a` | `a6851d622a4236c8e2708120eb50b9d94ade0ca52265384be00a3f684287c441` |
| `packages/cli/tests/commands/score.test.ts`      | ` M`      | `f80ce3172e2a7cb0cc1afb1d43e189de6cf3a032` | `7dcf6aa69bcd1a69120f7e39f9b5c8878588a18e539624aed4fe13eddc18ac96` |
| `packages/cli/tests/commands/collection.test.ts` | `??`      | absent                                     | `b17b3e4f6fde24a2e975fa77eed41be37f9f94f65449e1414dceb2db84f8eb0d` |
| `packages/cli/tests/index.test.ts`               | ` M`      | `02e8665afbae4bb31ceebce086f00ce93c34a953` | `6163c93267f11f87fb0beee47697dd5a50e6eed14da16ab02c9536da536f0b05` |
| `packages/cli/tests/output.test.ts`              | ` M`      | `c44941b39bf32e3ba67503d3dda5dde2a0c4fdf6` | `dbbb37e62230a7167de04e23eb02d69ff613cdb0537d34ec697898a460486054` |

No accepted Step 8 product or test path is deleted or unmerged.

### Step 8 Workflow Context

| Path                                                  | Porcelain | Index blob or marker                       | Working-tree identity                                             |
| ----------------------------------------------------- | --------- | ------------------------------------------ | ----------------------------------------------------------------- |
| `.lore/work/notes/collection-purchase-utilization.md` | ` M`      | `47012e5dee4ed7cbb1fd29b72b6b6ae1ae94b23a` | Not self-hashed: recording the hash in this file would change it. |
| `.beads/issues.jsonl`                                 | ` M`      | `c237a000ded4688a8f8ae3ad854307ec5f1b40a1` | Excluded: unrelated pre-existing tracker workflow state.          |

This notes path is included only as resumable workflow context, not as Step 8 product code. The modified `.beads/issues.jsonl` is unrelated pre-existing workflow state and is not claimed as a Step 8 product or documentation change.

## Step 8 Validation Status

- Terminal acceptance: `ACCEPTED`; no material findings.
- Targeted validation: 19 pass.
- Focused Step 8 validation: 141 pass.
- Full CLI suite: 242 pass.
- Full repository suite: 1,804 pass, 1 skip, 0 fail.
- Root typecheck: passed.
- Root lint: passed.
- Prettier: all 14 changed Step 8 product/test/notes paths clean.
- Root `format:check`: only three unchanged `.beads` state files reported.
- Diff check: passed.
- Scope check: no collection sort scope.
- Residual risk: the existing skipped daemon fetch-timeout test remains.
- Runtime residual: installed Bun was `1.3.11`; the repository declares `1.4.0`.
