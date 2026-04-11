---
title: "Utility curve loose threads from review cycle"
date: 2026-04-10
status: open
tags: [bug, gap, utility-curves, review-findings]
modules: [daemon, web, cli]
related: [.lore/retros/commission-cleanup-2026-04-10.md]
---

# Utility Curve Loose Threads from Review Cycle

## What Happened

Five findings from the utility curves review cycle were never resolved. Each was flagged in Thorne's reviews but no fix commission followed.

### CurvePreview lacks numeric value readouts (REQ-CURVE-20)

The SVG renders the curve shape but has no tooltips, hover interactions, or sample-point annotations. Thorne's final review calls this out as unmet spec criteria.

### Output clamping missing in `applyPreferenceCurve`

The function can return `effectiveRating` values outside 1-10 when raw values exceed native scale bounds. Tests verify unclamped behavior, but the type comment promises 1-10. Downstream code that assumes the bound will get silent errors.

### Veto + personal override scale mismatch

When a user overrides a BGG axis (1-5 scale) with a personal rating (1-10 scale), veto checks and curve application both use the mismatched scale. Three separate review findings point at this: veto threshold comparison, curve idealValue interpretation, and missing test coverage. None resolved.

### CLI `formatBreakdown` exact float comparison

Uses `!==` instead of a threshold like the web's `Math.abs(...) > 0.05`. Causes spurious "Raw" column display.

### `AxisSortAltScores` shows "0.0" for vetoed games

Renders `score.score.toFixed(1)` without checking for veto. Minor display inconsistency.

## Why It Matters

The veto/scale mismatch and output clamping issues are correctness bugs that produce silently wrong results. The others are display inconsistencies that erode trust in the UI. All were identified in review but fell through the gap between review and fix commissioning.
