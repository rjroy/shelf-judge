---
title: Commission batch cleanup (2026-04-06 to 2026-04-10)
date: 2026-04-10
status: complete
tags: [retro, commissions, cleanup]
---

## Context

31 commissions across 5 workers (Dalton 15, Thorne 8, Octavia 5, Celeste 2, Sienna 1) spanning April 6-10. All completed. Two feature chains: collection filter/sort (Apr 6-7, 12 commissions) and utility curves (Apr 7-10, 17 commissions). One standalone fix (type consolidation) and two exploratory brainstorms (collection profiling, prediction engine).

## What Worked

The review-fix-review cycle is effective. Every Thorne review produced actionable findings, and every Dalton fix commission addressed all of them within the chain. No finding was dropped between review and fix within a feature.

Test count grew monotonically: 380 to 596 across both features, with no regressions or deletions.

The planning pipeline (brainstorm, user feedback, mockup, spec, plan) produced clean handoffs. Each stage consumed the previous.

## Loose Threads

### Untracked from filter/sort

**Deferred filter types have no issues filed.** The spec lists 8 deferred filter types (score range, play time range, BGG mechanics/categories, year published range, BGG subdomain, axis-specific rating range, tournament provisional status, has BGG data). They exist only as a section in the spec, invisible to anyone reading the issue backlog.

### Untracked from utility curves

**CurvePreview lacks numeric value readouts (REQ-CURVE-20).** The SVG renders the curve shape but has no tooltips, hover interactions, or sample-point annotations. Thorne's final review calls this out as unmet spec criteria. No fix commission followed.

**Output clamping missing in `applyPreferenceCurve`.** The function can return `effectiveRating` values outside 1-10 when raw values exceed native scale bounds. Tests verify unclamped behavior, but the type comment promises 1-10. Downstream code that assumes the bound will get silent errors.

**Veto + personal override scale mismatch.** When a user overrides a BGG axis (1-5 scale) with a personal rating (1-10 scale), veto checks and curve application both use the mismatched scale. Three separate findings across reviews point at this: veto threshold comparison, curve idealValue interpretation, and missing test coverage. None resolved.

**CLI `formatBreakdown` uses exact float comparison.** Uses `!==` instead of a threshold like the web's `Math.abs(...) > 0.05`. Causes spurious "Raw" column display. Found in Thorne Phase 5+6 review, no explicit fix confirmed.

**`AxisSortAltScores` shows "0.0" for vetoed games.** Renders `score.score.toFixed(1)` without checking for veto. Minor display inconsistency.

### Structural concerns

**`curve-math.ts` duplicated between web and daemon (~100 lines).** Deliberate duplication for client-side preview, but no mechanism guards against drift. An immediate divergence was found and fixed during the same cycle; the pattern will recur on any curve-engine change.

**`axes/page.tsx` has a local `Axis` type.** Same category of duplication that the first commission in this batch was created to fix. Not flagged by any review.

**ESLint `disableTypeChecked` for web test files.** Applied as a workaround for conflicting tsconfig settings. Web tests get no type-aware lint coverage. No follow-up to fix the root cause.

### Pre-existing, still open

**1 skipped test (persistent).** Present before filter/sort work began. Never identified or explained across 31 commissions.

**4 CLI axis test lint warnings (unbound-method).** Pre-date utility curves. Flagged repeatedly as "pre-existing" but never escalated.

### Brainstorm-only decisions not yet captured in specs

**Profile Overview replaces home page.** Significant navigation/architecture change decided in the profiling brainstorm's resolved questions. Not in any spec or design doc.

**Agent SDK authentication model.** Brainstorm assumes "the SDK handles its own authentication; Shelf Judge does not manage API keys." This hasn't been validated against the SDK's actual behavior.

**Shared computation primitive across profiling, prediction, and redundancy scoring.** The brainstorms identify that mechanic/category similarity is needed by all three. No tracking ensures they share the implementation.

## Infrastructure Issues

**Duplicate `linked_artifacts` entries.** Every commission in the batch has its linked_artifacts list duplicated in the YAML frontmatter. Systemic bug in the commission system.

**Commission dependency field unreliably filled.** The filter/sort plan commission has `dependencies: []` despite explicitly depending on the spec. Same for the utility curves plan. The field exists but isn't enforced.

**No commission-to-PR linkage.** The filter/sort chain produced PRs #7 and #11; utility curves produced PR #13. No commission records which PR consumed its work.

**Thorne cannot run tests.** Every utility curves review includes a disclaimer about relying on Dalton's self-reported test results. The review prompt says "run tests" but the worker structurally cannot comply. This undermines independent verification.

**Finding tracking between commissions is implicit.** No explicit mechanism links a finding in review N to its resolution in fix N+1. Cross-referencing requires reading between the lines, and findings can fall through (several did).

## Lessons

**Duplication is a recurring theme.** The first commission in this batch consolidated duplicated types. The last feature introduced new duplication (curve-math.ts, local Axis type). The principle from commission 1 isn't being applied forward.

**"Phase N will fix this" deferrals work within a single plan but have no cross-plan mechanism.** Every intra-plan deferral landed. But findings deferred to "future work" or "track separately" have no escalation path.

**Client/daemon divergence is the most common bug class.** Multiple findings involve web or CLI rendering that doesn't match daemon semantics. The daemon-first architecture means data semantics change server-side and client rendering lags behind.

**Deferred items from specs don't automatically become issues.** The spec's deferred filter list, the curve preview readout gap, and the veto scale mismatch all fell out of the tracking system. Anything deferred needs an explicit issue or it's invisible.
