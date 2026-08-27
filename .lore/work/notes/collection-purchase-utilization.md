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
- [ ] Step 4: Implement purchase utilization engine (`shelf-judge-mmr.14`)
- [ ] Step 5: Add daemon APIs and response assembly (`shelf-judge-mmr.12`)
- [ ] Step 6: Build web detail and settings (`shelf-judge-mmr.11`)
- [ ] Step 7: Add deterministic web sorts (`shelf-judge-mmr.10`)
- [ ] Step 8: Add CLI commands (`shelf-judge-mmr.8`)
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
