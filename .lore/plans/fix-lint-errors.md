---
title: "Fix lint errors (eager-forging-shannon)"
date: 2026-04-06
status: executed
tags: [plan, lint, cleanup]
---

# Fix Lint Errors

## Context

`bun run lint` reports 12 errors across 4 files. Goal: clean lint pass with minimal, targeted fixes.

## Status of edits already applied (pre-plan-mode)

- `packages/daemon/tests/routes/tournament.test.ts` lines 287, 324: removed unused `const ids = ` (kept the `await addGames(5)` call). DONE.

## Remaining fixes

### 1. `packages/web/app/games/[id]/page.tsx:139`

`score!.score.toFixed(1)` — `score!` non-null assertion is unnecessary because `hasDivergence` (line 49-54) already narrows `score !== null`. TypeScript should infer non-null inside the `hasDivergence &&` block. Same likely applies to `tournamentStats!` on line 140.

Fix: drop the `!` assertions:

```tsx
{score.score.toFixed(1)}) and tournament rank (
{tournamentStats.normalizedScore.toFixed(1)}) ...
```

Note: only the lint error specifically flagged line 139. Verify whether 140 still needs assertion (normalizedScore narrowing) — keep `!` only where actually required, with a comment.

### 2. `packages/web/app/tournament/page.tsx`

- Lines 123, 181: floating promises — prefix the call with `void` (e.g. `void loadX()`).
- Lines 245, 354: `onClick={someAsyncFn}` misused-promises — wrap as `onClick={() => { void someAsyncFn(); }}`.

### 3. `packages/web/app/tournament/session/page.tsx`

- Line 102: floating promise — `void` prefix.
- Lines 169, 197, 240, 293: async handlers passed to event attributes — wrap in `() => { void handler(); }`.

## Files to modify

- `packages/web/app/games/[id]/page.tsx`
- `packages/web/app/tournament/page.tsx`
- `packages/web/app/tournament/session/page.tsx`

(daemon test file already fixed)

## Verification

```bash
bun run lint
bun run typecheck
bun run test
```

All three must pass.
