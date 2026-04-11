---
title: "axes/page.tsx has a local Axis type"
date: 2026-04-10
status: open
tags: [debt, duplication, types]
modules: [web]
related: [.lore/retros/commission-cleanup-2026-04-10.md]
---

# axes/page.tsx Has a Local Axis Type

## What Happened

`axes/page.tsx` defines its own local `Axis` type instead of importing from `packages/shared/`. This is the same category of duplication that the type consolidation commission at the start of this batch was created to fix. It was not flagged by any review.

## Why It Matters

Local type definitions diverge from the canonical types over time. When the shared `Axis` type changes, this local copy won't update, leading to type mismatches that TypeScript can't catch because the types are structurally independent.

## Fix Direction

Replace the local `Axis` type with the import from `@shelf-judge/shared`.
