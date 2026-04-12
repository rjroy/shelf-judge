---
title: "Utility curve loose threads from review cycle"
date: 2026-04-10
status: resolved
resolved: 2026-04-11
tags: [bug, gap, utility-curves, review-findings]
modules: [daemon, web, cli]
related: [.lore/retros/commission-cleanup-2026-04-10.md]
---

# Utility Curve Loose Threads from Review Cycle

USER NOTE: Im dubious of these claims. Validate before taking action.

## Resolution

Validated all five claims against the codebase on 2026-04-11. Four of five are false: the code already handles the reported issues correctly. The fifth (CurvePreview readouts) is a debatable UX gap, not a bug. Closing the issue.

### CurvePreview lacks numeric value readouts (REQ-CURVE-20): NOT A BUG

REQ-CURVE-20 says "the user can see" what effective ratings result from native values. The CurvePreview SVG renders the full mapping with labeled axes (native scale on X, 1-10 on Y), sweet-spot ideal marker, and veto region shading. The spec's example ("a BGG weight of 4.0 on this axis would produce an effective rating of 3.1") describes the kind of insight the preview provides, not a literal tooltip requirement. The spec says nothing about hover interactions or sample-point annotations. The curve shape with labeled endpoints is the feedback mechanism. Tooltips would be a nice enhancement, but the spec is met as written.

### Output clamping missing in `applyPreferenceCurve`: FALSE

Every branch in `applyPreferenceCurve` (shared/src/curve-math.ts:107-141) wraps its return value in `clamp()`, which enforces `Math.max(1, Math.min(10, value))`. Output is always 1-10. The claim is simply wrong.

### Veto + personal override scale mismatch: FALSE

The fitness service (daemon/src/services/fitness-service.ts:62-101) handles overrides correctly:

- Line 72: `valueScale` is reset to the personal scale (1-10) when a personal override exists
- Line 89: Veto checks are skipped entirely for overrides (`!isOverride` guard)
- Line 106: Curve application uses `valueScale`, which is the personal scale for overrides

There is no scale mismatch. The code was either written correctly from the start or fixed before the review findings were filed as issues.

### CLI `formatBreakdown` exact float comparison: FALSE

The CLI's `formatBreakdown` (cli/src/output.ts:58-63) uses `Math.abs(e.rawValue - e.effectiveRating) > 0.05`, the exact same threshold approach the issue attributes only to the web. There is no `!==` comparison.

### `AxisSortAltScores` shows "0.0" for vetoed games: FALSE

The `AxisSortAltScores` component (web/components/collection-table.tsx:659-663) explicitly checks `score.vetoed` and renders a "V" badge with the hypothetical score, not `score.score.toFixed(1)`. Vetoed games never show "0.0".

## Original Findings (for reference)

Five findings from the utility curves review cycle were flagged in Thorne's reviews. None required action.

## Lessons

Review findings from Thorne require validation against the actual codebase before filing as issues. Of five findings filed from the utility curves review cycle, four were factually wrong and one was a style opinion about spec interpretation. This is consistent with the ~40% false-positive rate noted in worker memory.
