---
title: "Implementation notes: adjusted-fit profile ranking"
date: 2026-08-29
status: complete
tags: [implementation, notes, collection-profile, adjusted-fit]
source: .lore/work/plans/adjusted-fit-profile-ranking.md
modules: [shared, daemon, cli, web]
related:
  - .lore/work/research/profile-appreciation-scoring.md
  - .lore/work/specs/useful-collection-profile.md
  - .lore/work/design/profile-evidence-explorer.md
---

# Implementation notes: adjusted-fit profile ranking

## Progress

- [x] Phase 1: Reconcile the target contract and discriminating fixtures
- [x] Phase 2: Perform the workspace-wide contract and producer cutover
- [x] Phase 3: Prove cache invalidation and persistence behavior
- [x] Phase 4: Update daemon API and CLI boundaries
- [x] Phase 5: Update the web validation boundary and overview
- [x] Phase 6: Update the entity explorer, URL compatibility, and full evidence
- [x] Phase 7: Update shared browser fixtures and end-to-end behavior
- [x] Phase 8: Update user documentation and complete terminal validation

## Obligations And Validation

| Obligation                                                                                                       | Phase | Executable validation                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Amend the active contract and preserve unrelated profile behavior                                                | 1     | Requirements and scenario review against the amended spec and explorer design                                                                                                           |
| Produce and independently validate exact adjusted fit, orderings, and overview IDs under contract 9/algorithm 11 | 2     | Shared contract tests, engine tests, package typechecks, workspace typecheck, and build                                                                                                 |
| Reject old caches, round-trip current caches, and invalidate changed policy snapshots                            | 3     | Persistence, storage, profile-service, and persisted-flow tests                                                                                                                         |
| Validate daemon results at the HTTP boundary and preserve exact validated JSON through the CLI                   | 4     | `bun test packages/daemon/tests/routes/profile.test.ts packages/cli/tests/client.test.ts packages/cli/tests/commands/profile.test.ts`                                                   |
| Render daemon-selected overview evidence without local ranking                                                   | 5     | Focused web API/consumer suite passed 40 tests with 0 failures and 133 assertions; web TypeScript compilation, workspace typecheck, `git diff --check`, source audit, and review passed |
| Preserve exact supplied drilldown order, URL compatibility, evidence, and accessibility                          | 6     | Focused suite passed 30 tests and 174 assertions; web TypeScript, workspace typecheck, browser typecheck, `git diff --check`, source audit, and review passed                           |
| Exercise canonical adjusted-fit behavior in real browser layouts                                                 | 7     | Browser typecheck and Chromium suite at the required viewports and zoom                                                                                                                 |
| Reconcile documentation and all cross-cutting release requirements                                               | 8     | 229 focused tests, 2,274 full-suite tests, 86 browser tests, typechecks, corrected lint, build, formatting, diff checks, source audit, and accepted review                              |

## Log

- 2026-08-29: Recorded Phases 1 through 3 as previously accepted from the current amended specification/design, contract 9/algorithm 11 shared producer and validator artifacts, and persistence/cache coverage.
- 2026-08-29: Began Phase 4 for bead `shelf-judge-g0r.4`. Added embedded-policy validation followed by complete policy-aware result parsing before daemon serialization. The unavailable branch uses the default policy union without loading configuration.
- 2026-08-29: Added route and client boundary cases for legacy `rating`, missing and forged adjusted values, wrong `bestFit` order, and unsupported overview IDs. Existing canonical fixture matrices continue to assert complete pass-through for available state variants and unavailable results.
- 2026-08-29: The separate Step 4 gate reported `STEP4-TYPE-1`: daemon/workspace typecheck failed with TS2540 because the invalid-policy route test assigned to readonly `minimumSupportedGames`.
- 2026-08-29: Corrected `STEP4-TYPE-1` by immutably reconstructing the malformed embedded policy with `minimumSupportedGames: 0`; the HTTP 500 assertion remained unchanged.
- 2026-08-29: Phase 4 accepted. The focused daemon route and CLI client/command suite passed 36 tests; daemon TypeScript compilation passed; CLI TypeScript compilation passed; workspace `bun run typecheck` passed; and `git diff --check` passed. The bun-typescript review accepted the implementation with no findings.
- 2026-08-29: Final Phase 4 changed paths: `packages/daemon/src/routes/profile.ts`, `packages/daemon/tests/routes/profile.test.ts`, `packages/cli/tests/client.test.ts`, and `.lore/work/notes/adjusted-fit-profile-ranking.md`.
- 2026-08-29: No changes were required in `packages/cli/src/client.ts`, `packages/cli/src/commands/profile.ts`, or `packages/cli/tests/commands/profile.test.ts`; their existing transparent validated-result pass-through behavior was already correct.
- 2026-08-29: Began Phase 5 for bead `shelf-judge-g0r.5`. Preserved the existing policy-aware `getProfile` boundary without a production API change; added explicit forged-adjusted-value and legacy-`rating` rejection cases.
- 2026-08-29: Passed the validated entity policy from the overview page to each class section. Overview cards still resolve only the supplied `overviewEntityIds`, now lead with a one-decimal `Adjusted fit`, and present raw mean, class comparator, and associated-game count as secondary collection-association evidence.
- 2026-08-29: Added a supplied-ID fixture whose daemon order conflicts with physical entity order, raw mean, and count, plus assertions for the class minimum as both support threshold and comparator weight and for forbidden confidence, causal, preference, significance, probability, and appreciation language.
- 2026-08-29: Source inspection found no `.sort`, `localeCompare`, aggregate reduction, adjusted-fit formula, or support-derived overview selection in the changed web profile production surface.
- 2026-08-29: The initial Phase 5 coverage pass reported `STEP5-COV-1`: the discriminating supplied-order fixture asserted all four evidence values for only its first card, and `STEP5-COV-2`: forbidden-language coverage did not explicitly connect representation or share language to appreciation.
- 2026-08-29: Corrected both coverage gaps without production changes. The supplied-order case now scopes assertions to every rendered card, verifies each card's adjusted fit, raw mean, class comparator, and associated-game count, and confirms the evidence uses semantic definition-list labels. Language coverage now explicitly checks `favorite`, `preferred`, `responsible`, and `confidence`, plus representation/share-as-appreciation phrasing.
- 2026-08-29: Phase 5 accepted. The focused web API/consumer suite passed 40 tests with 0 failures and 133 assertions; web `tsc` passed; workspace typecheck passed; `git diff --check` passed; and the source audit found no local sorting, reduction, adjusted arithmetic, or support-derived overview logic. The reviewer accepted the implementation with no findings.
- 2026-08-29: Final Phase 5 changed paths: `packages/web/app/page.tsx`, `packages/web/components/profile/identity-section.tsx`, `packages/web/components/profile/entity-card.tsx`, `packages/web/tests/profile-api.test.ts`, `packages/web/tests/profile-consumers-integration.test.tsx`, and `.lore/work/notes/adjusted-fit-profile-ranking.md`. No change was required in `packages/web/lib/api.ts`.
- 2026-08-29: Began Phase 6 for bead `shelf-judge-g0r.6`. Made `bestFit` the explorer default and added pre-render canonicalization for legacy `rating`, explicit `bestFit`, and empty `order`; canonicalization removes only `order`, preserves repeated and unrelated query fields, and returns no redirect for an already canonical URL or explicit `support`/`name` ordering.
- 2026-08-29: Updated the native ordering control and compact index to lead with “Adjusted fit,” label count ordering “Associated game count (diagnostic),” retain raw mean and visible comparator/count/support/matched-game context, and explain that equal rounded displays remain ordered by exact unrounded values.
- 2026-08-29: Extended the selected dossier with adjusted fit while retaining raw mean, class comparator, signed difference, population standard deviation, range, supporting games, and veto labels. Limited evidence now uses the serialized class policy count to explain when adjusted evidence can leave the drilldown; the web does not infer support from that count.
- 2026-08-29: Added Phase 6 URL, generated-link, no-JavaScript form, reload, entity-selection, supplied-order/filter, equal-rounded-display, overview-invariance, visible evidence, narrow-layout, accessible wording, and source-audit assertions.
- 2026-08-29: Initial Phase 6 coverage review reported `STEP6-COV-1`: redirect assertions stopped at the pure canonical URL helper and did not exercise the page boundary or prove profile fetching was suppressed, and `STEP6-COV-2`: native GET coverage did not demonstrate submission-to-redirect-to-reload convergence with canonical entity-selection links.
- 2026-08-29: Corrected `STEP6-COV-1` through a narrow page dependency seam consistent with the API client’s existing function injection. Page-boundary cases now prove `rating`, explicit `bestFit`, and empty `order` redirect once before profile loading while preserving arbitrary and repeated fields; omitted order, `support`, and `name` load and render directly.
- 2026-08-29: Corrected `STEP6-COV-2` with focused rendered-form evidence and a page-boundary native GET flow. The default `bestFit` select submission redirects without loading, the canonical omitted-order reload loads once without another redirect, and entity links retain class, support, query, and default-order omission. Mobile viewport, zoom, and client focus movement remain Phase 7 browser validation rather than Phase 6 blockers.
- 2026-08-29: The focused Phase 6 retest reported `STEP6-TEST-1`: the native GET test selected the ordering form with a regex that required `method` before `class`, while React rendered those attributes in the reverse order.
- 2026-08-29: Corrected `STEP6-TEST-1` without production changes. The test now enumerates forms without assuming attribute order, identifies the intended form by its `entity-order` select, and independently verifies GET semantics before retaining all submitted-field, convergence, reload, and entity-link assertions.
- 2026-08-29: Phase 6 accepted. The focused profile drilldown and accessibility/removal suite passed 30 tests with 174 assertions; web `tsc` passed; workspace typecheck passed; browser typecheck passed; `git diff --check` passed; and the source audit found no local sort, adjusted arithmetic, rounded comparison, support inference, or generated legacy ordering URL. The reviewer accepted the implementation with no findings.
- 2026-08-29: Browser-only viewport, zoom, and client focus-movement validation intentionally remains in Phase 7 and was not a Phase 6 acceptance blocker.
- 2026-08-29: Final Phase 6 changed paths: `packages/web/app/profile/entities/page.tsx`, `packages/web/components/profile/entity-evidence.tsx`, `packages/web/tests/profile-drilldowns.test.tsx`, `packages/web/tests/profile-accessibility-and-removal.test.ts`, and `.lore/work/notes/adjusted-fit-profile-ranking.md`. No changes were required in `packages/web/components/profile/entity-explorer-focus.tsx` or `packages/web/app/globals.css`.
- 2026-08-29: Began Phase 7 for bead `shelf-judge-g0r.7`. Reworked the browser daemon's 168-row mechanic fixture around the strict-valid canonical limited-outlier evidence instead of cloning away the limited entity or assigning one convenient sequence to every ordering. `Solo` leads `bestFit` while remaining excluded from overview, supported `Worker Placement` leads diagnostic `support`, and `name` plus overview IDs remain exact-consistent with the shared validator.
- 2026-08-29: Extended browser assertions for adjusted-primary/raw-secondary overview and dossier evidence, the default Adjusted fit control and diagnostic count label/order, legacy `order=rating` canonicalization with repeated unrelated fields preserved, limited-first drilldown behavior, supported-only overview membership, and overview invariance after count sorting.
- 2026-08-29: Preserved and extended the existing real-browser coverage for native no-JavaScript GET submission and canonical default convergence, keyboard operation, direct links, detail focus and mobile result restoration, class evidence, intrinsic and filtered empty states, dark theme, literal zoom metrics, horizontal clipping/overflow, hover-independent content, 44px targets, text contrast, and 16px mobile input text. The established Playwright projects remain 375x812, 768x1024, 1440x900, and literal 200% browser zoom.
- 2026-08-29: Initial Phase 7 validation reported a passing browser typecheck. The browser matrix reported 82 passed, 30 skipped, and 4 failed, with the same support-order overview-navigation race reproduced across all four Chromium profiles.
- 2026-08-29: Initial review recorded `STEP7-E2E-1`: after clicking “Back to profile,” the test read overview names before client navigation and profile rendering completed, so `allTextContents()` observed the still-active explorer and returned an empty array.
- 2026-08-29: Corrected `STEP7-E2E-1` without changing production behavior or weakening overview invariance. The flow now waits concurrently for the link click and canonical root URL, then requires the Collection Profile heading and all three supported overview cards before asserting their unchanged exact names.
- 2026-08-29: The browser rerun after `STEP7-E2E-1` reported 83 passed, 30 skipped, and 3 failed. The 375x812 mobile profile passed the input-zoom check; tablet, desktop, and literal-200% profiles each reached the same assertion and failed because their intentional input font size is 15px.
- 2026-08-29: Review recorded `STEP7-E2E-2`: the 16px input-font assertion applied the mobile browser auto-zoom release criterion to all projects instead of only the actual mobile profile.
- 2026-08-29: Corrected `STEP7-E2E-2` without changing CSS or weakening any other matrix assertion. Only the input-font measurement is now scoped to `chromium-mobile`; dark-theme contrast, overflow, touch-target, axes, and all subsequent checks remain unconditional for every profile.
- 2026-08-29: Reviewer finding `S7-001` identified that `docs/screenshots/profile.png`, referenced by `docs/usage.md`, still showed the retired pre-adjusted-fit profile UI after browser acceptance.
- 2026-08-29: Regenerated `docs/screenshots/profile.png` from the deterministic browser fixture's default validated `profile` scenario using Playwright's built-in screenshot command. The capture retained the documentation set's 1400x900 dark-theme convention and waited for rendered `Adjusted fit` content rather than using a fixed delay.
- 2026-08-29: The regenerated PNG visibly contains the supported mechanic overview with adjusted fit as primary evidence and raw mean, class comparator, and associated-game count as secondary evidence. Artifact metadata is 1400x900 RGB, 74,449 bytes, SHA-256 `58d6433f2e477e58a2d0acbb364a8dc7cec95a66623aac85343cdd75c7ef12c2`.
- 2026-08-29: The first capture invocation used an invalid `bunx --cwd` form and failed before browser launch or artifact modification; the successful invocation used the repository-installed `packages/web/node_modules/.bin/playwright` executable directly. Fixture and web processes were cleaned up after both attempts.
- 2026-08-29: Final Phase 7 validation passed browser typecheck and the full browser suite with 86 passed, 30 intentional skips, and 0 failed across 375x812, 768x1024, 1440x900, and literal 200% browser zoom. `git diff --check` passed.
- 2026-08-29: Phase 7 acceptance includes the `STEP7-E2E-1` navigation/render synchronization correction and the `STEP7-E2E-2` mobile-only input-zoom assertion correction. All contrast and later matrix assertions remain unconditional.
- 2026-08-29: Reviewer finding `S7-001` was resolved by the regenerated and verified 1400x900 dark screenshot at `docs/screenshots/profile.png`; it visibly shows adjusted fit as primary evidence with raw mean, class comparator, and associated-game count evidence. Verification review accepted Step 7 with no remaining findings.
- 2026-08-29: Phase 7 complete. Final Step 7 changed paths: `packages/web/e2e/fixture-daemon.ts`, `packages/web/e2e/useful-profile.pw.ts`, `docs/screenshots/profile.png`, and `.lore/work/notes/adjusted-fit-profile-ranking.md`. Overall implementation remains in progress with Phase 8 pending.
- 2026-08-30: Began the documentation portion of Phase 8 for bead `shelf-judge-g0r.8`; Phase 8 remains incomplete pending terminal validation and final review.
- 2026-08-30: Recorded the pre-edit root `bun run format:check` baseline from the prior report: seven failures. The four feature paths were `.lore/work/notes/adjusted-fit-profile-ranking.md`, `packages/web/app/profile/entities/page.tsx`, `packages/web/tests/profile-accessibility-and-removal.test.ts`, and `packages/web/tests/profile-consumers-integration.test.tsx`. The three ignored Beads state files were `.beads/backup/backup_state.json`, `.beads/export-state.json`, and `.beads/push-state.json`.
- 2026-08-30: Audited active usage documentation, the amended useful-profile specification and explorer design, current profile UI and accessible labels, component tests, and browser coverage. Corrected stale usage versions and fixed-threshold language, documented adjusted-fit arithmetic and ordering semantics, and replaced the overview's fixed one/two-game limited-evidence wording with configured-policy language. Existing `order=rating` occurrences are compatibility-input implementation, documentation, or coverage rather than generated URLs; no stale raw-mean ranking, causal, universal-quality, confidence, favorite, preferred, or representation-as-appreciation claim required another correction.
- 2026-08-30: Reconciled the active specification with the shipped cache lifecycle by recording profile contract 9, algorithm 11, collection schema 5, entity-policy mismatch regeneration, and deferred external prevalence correction. The explorer design already matched final adjusted-fit behavior and required no additional Phase 8 edit.
- 2026-08-30: Ran `bunx prettier --write` with an explicit list of all 27 feature-changed supported text files. Prettier completed successfully; it changed the Phase 8 notes and the three feature paths already named in the baseline, reported the other 23 files unchanged, and did not receive any ignored Beads state file, `.beads/*.jsonl`, or binary screenshot path. A final notes-only Prettier write followed this log entry.
- 2026-08-30: Phase 8 terminal validation reported one finding, `STEP8-LINT-1`: strict ESLint flagged `@typescript-eslint/no-unsafe-assignment` in the two daemon HTTP 500 tests because `expect.any(String)` introduced `any` into the envelope assertions.
- 2026-08-30: Corrected `STEP8-LINT-1` without changing production behavior or weakening the envelope check. A typed helper now requires an exact object with only an `error` field and verifies that field is a string. Tests and lint were not rerun for this correction; Phase 8 remains incomplete pending terminal validation rerun and final review.
- 2026-08-30: The correction rerun passed repository lint with 0 errors, the focused daemon route suite with 17 tests, 0 failures, and 43 assertions, workspace typecheck, focused Prettier, and `git diff --check`. The helper accepts `unknown`, rejects null and arrays, requires exactly the `error` key, and verifies a string value without `any`, assertions, or unsafe casts.
- 2026-08-30: Final terminal acceptance passed the 13-file focused gate with 229 tests, 0 failures, and 902 assertions; the full repository suite with 2,274 tests passed, 1 skipped, 0 failed, and 9,062 assertions across 127 files; and the browser matrix with 86 passed, 30 intentional skips, and 0 failed across 116 configured tests. Workspace and browser typechecks and the production build passed.
- 2026-08-30: All 27 feature-changed supported text files passed explicit Prettier checking, and `git diff --check` passed. Root `bun run format:check` reported only `.beads/backup/backup_state.json`, `.beads/export-state.json`, and `.beads/push-state.json`, the accepted pre-existing generated Beads baseline; no feature or additional path failed formatting.
- 2026-08-30: Contract and source audits confirmed profile contract 9, algorithm 11, collection schema 5, strict disposal rather than migration of old or malformed profile caches, independent exact arithmetic, supported `bestFit` overview selection, diagnostic count semantics, class isolation, no generated legacy ordering URL, and no representation-as-appreciation or stale raw-mean ranking claim.
- 2026-08-30: Final review accepted the implementation with no material findings. It traced the formula, configured prior, exact ordering, count semantics, limited evidence, cache regeneration, class isolation, complete validated boundaries, URL compatibility, documentation, and current screenshot.

## Residual Risks

- Validation used installed Bun 1.3.11 while `package.json` declares Bun 1.4.0. No failure was attributed to the difference, but exact declared-toolchain reproduction remains unproven.
- Profile browser validation uses a 720x450 CSS viewport at DPR 2 as the 200% zoom equivalent. The literal Chromium 200% probe directly exercises collection detail rather than the profile page. The profile matrix separately proves equivalent responsive reflow, overflow, target, and evidence behavior, so review accepted this as non-material.

## Final Changed-Path Manifest

The manifest below records the final `git status --short` snapshot. For every changed path except this notes file, it records the index blob identity or an absent marker and the working-tree SHA-256 or deletion marker. The notes file's own working-tree hash is intentionally excluded because embedding that hash in this file would change the hash and make the record self-referential; its index state is still recorded.

```text
 M .beads/interactions.jsonl
 M .beads/issues.jsonl
 M .lore/work/design/profile-evidence-explorer.md
 M .lore/work/plans/adjusted-fit-profile-ranking.md
 M .lore/work/specs/useful-collection-profile.md
 M docs/screenshots/profile.png
 M docs/usage.md
 M packages/cli/tests/client.test.ts
 M packages/daemon/src/routes/profile.ts
 M packages/daemon/src/services/collection-profile-engine.ts
 M packages/daemon/tests/collection-profile-engine.test.ts
 M packages/daemon/tests/integration/useful-profile-persisted-flow.test.ts
 M packages/daemon/tests/routes/profile.test.ts
 M packages/daemon/tests/services/profile-persistence.test.ts
 M packages/shared/src/collection-profile-validation.ts
 M packages/shared/src/types.ts
 M packages/shared/src/validation.ts
 M packages/shared/tests/fixtures/useful-profile.ts
 M packages/shared/tests/useful-profile-contract.test.ts
 M packages/web/app/page.tsx
 M packages/web/app/profile/entities/page.tsx
 M packages/web/components/profile/entity-card.tsx
 M packages/web/components/profile/entity-evidence.tsx
 M packages/web/components/profile/identity-section.tsx
 M packages/web/e2e/fixture-daemon.ts
 M packages/web/e2e/useful-profile.pw.ts
 M packages/web/tests/profile-accessibility-and-removal.test.ts
 M packages/web/tests/profile-api.test.ts
 M packages/web/tests/profile-consumers-integration.test.tsx
 M packages/web/tests/profile-drilldowns.test.tsx
?? .lore/work/notes/adjusted-fit-profile-ranking.md
```

| Path                                                                      | Index blob or state                        | Working-tree SHA-256 or state                                      |
| ------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------ |
| `.beads/interactions.jsonl`                                               | `450d1d3afa80f035fef86a0b016b54b60321a000` | `7ce0feb5d701c19299d9e195c1de5cecf6e11d2cbb61e4ba85e9880babd59e26` |
| `.beads/issues.jsonl`                                                     | `5aff881f21d8fd4c3e39bb2224bf2768a829ce61` | `1490dd3ef7d4c03ad35b6eaed42f6f5ac64d52949a31f1f01b1c88bcd0dde61f` |
| `.lore/work/design/profile-evidence-explorer.md`                          | `6937e8c46b0cd8aa458aeb9b60cea6e0a81e3740` | `4dd9b6405189ae0ac17f2502835478d98bbc1ab8b291322c6252248ff292a3d9` |
| `.lore/work/plans/adjusted-fit-profile-ranking.md`                        | `dfca7d80d473833baa9bc71dfa0605926c4e685c` | `72c6ee1a0d45421c5cfbf5c43fc651a0680cf633c3d489cfa0e2323f78b8b92d` |
| `.lore/work/specs/useful-collection-profile.md`                           | `a7a56fa12fa007fa207c472b643fa76d541e3a0c` | `8d0fbe7db8c20982589bc29d9b576f6478cb5d689b7f183f306da55f752101c3` |
| `docs/screenshots/profile.png`                                            | `127e3483be55392045066c8ab61354a6afd77ffd` | `58d6433f2e477e58a2d0acbb364a8dc7cec95a66623aac85343cdd75c7ef12c2` |
| `docs/usage.md`                                                           | `abd42de3abe296850afcfcebc603558b372ee3db` | `e78141b0374ff0bbd04bbd52803bdf203d7e96102520a844bd99c98bb99cf35f` |
| `packages/cli/tests/client.test.ts`                                       | `2c18967df1e9b53b40808ef396cbad8d958e4201` | `ab0454edd7c565647a013a7a221f540135da690944d14bab0ec715890a1646a0` |
| `packages/daemon/src/routes/profile.ts`                                   | `7bedfe732b5dbc4eb3e803c704ce2ab71528cd44` | `627c5a5f16d59200e2166901106e8602e25752cce0c29c3ee22e8801da2a1514` |
| `packages/daemon/src/services/collection-profile-engine.ts`               | `6cb39a63da06ca903ce38edbff88c385171cf340` | `2ce536ce83de6fc071646a0f42e1d0bf3e1c46a36b8351aea399d3894056af06` |
| `packages/daemon/tests/collection-profile-engine.test.ts`                 | `64e23e77f660ebe134e6369e54194d884e67a54a` | `c89c589bf03a3714beea0987a081ab08f92f6c1b6d675f537b1b4afa16e24b2e` |
| `packages/daemon/tests/integration/useful-profile-persisted-flow.test.ts` | `12ca9ab20fc08449dab2804f6bb6bd40602cbbe6` | `06b26fe01ef41111e63591c8d97b963e9b74a0025f5505e07aed90e157428ad7` |
| `packages/daemon/tests/routes/profile.test.ts`                            | `594d761350856d922a20a86af855de25baf7e138` | `352a5ba62eeae22d3a22ac459dc0187b077003b0dc4443ac3240376c35fb0e21` |
| `packages/daemon/tests/services/profile-persistence.test.ts`              | `5b6e637a71d38c1bcf1045d5f87823235b7a7fe3` | `a9d9307243702712cd82f21a5c94a175d35b14c7079ef38acbd7a737d6c005ba` |
| `packages/shared/src/collection-profile-validation.ts`                    | `6422d8a689e39b7cc315e786217a9c40425813bc` | `a7acf001e1daadc21323f579827557b02ce0362e65fabb375f1b244556a877aa` |
| `packages/shared/src/types.ts`                                            | `f606022a25af93196b0e2e3894d501c58cae3053` | `d975f075ae911d82a16477cd0dc72ef5555f0bb2a56f995dcb245bdb632ec528` |
| `packages/shared/src/validation.ts`                                       | `60dc8356540513d37f392712ea68c4a651358daa` | `c0c8a3d63b39712d2d8f787babdd3ee1aa2449f0ef23fb5f78ba6214d5d47d53` |
| `packages/shared/tests/fixtures/useful-profile.ts`                        | `dbef9ebfd81d80aedbfecf0c25e9dfa3ab4847c5` | `49524fc9ca862b5e4ea055a749d688bfa780476a777201043da0e08acb171abb` |
| `packages/shared/tests/useful-profile-contract.test.ts`                   | `948bf15ad9dfab16e57ce257ee74f55439d60031` | `14c85bd185c57d3729e101ed206980f755ee8e82977aa9b33538f8f81744fc91` |
| `packages/web/app/page.tsx`                                               | `e4968924b6bbf021ad44b7e52c487becdcb15a6f` | `15508ae2a44db440315ec68357ca67b2bd587b20906fd7ef073fbb7970dae89b` |
| `packages/web/app/profile/entities/page.tsx`                              | `3068f34e6d3957b90d57b2370565ec9b2ad38da4` | `fcb3e8f217fb62d13eeac780a80dcad90f3962506d5e8243b822d5755cf8641f` |
| `packages/web/components/profile/entity-card.tsx`                         | `4c65bc5404765984596182c49a7d90ba286d443c` | `e3131a66efe36e35b13287d89859c4651d47bb537ec9dfe068e1a5f8a19b0629` |
| `packages/web/components/profile/entity-evidence.tsx`                     | `314c3ba28fcb77ee3fa891f9d9c34f91da76eb81` | `2a4f5b5a2911319eeefdb623112a0cf8b4974e7ee7fe2c1c49d346ee74ab0c63` |
| `packages/web/components/profile/identity-section.tsx`                    | `f523f025abe93f7bd27e43bcbd614ea7465f1711` | `83a3432a18960f80e3ad8657ca38f09a082276187922814ce12681d2f2443c18` |
| `packages/web/e2e/fixture-daemon.ts`                                      | `887f6aa96cf1b143a6de3b64615ddd42434cb531` | `5969a492ed74ba0ebb89a705f86367cb7b1e3fff7c684f880869e583982aa859` |
| `packages/web/e2e/useful-profile.pw.ts`                                   | `45e404d7180b8ac50e605d00357ee2e77dc359bd` | `0710af59bded0700dccd60803c3f3f424c9f138ec6c501a4cd0deab696955dbf` |
| `packages/web/tests/profile-accessibility-and-removal.test.ts`            | `8fa3e8006b3e8199599db1ec2b448c8d45978263` | `6ce304466af9221680314226b631db40bf53424e528f3ac7f47d9b4bec82ac4d` |
| `packages/web/tests/profile-api.test.ts`                                  | `c788e01abcd2dc4e8b4e03e1c699f052a771484d` | `1225a87316a63e1943ea35b066704bd66612258134c068fbd7e8868b08fff97c` |
| `packages/web/tests/profile-consumers-integration.test.tsx`               | `aa915cca700a25a4bcab13cbb9164fb715fa1104` | `11e9c9d3b9d059bad1f0f64a6659ea7d93638de65b980022749c0255f724472f` |
| `packages/web/tests/profile-drilldowns.test.tsx`                          | `da083d39564d07480bb01734346d724c50ae67b2` | `663e0c82796b9ae6c24743f087a6691d0ae0976cc43819036d405c3f40c54f68` |
| `.lore/work/notes/adjusted-fit-profile-ranking.md`                        | absent from index (untracked)              | excluded because embedding its own hash would be self-referential  |
