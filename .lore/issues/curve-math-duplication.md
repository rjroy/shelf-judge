---
title: "curve-math.ts duplicated between web and daemon"
date: 2026-04-10
status: open
tags: [debt, duplication, utility-curves]
modules: [web, daemon]
related: [.lore/retros/commission-cleanup-2026-04-10.md]
---

# curve-math.ts Duplicated Between Web and Daemon

## What Happened

`curve-math.ts` (~100 lines) is deliberately duplicated between the web and daemon packages for client-side curve preview. No mechanism guards against drift. An immediate divergence was found and fixed during the same development cycle, confirming the pattern will recur on any curve-engine change.

## Why It Matters

This is the same class of problem the type consolidation commission at the start of this batch was created to fix. The principle from that work isn't being applied forward. Each future curve-engine change risks introducing silent behavioral differences between preview and scoring.

## Fix Direction

Move `curve-math.ts` into `packages/shared/` so both web and daemon import from a single source. This matches the pattern already used for types and Zod schemas.
