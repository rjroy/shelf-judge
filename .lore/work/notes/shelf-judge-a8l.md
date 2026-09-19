---
title: "Implementation notes: dated BGG play sessions and Want to play"
date: 2026-09-19
status: complete
tags: [implementation, bgg, collection, play-history]
source: shelf-judge-a8l
modules: [shared, daemon, web, cli]
---

# Implementation notes: dated BGG play sessions and Want to play

## Approved decisions

- Primary Want to play is not count-gated. Historical first-play/replay bookkeeping remains compatibility context.
- BGG play dates are validated `YYYY-MM-DD` values and never receive invented timestamps.
- Only a complete successful `/plays` fetch replaces its fetched BGG-game scope. Failed or partial retrieval leaves stored sessions unchanged.
- Valid dated, deduplicated session quantities replace aggregate BGG count evidence. Legacy aggregates create no sessions.

## Obligation map

| Obligation                                                | Evidence                                                          |
| --------------------------------------------------------- | ----------------------------------------------------------------- |
| Versioned validated session persistence                   | shared schema v7 and v6-to-v7 migration                           |
| Parse dates, identity, pagination, deduplication          | parser/client tests                                               |
| Atomic idempotent scope replacement and derived counts    | game-service mutation path and focused persistence tests          |
| Contract supersession                                     | current useful-profile reference amendment                        |
| Want to play without reliable count evidence              | no-kind service command test and UI control rendering             |
| Evidence-safe completion and derived first/replay context | intention lifecycle completion tests and UI derived-context tests |

## Implementation status

Phase 1 session persistence and phase 2 Want to play implementation are present. Terminal validation passes except for the pre-existing unchanged global stylesheet format issue documented below.

## Terminal findings resolved

- **A8L-TERM-001:** Formatted and type-checked the changed Analyst projection test. The unchanged `packages/web/app/globals.css` remains excluded from edits.
- **A8L-TERM-002:** Complete `/plays` replacement, session-derived count evidence, dated summaries, and automatic completion now share one freshness gate. A newer manual/current observation rejects an older complete `/plays` response, preserving existing sessions and newer evidence rather than rewriting history to match stale data. Equal-time refresh is accepted only for existing BGG `/plays` evidence so idempotent replacement remains possible.
- **A8L-TERM-003:** Game-detail intention controls now show neutral dated context: last dated play and the inclusive 365-day volume ending on the BGG `/plays` observation date. They explicitly report when no valid dated plays are available, without enjoyment, urgency, neglect, or recommendation claims.
- **A8L-TERM-004:** The current reference now identifies schema version 7 and documents dated-session source, scoped replacement, date validation, aggregate semantics, freshness, neutral UI presentation, and the count-independent Want to play contract.
- **A8L-TERM-005:** The Playwright guard now asserts actual scroll-width overflow and out-of-viewport feature content. It no longer rejects intentional app-shell `overflow: hidden` styling.

## Changed files

- `packages/shared/src/types.ts`
- `packages/shared/src/validation.ts`
- `packages/shared/src/index.ts`
- `packages/daemon/src/services/collection-migration.ts`
- `packages/daemon/src/services/bgg-xml-parser.ts`
- `packages/daemon/src/services/bgg-client.ts`
- `packages/daemon/src/services/game-service.ts`
- `.lore/reference/specs/current/useful-collection-profile.md`

## Test evidence

- `bun test packages/daemon/tests/services/game-service-bgg.test.ts packages/daemon/tests/services/collection-migration.test.ts packages/daemon/tests/services/bgg-xml-parser.test.ts packages/daemon/tests/services/bgg-client.test.ts packages/shared/tests/owner-game-note.test.ts`: 214 pass, 1 existing skipped, 0 fail, 1,001 assertions.
- `bunx tsc --noEmit -p packages/shared && bunx tsc --noEmit -p packages/daemon`: pass.
- Refresh integration proves complete dated-session replacement is idempotent, removes absent records within its BGG scope, derives count/last-played/recent count, and excludes missing dates. Partial and failed imports retain sessions. Batch failure returns the existing `RefreshSummary` with no destructive error entry and emits the structured warning `BGG plays import failed; preserving persisted sessions`.
- Earlier phase 2 attempt: the four-file run reported 61 pass, 0 fail, 384 assertions before adding the no-evidence route regression. That run did not cover the response-coherence bug found below and is superseded by the recovery results.

## Phase 2 decisions

- New public web and CLI create commands omit `kind`. Every newly executed create command persists `want-to-play`, including compatibility requests carrying an explicit `want-to-play`, `first-play`, or `replay` hint. Only ownership gates creation. A trustworthy current count snapshots an automatic-completion baseline; missing, invalid, timestamp-less, or stale evidence records `baseline: null` and cannot auto-complete the intention.
- `first-play` and `replay` remain accepted durable historical kinds with their original baselines and history labels. Current UI context derives only from valid, timestamped, non-stale evidence.
- Legacy command receipts remain runtime-valid so old durable history is not rewritten. The public web and CLI create actions send no kind.
- Replay looks up the original command receipt before applying current creation rules and preserves its exact original result. A historical first-play/replay request may return its matching historical kind; a no-kind request must return Want to play. Changed payloads still produce command-reuse conflicts.
- A null baseline is immutable lifecycle provenance, not a placeholder to fill after a later count arrives. Both automatic transition logic and runtime resolution validation forbid observed-play completion without a captured baseline. Owner-confirmed completion and ownership retirement remain available.

## Review corrections

- **A8L-P1-001:** `CollectionSchemaV7` now validates its v6 projection through `CollectionSchemaV6` before applying session uniqueness checks, preserving all v5/v6 cross-field refinements.
- **A8L-P1-002:** Session-derived evidence prevents collection aggregate or partial `/plays` data from replacing `numPlays`, `lastPlayedAt`, `recentPlayCount`, or sessions. The regression test includes a newer collection aggregate of `99` and a partial `/plays` result and proves the dated-session summary remains `2`.
- **A8L-P1-003:** The parser rejects an explicit foreign play-item BGG ID. The client completes each requested BGG scope only when its unique play-ID count equals the declared total; duplicate-short pagination fails rather than authorizing a replacement.

## Phase 2 recovery diagnosis

- Reproduction: `bun test packages/daemon/tests/routes/intention-routes.test.ts` reported **27 pass, 1 fail, 158 assertions**. At the no-evidence route assertion, the exact failure was `Expected: 200`, `Received: 500`. Logs showed successful collection validation, persistence, and an active intention outcome before the response failed.
- Root cause: `intentionMutationResultMatchesCommand` still required `result.intention.kind === command.kind`. An omitted request kind is undefined, while the accepted result contains `want-to-play`. The route converted that mismatch to HTTP 500; the browser mutation boundary uses the same validator. Omitting `numPlays` versus explicitly setting it to null did not cause this failure.
- The retained route regression covers both omitted and null counts and verifies missing evidence, HTTP 200, and a null baseline. It reconstructs the app against persisted storage, records a later count of five without automatic completion, retires the intention on ownership change, and replays the original create receipt unchanged afterward.
- Service coverage now exercises omitted and explicit compatibility kinds against missing, invalid, timestamp-less, and stale evidence. Migration coverage preserves resolved legacy first-play/replay records and original receipts exactly through v6-to-v7 migration and restart. Existing count-increase, conflict, concurrency, and lost-response tests remain in the passing suite.
- A second validation-boundary defect surfaced in the wider run: current profile-source validation forwarded `bggPlaySessions` into strict v5 validation. Migrated collections explicitly contain that field, so profiles became unavailable and detail reads failed. The historical projection now excludes the new field, matching the current collection validator; a focused shared regression covers migrated session storage.
- UI creation announcements now say `Want to play intention created.` instead of incorrectly falling through to `Replay`. UI tests cover availability for every evidence state, derived context, null-baseline history, and no-kind browser requests. Browser fixtures and selectors were updated to the new contract, including a truly missing-evidence create fixture.
- Legacy rejection expectations, attention wording, CLI arguments/help, and future-version fixtures were reconciled with the approved contract. Phase 1 behavior was preserved; its touched files were formatted, and its Bun async rejection assertion received the repository-standard ESLint annotation.

## Recovery validation

Focused terminal command:

```sh
bun test packages/shared/tests/useful-profile-contract.test.ts packages/shared/tests/current-axis-validation.test.ts packages/daemon/tests/services/intention-service.test.ts packages/daemon/tests/routes/intention-routes.test.ts packages/daemon/tests/integration/intention-concurrency.test.ts packages/daemon/tests/collection-profile-engine.test.ts packages/daemon/tests/services/collection-migration.test.ts packages/daemon/tests/services/storage-collection-migration.test.ts packages/daemon/tests/integration/useful-profile-persisted-flow.test.ts packages/web/tests/intention-controls.test.tsx packages/web/tests/intention-history.test.tsx packages/web/tests/browser-mutations.test.ts packages/web/tests/profile-consumers-integration.test.tsx packages/cli/tests/commands/game.test.ts packages/cli/tests/commands/help.test.ts packages/cli/tests/process/intention-replay.test.ts
```

- **399 pass, 0 fail, 1,833 assertions across 16 files.** Log: `/tmp/opencode/a8l-phase2-tests.log`.
- `bun run typecheck`: passed shared, daemon, and CLI checks.
- `bunx tsc --noEmit -p packages/web/tsconfig.json`: passed.
- `bun run typecheck:browser`: passed.
- `bun run lint`: passed.
- `bun run build`: passed. Log: `/tmp/opencode/a8l-phase2-build.log`.
- Changed tracked TypeScript/TSX/Markdown Prettier check and `git diff --check`: passed.
- Final full terminal suite: **2,985 pass, 1 skip, 0 fail, 17,155 assertions across 178 files**. The skip is the existing BGG fetch-timeout test. Log: `/tmp/opencode/a8l-all-tests.log`.

Additional browser command:

```sh
bun run --cwd packages/web test:browser e2e/useful-profile.pw.ts --grep 'game-detail intention browser contracts'
```

**12 failed across four viewports**, all at `expectNoHorizontalOverflow` in `packages/web/e2e/useful-profile.pw.ts:102`. The guard rejects `body` having computed `overflowX: "hidden"`, even though the recorded body `scrollWidth` equals its `clientWidth` in each viewport. `packages/web/app/globals.css` sets `body { overflow: hidden; }`. Creation without evidence, null-baseline presentation, manual completion, retirement, stale-conflict recovery, and their network assertions reached this later layout guard successfully. The application CSS and the overflow assertion were preserved for the parent session to reconcile with the app-shell layout contract. Log: `/tmp/opencode/a8l-phase2-browser.log`; Playwright traces are under `packages/web/test-results/`.

Fresh-context review was requested through `bun-typescript-reviewer`, but the harness rejected nested delegation with `Subagent depth limit reached (1)`. Parent-session review is still needed. No bead status changes, commits, or remote sync were performed during recovery.

## Review correction A8L-P2-001

- **A8L-P2-001:** Analyst projection evidence now mirrors the shared intention contract: it accepts current `want-to-play` intentions and a nullable baseline, while retaining strict non-null provenance fields when a baseline exists. This preserves historical `first-play` and `replay` projection compatibility without accepting partially populated baselines.
- Regression coverage captures Analyst snapshots for a baseline-free Want to play intention and for a Want to play intention with trustworthy manual count provenance plus derived current play evidence.
- Validation: `bun test packages/daemon/tests/services/analyst-evidence-projections.test.ts packages/daemon/tests/services/intention-service.test.ts` passed with 24 tests, 0 failures, and 195 assertions. `bunx tsc --noEmit -p packages/daemon` passed.

## Final A8L-TERM correction diagnosis and evidence

The inherited single failure was reproduced in `game-service-bgg.test.ts`: **61 pass, 1 fail, 379 assertions**, with `Expected: []`, `Received: undefined` at the session assertion. The complete stale response was already rejected at the import boundary. Schema v7 permits absent session storage, so rejecting a first import correctly leaves that optional field absent. Forcing initialization to satisfy this assertion would test storage representation rather than freshness. Reproduction log: `/tmp/opencode/a8l-term-reproduction.log`.

The replacement regression creates real imported history and an active intention through services, then introduces newer manual evidence, newer accepted BGG evidence, or a newer missing check. Twelve cases cover single and batch refreshes plus older/equal observations. Rejected imports must preserve sessions, count, summaries, current evidence, latest check, and the active intention together. An equal-time replay of accepted BGG evidence updates the coherent snapshot and may complete an intention only against its older captured baseline. The gate also prevents an equal-time response from clearing a newer missing check just because the older accepted evidence had BGG provenance.

- **A8L-TERM-001:** Analyst tests await the service operation directly and match the actual typed profile payload, eliminating Bun async-matcher lint errors and unsafe nested `objectContaining` values. Root ESLint passes with no suppressions added.
- **A8L-TERM-002:** The shared import gate and persistence regression cover the complete freshness boundary. Imported history survives manual corrections and rejected stale refreshes; the UI does not relabel retained summaries as current manual evidence.
- **A8L-TERM-003:** Neutral dated context is present in both active and create game-detail controls. UI tests reject non-valid or superseding manual evidence as a source for current dated context. A service regression verifies the inclusive 365-date interval is observation date minus 364 days through observation date, independent of the wall clock. A dedicated browser case verifies visible last-played date, quantity, and observation-relative window across all four viewport projects.
- **A8L-TERM-004:** The current reference documents schema v7, session identity/provenance, scoped replacement, validated-date aggregate derivation, shared freshness acceptance, preserved historical sessions, and the exact neutral recent-volume window.
- **A8L-TERM-005:** The overflow guard measures feature descendants and ancestors for actual scroll overflow and checks viewport bounds. Its browser regression accepts intentional shell `overflow: hidden`, rejects a 200vw child, and rejects text clipped inside a 40px child. Contrast coverage now targets the missing-evidence warning actually rendered by the no-evidence fixture, plus dated context.

The wider profile browser run initially found six failures: four undersized `Inspect evidence` targets and two guard false positives from intentionally clipped screen-reader text or the locally scrollable histogram. The guard now exempts explicit local scroll regions and `.sr-only` descendants from descendant scroll-width checks, while preserving ancestor/page overflow, visible-content bounds, and clipped-content detection. `packages/web/components/profile/entity-card.tsx` explicitly gives its evidence link a 44px minimum height. This small accessibility correction leaves the global stylesheet byte-identical. The complete profile browser file subsequently passes.

Validation commands and results:

```sh
bun test packages/daemon/tests/services/game-service-bgg.test.ts packages/daemon/tests/services/analyst-evidence-projections.test.ts packages/web/tests/intention-controls.test.tsx
bun run typecheck
bunx tsc --noEmit -p packages/web/tsconfig.json
bun run typecheck:browser
bun run lint
bun run build
bun run --cwd packages/web test:browser e2e/useful-profile.pw.ts --grep 'game-detail intention browser contracts'
```

- Focused suite: **93 pass, 0 fail, 606 assertions**. Log: `/tmp/opencode/a8l-term-focused.log`.
- Shared, daemon, CLI, web, and browser typechecks: passed.
- Root ESLint: passed.
- Production build: passed. Log: `/tmp/opencode/a8l-term-build.log`.
- Full Bun suite: **3,001 pass, 1 existing skip, 0 fail, 17,241 assertions across 178 files**. Log: `/tmp/opencode/a8l-term-all-tests.log`. Subsequent Analyst assertion cleanup passed the focused suite.
- Targeted Playwright: **20 passed**, covering 375×812, 768×1024, 1440×900, and 200% layout-equivalent viewports. Log: `/tmp/opencode/a8l-term-browser.log`.
- Full profile Playwright file (`bun run --cwd packages/web test:browser e2e/useful-profile.pw.ts`): **37 passed, 3 skipped, 0 failed**. The no-JavaScript case intentionally runs only on mobile, skipping the other three projects. Log: `/tmp/opencode/a8l-term-profile-browser.log`. Web/browser typechecks, root lint, and production build were rerun successfully after the touch-target and guard corrections.
- Changed-file Prettier check, including ignored `.lore` Markdown via `--ignore-path /dev/null`: **68 changed TS/TSX/Markdown files passed**. Log: `/tmp/opencode/a8l-term-changed-format.log`. `git diff --check`: passed.
- Impeccable detector on `intention-controls.tsx`: `[]` (no findings).
- Root `bun run format:check` reports **only** `packages/web/app/globals.css`. Log: `/tmp/opencode/a8l-term-format.log`. `git diff --exit-code HEAD -- packages/web/app/globals.css` passes. Both `git rev-parse HEAD:packages/web/app/globals.css` and `git hash-object packages/web/app/globals.css` return **`5ff62b25387ef7d18d655d769a2f9871991757ba`**, proving the formatting failure is HEAD-identical, pre-existing, and untouched.

No bead status changes, commits, or remote sync were performed. Parent-session fresh-context review remains appropriate because nested delegation was already rejected during recovery.

## Terminal acceptance

Accepted terminal evidence is recorded in the final correction section above: focused tests (93 pass), all typechecks, lint, production build, full Bun suite (3,001 pass, 1 existing skip), targeted browser suite (20 passed), full profile Playwright (37 passed, 3 skipped), changed-file formatting, and `git diff --check` all passed. The known `packages/web/app/globals.css` root-format failure remains HEAD-identical and was not edited.

The bead was closed after confirming it has no dependencies, dependents, or children. Closure reason: accepted implementation validated, with dated sessions, derived context, and count-independent Want to play complete.

## Accepted changed-path manifest

Snapshot taken after the final Beads tracker mutation. The following is the exact `git status --porcelain=v1` output at that point:

```text
 M .beads/interactions.jsonl
 M .beads/issues.jsonl
 M .lore/reference/specs/current/useful-collection-profile.md
 M packages/cli/src/commands/game.ts
 M packages/cli/src/commands/help.ts
 M packages/cli/tests/commands/game.test.ts
 M packages/cli/tests/commands/help.test.ts
 M packages/cli/tests/helpers/replay-daemon-fixture.ts
 M packages/cli/tests/process/intention-replay.test.ts
 M packages/daemon/src/routes/games.ts
 M packages/daemon/src/routes/profile-reflections.ts
 M packages/daemon/src/services/analyst-evidence-projections.ts
 M packages/daemon/src/services/bgg-client.ts
 M packages/daemon/src/services/bgg-xml-parser.ts
 M packages/daemon/src/services/collection-migration.ts
 M packages/daemon/src/services/collection-profile-engine.ts
 M packages/daemon/src/services/game-service.ts
 M packages/daemon/src/services/intention-service.ts
 M packages/daemon/tests/capacity-service.test.ts
 M packages/daemon/tests/collection-profile-engine.test.ts
 M packages/daemon/tests/dimensions-routes.test.ts
 M packages/daemon/tests/helpers/test-app.ts
 M packages/daemon/tests/integration/end-to-end.test.ts
 M packages/daemon/tests/integration/intention-concurrency.test.ts
 M packages/daemon/tests/integration/owner-game-notes-persisted-flow.test.ts
 M packages/daemon/tests/integration/purchase-utilization-persisted-flow.test.ts
 M packages/daemon/tests/integration/purchase-utilization-response-parity.test.ts
 M packages/daemon/tests/integration/useful-profile-persisted-flow.test.ts
 M packages/daemon/tests/niche-settings-integration.test.ts
 M packages/daemon/tests/ownership-routes.test.ts
 M packages/daemon/tests/redundancy-integration.test.ts
 M packages/daemon/tests/routes/intention-routes.test.ts
 M packages/daemon/tests/services/analyst-evidence-projections.test.ts
 M packages/daemon/tests/services/bgg-client.test.ts
 M packages/daemon/tests/services/bgg-xml-parser.test.ts
 M packages/daemon/tests/services/collection-migration.test.ts
 M packages/daemon/tests/services/collection-mutation-service.test.ts
 M packages/daemon/tests/services/game-projection.test.ts
 M packages/daemon/tests/services/game-service-bgg.test.ts
 M packages/daemon/tests/services/intention-service.test.ts
 M packages/daemon/tests/services/owner-game-note-service.test.ts
 M packages/daemon/tests/services/prediction-service.test.ts
 M packages/daemon/tests/services/purchase-utilization-service.test.ts
 M packages/daemon/tests/services/reflection-evidence-projections.test.ts
 M packages/daemon/tests/services/storage-collection-migration.test.ts
 M packages/daemon/tests/services/storage-service.test.ts
 M packages/daemon/tests/shelf-routes.test.ts
 M packages/daemon/tests/shelf-service.test.ts
 M packages/daemon/tests/wishlist-service.test.ts
 M packages/shared/src/collection-profile-validation.ts
 M packages/shared/src/index.ts
 M packages/shared/src/types.ts
 M packages/shared/src/validation.ts
 M packages/shared/tests/current-axis-validation.test.ts
 M packages/shared/tests/derived-axis-registry.test.ts
 M packages/shared/tests/fixtures/useful-profile.ts
 M packages/shared/tests/owner-game-note.test.ts
 M packages/shared/tests/useful-profile-contract.test.ts
 M packages/web/components/intention-controls.tsx
 M packages/web/components/intention-history.tsx
 M packages/web/components/profile/attention-section.tsx
 M packages/web/components/profile/entity-card.tsx
 M packages/web/e2e/fixture-daemon.ts
 M packages/web/e2e/useful-profile.pw.ts
 M packages/web/lib/browser-mutations.ts
 M packages/web/tests/browser-mutations.test.ts
 M packages/web/tests/intention-controls.test.tsx
 M packages/web/tests/intention-history.test.tsx
 M packages/web/tests/profile-consumers-integration.test.tsx
?? .lore/work/notes/shelf-judge-a8l.md
```

| Path | Porcelain | Index identity | Working-tree identity |
| --- | --- | --- | --- |
| `.beads/interactions.jsonl` | ` M` | blob c60c7506121cd5c5e0323a033cf02dd17a3deee2 (mode 100644, stage 0) | SHA-256 9fa554a0e40289ba4e3f5d2e584a7720d8029f552624ddabd3e781b0acfbd87d |
| `.beads/issues.jsonl` | ` M` | blob 6330ad23b51473405a354421c60532c8a5735386 (mode 100644, stage 0) | SHA-256 65e621a17038e056b2c7e1f9777873bca108082cf6a4c9b84d6fde90d3db9e70 |
| `.lore/reference/specs/current/useful-collection-profile.md` | ` M` | blob 7b0e60089bb2c644a3cd542d9849f2d87ea456dc (mode 100644, stage 0) | SHA-256 4170ea044ac1c0344cd82c7869f8b9e99e04f03de10bf5bb635bff0738bdd03e |
| `packages/cli/src/commands/game.ts` | ` M` | blob bf3db6525943b5a903e597c9ded0da23c0172892 (mode 100644, stage 0) | SHA-256 e17022e020a42f8ba0476a021bd8f15e4caea0397535176b1c0a9acf4a4ecce5 |
| `packages/cli/src/commands/help.ts` | ` M` | blob a01c8b1ab21ed6802411cbeed5adb54d4bed8f61 (mode 100644, stage 0) | SHA-256 14dc35207d9620d795aea08284f19399660e6be3f3257b4b279084372a0827af |
| `packages/cli/tests/commands/game.test.ts` | ` M` | blob c7b34cac615c12506ecda7107e33a951b9c6c4cb (mode 100644, stage 0) | SHA-256 56a10b22ff8546af3b2014c7da60d2a18f603cb70976cc803683942810b73ce0 |
| `packages/cli/tests/commands/help.test.ts` | ` M` | blob accb981ac65224382a50d41828cd85e8d0af6825 (mode 100644, stage 0) | SHA-256 4953cbed2482da685533425bf726af124b727f52531da5d90231565e57a05f58 |
| `packages/cli/tests/helpers/replay-daemon-fixture.ts` | ` M` | blob a782769f3a7f16be4a3d7347646e87fde9ec7322 (mode 100644, stage 0) | SHA-256 624a5a8abd4c8187f423314f933032dfbff168af651d0a140a6b1e2cdb4f5a2f |
| `packages/cli/tests/process/intention-replay.test.ts` | ` M` | blob efea4383d5bc9b0ce011dfbddfe2508fec4c7d2d (mode 100644, stage 0) | SHA-256 f5d90b21bbbde68226dad5cc7fe01a0ca9a0ae395d345092003d11b6d99efa20 |
| `packages/daemon/src/routes/games.ts` | ` M` | blob 521174774f3c59015c07592274435291a44fefac (mode 100644, stage 0) | SHA-256 0a3c0d747f6dfb4095c0ce130bf1b57a3f4ad979353f1dfededdb8eb11a2d5db |
| `packages/daemon/src/routes/profile-reflections.ts` | ` M` | blob bc67c226f4ca91b464b87166b4364bd01dabfd0d (mode 100644, stage 0) | SHA-256 63cc66ebf66e7ed125442901840a06e3298dc978145468af31143a5637e9da95 |
| `packages/daemon/src/services/analyst-evidence-projections.ts` | ` M` | blob ccf13c8a3ec35336f91ac07a74cfee60632ee7df (mode 100644, stage 0) | SHA-256 c0c1faec21d07f90f46ccb2250ff1dabeff9839d48c440c6e9a79b0c6d31496d |
| `packages/daemon/src/services/bgg-client.ts` | ` M` | blob 3fa94028f00e4ddbaca7e6af740158da23c2b1c1 (mode 100644, stage 0) | SHA-256 99a6000c62300ced981be9416c86d9be9ff274fc36d63e4c8ea0f39b5b0cdfde |
| `packages/daemon/src/services/bgg-xml-parser.ts` | ` M` | blob 9d30038c8ab10606b670b312f00614a645abd0d7 (mode 100644, stage 0) | SHA-256 114a29832bdd5effaf51246fef7b9549f389d06740706f1138361c32f02a3a1d |
| `packages/daemon/src/services/collection-migration.ts` | ` M` | blob 177bf43d81a6d03cb7358abe50909a0df581da2a (mode 100644, stage 0) | SHA-256 01a11f6612b3933ceb71ca6ed6dc5663ffe9236156e0e5f620f25d6ceb89056b |
| `packages/daemon/src/services/collection-profile-engine.ts` | ` M` | blob 1e62900af4811d59ab02efa7615e38f9f048f9b8 (mode 100644, stage 0) | SHA-256 f409815f1348df5acc5bfd68b0db3dbe8b19e9c230df6c153703c0d15b1ada88 |
| `packages/daemon/src/services/game-service.ts` | ` M` | blob 51cf501bb06c80f90f400f719e556c1eee8ec3e1 (mode 100644, stage 0) | SHA-256 3111ce134735669315f16917397444f5ba31dca2b7fbc0c94b0fcd2ccb6c7f79 |
| `packages/daemon/src/services/intention-service.ts` | ` M` | blob a4053fcac83ebbb80bc3a9564b1a673ccda1057b (mode 100644, stage 0) | SHA-256 2154573444dd50112201adedfe827c43925305e0133f4f63c13bbd3222a634bf |
| `packages/daemon/tests/capacity-service.test.ts` | ` M` | blob 1a20c89cab72f624d8c20e45dda16c9581652c02 (mode 100644, stage 0) | SHA-256 f399a183277b8190f313b1002125b3cefa3aecb155f7dddd1c61da29f66ac37c |
| `packages/daemon/tests/collection-profile-engine.test.ts` | ` M` | blob 8b6f7ae310f9dcd1ab90b647dbc1abd8fd5aedf2 (mode 100644, stage 0) | SHA-256 716ce4a270f696a9b73df3add9982c9588e01d11f975879bfb4a2e3769298711 |
| `packages/daemon/tests/dimensions-routes.test.ts` | ` M` | blob e7642cca2f981a3b0a2f3f8741571227f7799c70 (mode 100644, stage 0) | SHA-256 8b1476880a37f404c732b73d43e9c1c43e7f34da7139d5c5223904d60e4f4776 |
| `packages/daemon/tests/helpers/test-app.ts` | ` M` | blob 7c33d7a8702f9a457fd726077c7c468e84d14a0b (mode 100644, stage 0) | SHA-256 34849f69f4e74962e461791f2628938a83bb3c9fa32fe71846fbf2a46f6ce835 |
| `packages/daemon/tests/integration/end-to-end.test.ts` | ` M` | blob 447066cad910db162143aef95693bdeca294f520 (mode 100644, stage 0) | SHA-256 63fa37cfc02d93ab1316d6fbdcbab1f59166f37c954fdb74bf75046939f3f6b0 |
| `packages/daemon/tests/integration/intention-concurrency.test.ts` | ` M` | blob 025df566f55b1f077333e3d335d07aba9b412150 (mode 100644, stage 0) | SHA-256 085530c1e811bcc1e73311e8fba1a9d00d06c0074f9cde9b2b40966f22a3ceb6 |
| `packages/daemon/tests/integration/owner-game-notes-persisted-flow.test.ts` | ` M` | blob eb4bcf633b041b55a77400f0af37d4c0bb47055b (mode 100644, stage 0) | SHA-256 e9abd620e87a44aada69196aa55c22c01ba5329f6ad0ac5d2905ec4381eff4e1 |
| `packages/daemon/tests/integration/purchase-utilization-persisted-flow.test.ts` | ` M` | blob 0fb38c05af2afb0e3b333949fe7709d165aa1da0 (mode 100644, stage 0) | SHA-256 9234a554e2372970902bdf61c9757e9a3b70f261af5f191b2ea86f947a826ba5 |
| `packages/daemon/tests/integration/purchase-utilization-response-parity.test.ts` | ` M` | blob c037b57c9412ba1a93f50b324d37c474ca4f8d29 (mode 100644, stage 0) | SHA-256 73b73ac151c983455998e8fabcf66480dab2b8ed680526066846ba7227c077a2 |
| `packages/daemon/tests/integration/useful-profile-persisted-flow.test.ts` | ` M` | blob 7da788cff106898fa6b8e343c4913ebaae1cec16 (mode 100644, stage 0) | SHA-256 49d2907c5a3f5bae162b7d6ab051b1a4421c76b42ca8a176dd1f19f63149bafc |
| `packages/daemon/tests/niche-settings-integration.test.ts` | ` M` | blob 2300255c2fc619ef8009c955329ba216e5fd1963 (mode 100644, stage 0) | SHA-256 bdef7d7bb533a9b8bc1a1250f5c29cea36de1e5b0c98ec55d1fb711fb050b833 |
| `packages/daemon/tests/ownership-routes.test.ts` | ` M` | blob 2aefd2f378b5dd2fdeddb8a1e89b66057f135ac3 (mode 100644, stage 0) | SHA-256 60b5574d784fb9562ae9b1a545b089cfb9c559beeeeb97d5d47852aeba611e39 |
| `packages/daemon/tests/redundancy-integration.test.ts` | ` M` | blob 3a01592104420dd8eace37d24576eeb733bc7228 (mode 100644, stage 0) | SHA-256 1a74bdee7f11232a096ffa98a82b40354d8a15707f138d82ed88485b8fa2dddd |
| `packages/daemon/tests/routes/intention-routes.test.ts` | ` M` | blob b6244ff58378fa9d6fc0860457175682d849a589 (mode 100644, stage 0) | SHA-256 37e29e1854f9e80413eeded9e64591e813e5ad1c4a3a2791b42c5108ce62024e |
| `packages/daemon/tests/services/analyst-evidence-projections.test.ts` | ` M` | blob e4df216dfc8fb61d0617c8178b8c6651f8ef944a (mode 100644, stage 0) | SHA-256 45f6a75cfb291392baaca50b74341d187c930d9b8d3e8e5d7e0da3b546b64930 |
| `packages/daemon/tests/services/bgg-client.test.ts` | ` M` | blob 45a5b2f7affe1eca0f32ccaee090b3539d8369b2 (mode 100644, stage 0) | SHA-256 6ccb83029d181af1c2c1aaf449836863577ba5214de172ee7259adfcd914bd29 |
| `packages/daemon/tests/services/bgg-xml-parser.test.ts` | ` M` | blob 9ba1fc027f042b50a7435f677dca95d1a52cfee2 (mode 100644, stage 0) | SHA-256 ae341fc95f3dd2d11359c353fc2197832d9edcaef60a285d8ee1be7ea315e526 |
| `packages/daemon/tests/services/collection-migration.test.ts` | ` M` | blob 7a6fa7ab949704eddfa543ff369423081e86b423 (mode 100644, stage 0) | SHA-256 610aab38f8ca3c20547758aafdbff6a44ba93c5f33f6c59ae56e0db0a973ceb5 |
| `packages/daemon/tests/services/collection-mutation-service.test.ts` | ` M` | blob 993fde3e455b4416314630601a97a995939f7103 (mode 100644, stage 0) | SHA-256 4dbc303c18ef58f4227717eed24d557d7d5a7bfa8a1635f051d5887e8b5408e1 |
| `packages/daemon/tests/services/game-projection.test.ts` | ` M` | blob e4e48d05b26d1dc7dca815220a703d41dd43153c (mode 100644, stage 0) | SHA-256 45ee870389d3f8fdc7637e30e90a5aeea9e67dbe8f33b43fd3ed6e5dfa2350bb |
| `packages/daemon/tests/services/game-service-bgg.test.ts` | ` M` | blob b47d6c772ba5e0efc4b2d7c61c3fa1b184c3028d (mode 100644, stage 0) | SHA-256 e5036b96a535062029cd89d7233cc5c823b47ff407d63a5901c654895b657995 |
| `packages/daemon/tests/services/intention-service.test.ts` | ` M` | blob 1a2f4ad3ab2b0e390879e4fb0476a63731eed5c2 (mode 100644, stage 0) | SHA-256 a3f9590ea32d15f28ef4a8bffa1cdd91b10b9426e7ae59b05a19e98c7fa39c91 |
| `packages/daemon/tests/services/owner-game-note-service.test.ts` | ` M` | blob 2c3c188aae82252c4b92869cca43dd2fd04100f0 (mode 100644, stage 0) | SHA-256 a1af0cb937662749e91f5732e9cf001cdaed4934a97f36eac00ff7ab60f3c074 |
| `packages/daemon/tests/services/prediction-service.test.ts` | ` M` | blob 544e06b58b1e89873872c8eeb1d84d3caee923f1 (mode 100644, stage 0) | SHA-256 5ba3bc0664aff93b84285fc858ed65a4dd625d5e458890ad7d201580b69f36d9 |
| `packages/daemon/tests/services/purchase-utilization-service.test.ts` | ` M` | blob d40efa387372d7e95ddeb3e57ae4cfe65322ffad (mode 100644, stage 0) | SHA-256 5c2de3707f83e72e19f94169c471b9003c3de67265f782d4692d6afa92ce2c0c |
| `packages/daemon/tests/services/reflection-evidence-projections.test.ts` | ` M` | blob 4292df7fceb177e2847f50cc59538dad3e085925 (mode 100644, stage 0) | SHA-256 7ebf0045a312c036c6746b68fe814f0370e104bb60fd11cbd0de677d93585c64 |
| `packages/daemon/tests/services/storage-collection-migration.test.ts` | ` M` | blob d86e7e4b2a7ff58c6494442c06c5a6196f2da811 (mode 100644, stage 0) | SHA-256 158e9d38af6400ee0ed25ef4de32a83dc6f391fb0bc05d13c3d214e5157d9e63 |
| `packages/daemon/tests/services/storage-service.test.ts` | ` M` | blob 37b931f98f787cc7f338cef348cce89ac1e556c6 (mode 100644, stage 0) | SHA-256 7937645321e87fb3544ea3ef2ec11fde9fd94e08420149efd30da1b1e2279fc7 |
| `packages/daemon/tests/shelf-routes.test.ts` | ` M` | blob cf87e67de32ec86e9970a0920751fd859e3d943f (mode 100644, stage 0) | SHA-256 4c96cd87335bf9d0bdf1b671f3063a008f9c67e2948aee9259abd4f2e140664b |
| `packages/daemon/tests/shelf-service.test.ts` | ` M` | blob 6ef15e45fdf3490be74d4ad13c060478a05075c8 (mode 100644, stage 0) | SHA-256 edeba545503eb8f8d8e9023ba3daa551da276e0b0febbaf124399eac63c7bb7a |
| `packages/daemon/tests/wishlist-service.test.ts` | ` M` | blob 95bf32c1da0fe599284589cd539246ebcf2e86d3 (mode 100644, stage 0) | SHA-256 3b07d9305bddb5db564ea9da1afd99f53bb9221ce3a9878e55784edd56773361 |
| `packages/shared/src/collection-profile-validation.ts` | ` M` | blob aefe4af6c1fbb53f8ac22975fd6a3115e7048a0e (mode 100644, stage 0) | SHA-256 bb8826be652e572bce990fe9cfd78eb85541b541a1d194af7fcc737f0af9ad29 |
| `packages/shared/src/index.ts` | ` M` | blob 123b209262fce0cf537aec4a3f1207e136726a07 (mode 100644, stage 0) | SHA-256 ed86f53490ce7e76d8957c872ff6941e382b659bca04edf7dfd8bc434b9949cb |
| `packages/shared/src/types.ts` | ` M` | blob 15028ef34d3484ad4d7238a44657e0e1193079ce (mode 100644, stage 0) | SHA-256 0b8c5958791182f4357a8b48fd38837e7d5c4cc9193feec6213aad2fa4319f9d |
| `packages/shared/src/validation.ts` | ` M` | blob 6428ac6339fec020362caedebad3d50f6646db36 (mode 100644, stage 0) | SHA-256 27e2243391b31671bfeb80a6147eb3ef8d2789265b4207427b270eb63016dd86 |
| `packages/shared/tests/current-axis-validation.test.ts` | ` M` | blob 258383123ef36da0f3893c04062f4a016d4632c6 (mode 100644, stage 0) | SHA-256 4259c46c32c5105a755b07ead1dc2f0995f976d1243e95ee01e06529afa40591 |
| `packages/shared/tests/derived-axis-registry.test.ts` | ` M` | blob 32f19ca96863ab63a71226265941ee973ce56e48 (mode 100644, stage 0) | SHA-256 9c9472e818127f0741b137e3edf1e2cf58ef20b1bfc39a1b4b550f64658f6d4b |
| `packages/shared/tests/fixtures/useful-profile.ts` | ` M` | blob 8edc06695f728c0371f95dd8eeea77a8f7a168d3 (mode 100644, stage 0) | SHA-256 ac93a7d7886e17f4f33307585a8e7d34f55ec4e515efa0ed3402c8129da92c78 |
| `packages/shared/tests/owner-game-note.test.ts` | ` M` | blob b33194447f6323445b9b91a47ff20447a3a524df (mode 100644, stage 0) | SHA-256 a99738bf0201fc1666827026e9d8999aaf631bad78a67adfaf15e65b74277d56 |
| `packages/shared/tests/useful-profile-contract.test.ts` | ` M` | blob 690efa2383a4cdec153074e43b6a01afb6019348 (mode 100644, stage 0) | SHA-256 481f6b722e2cae747a022beb817894625ddcb5819f2c82b634d10dbea6e97eaf |
| `packages/web/components/intention-controls.tsx` | ` M` | blob 45b0cfc4c9beacaf554459bc854bb217a70d507f (mode 100644, stage 0) | SHA-256 e06adf2a7c9e9d0f76b7b993d18c3fe09987db66dfcb794f61609e5593af35f8 |
| `packages/web/components/intention-history.tsx` | ` M` | blob d08f04790b3b57eabed574f08c57884d109f59d0 (mode 100644, stage 0) | SHA-256 7644255f8d2d7b11ae837e9bf67b2f01aa64c19a9b228393f53ebfefff51fdc0 |
| `packages/web/components/profile/attention-section.tsx` | ` M` | blob 731bff3f5c5fbe62dc05f2273a1c57670d305ec0 (mode 100644, stage 0) | SHA-256 c2657fd71d01e15801986b5f03bd9ebe8d58a596b0859fd202870a851ad782b6 |
| `packages/web/components/profile/entity-card.tsx` | ` M` | blob 378ed6ad4e26dcfcc61b58ad6ca7f639b922f220 (mode 100644, stage 0) | SHA-256 7f0b2e314c996dee9cfbf1cd007fc6dd3cdec825550cc1dd729bd4545e2df1ef |
| `packages/web/e2e/fixture-daemon.ts` | ` M` | blob 0d48fa5070db5641702c7d22b7f13cc3accec132 (mode 100644, stage 0) | SHA-256 aae5c32e21557310829bb9791a96422231dd06ecc9b0c4e1100057f7ce34762c |
| `packages/web/e2e/useful-profile.pw.ts` | ` M` | blob 61a5725bfeae0919cd60d62497f94304f8dcbeda (mode 100644, stage 0) | SHA-256 c912bddd3fabb7fd452fa2d5cedd88d3a9743ca8af06e4010aa67b9818ea8627 |
| `packages/web/lib/browser-mutations.ts` | ` M` | blob 9265788a7c2663350841048fa81bd57d58b63489 (mode 100644, stage 0) | SHA-256 fb69dfc853f424dc371af810e855afed938e348120c89cd5d1d8fe1ba0736b2b |
| `packages/web/tests/browser-mutations.test.ts` | ` M` | blob 404a9a71ab5cf39e722b8030d9f4ac2befd6719d (mode 100644, stage 0) | SHA-256 d9b747e0866d21049f4f0e02c05e4127752c8cd5e66fec369929ae64326e9211 |
| `packages/web/tests/intention-controls.test.tsx` | ` M` | blob b310bbc0734e94f20f265737e982bc9d7ff443a7 (mode 100644, stage 0) | SHA-256 0f53e9d66bc7b42f2a307baaec3b430deb1cf37bb78bb83b7f433410613f99de |
| `packages/web/tests/intention-history.test.tsx` | ` M` | blob 72fde7af0063eadd7290e00d19387cb8d7e0be25 (mode 100644, stage 0) | SHA-256 d8122738b127ccc4161901d66b8914835c7c2db16791d62b349b8038da4c8e85 |
| `packages/web/tests/profile-consumers-integration.test.tsx` | ` M` | blob 29733547e5cd3efb3988b3335dbaf74451ac0938 (mode 100644, stage 0) | SHA-256 98a1d887600070dd5424fea46c9c5459a1b5b66c77af2a4489ab28d310c799e7 |
| `.lore/work/notes/shelf-judge-a8l.md` | `??` | absent from index | self-referential manifest marker: SHA-256 intentionally omitted |

The notes file is included as an untracked changed path. Its own working-tree SHA-256 is intentionally omitted and marked self-referential: recording a hash here would change that hash. All other entries use the working-tree bytes present at this acceptance snapshot.
