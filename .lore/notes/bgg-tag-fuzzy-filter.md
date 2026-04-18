---
title: "Implementation notes: bgg-tag-fuzzy-filter"
date: 2026-04-06
status: complete
tags: [implementation, notes, tournament, filtering, bgg]
source: .lore/specs/bgg/bgg-tag-fuzzy-filter.md
modules: [shared, daemon, web]
---

# Implementation Notes: BGG Tag Fuzzy Filter

## Phases

1. **Shared helper + unit tests** — Add `matchesBggTag(query, tagNames)` in `packages/shared`, export from barrel, colocated tests covering every REQ-BGG-TAG-2/3 example and edge case.
2. **Daemon integration** — Replace the inline `bggTag` predicate in `packages/daemon/src/services/tournament-service.ts` with the shared helper. Update daemon tests to cover the new semantics.
3. **Web integration** — Replace the inline `bggTag` predicate in `packages/web/app/tournament/page.tsx` `countMatchingGames` with the shared helper. First runtime import from `@shelf-judge/shared` in the web package — confirm workspace resolution works at build time.

## Progress

- [x] Phase 1: Shared helper + unit tests
- [x] Phase 2: Daemon integration
- [x] Phase 3: Web integration
- [x] Holistic validation against spec

## Log

### Phase 1: Shared helper + unit tests

- Built `matchesBggTag` + `normalizeBggTagTokens` in `packages/shared/src/bgg-tag-match.ts`, exported via barrel. 13 colocated tests.
- Review flagged a spec divergence: initial regex `/[^a-z0-9\s]/g` stripped all non-ASCII characters (e.g. `"Café"` → `"caf"`), broader than the spec's ASCII-only rule. Re-dispatched a fix narrowing to `/[!-/:-@[-`{-~]/g`with three pinning tests for accented tag names.`bun test packages/shared/`: 67/67 pass.

### Phase 2: Daemon integration

- Replaced the inline bggTag predicate in `tournament-service.ts` with `matchesBggTag` from `@shelf-judge/shared`. Mechanics and categories are concatenated into one tag-name list per game. Daemon tests updated with integration cases only (positive fuzzy, negative typo, per-tag isolation, empty value); no duplication of helper unit tests. `bun test packages/daemon/`: 244/244 pass.

### Phase 3: Web integration

- Added a runtime import of `matchesBggTag` in `packages/web/app/tournament/page.tsx` (first value import from `@shelf-judge/shared` in the web package; prior imports were type-only). Replaced the inline `case "bggTag"` predicate in `countMatchingGames` with a call that builds `[...mechanics, ...categories].map(t => t.name)` and delegates to the helper — identical call shape to the daemon. Typecheck and lint pass.

### Holistic validation

- Fresh-context conformance check against all five requirements and all six success-criteria bullets: every item passed. Grep confirmed a single implementation of the match rule (no residual tokenization/lowercasing-for-match in daemon or web). `SessionFilter` shape and Zod schema untouched.

### Post-impl: Next build failure

- `bun run build` failed in the web package with `Module not found: Can't resolve './validation.js'` (and `./errors.js`, `./bgg-tag-match.js`) inside `packages/shared/src/index.ts`. Root cause: the shared barrel used NodeNext-style `.js` suffixes that had only ever been resolved by tsc — the web package previously did type-only imports from `@shelf-judge/shared`, so webpack never had to resolve the barrel at runtime. The new `matchesBggTag` runtime import made webpack follow those re-exports, and webpack won't rewrite `.js` to the actual `.ts` files.
- Fix: drop the `.js` suffixes from `packages/shared/src/index.ts`. Root tsconfig sets `moduleResolution: "bundler"`, so extensions aren't required; tsc, Bun, and webpack all resolve cleanly. A `transpilePackages` experiment in `next.config.ts` was reverted — it was not the real fix.
- Verification: `bun run build` succeeds, `bun run typecheck` clean, 311/311 tests pass across shared and daemon.

## Summary

Three phases, one spec divergence caught and fixed mid-phase (regex was broader than "ASCII punctuation"). Shared helper lives in `packages/shared/src/bgg-tag-match.ts`; daemon and web both consume it with identical tag-list composition. First runtime import from `@shelf-judge/shared` in the web package — no build issues.

## Divergence
