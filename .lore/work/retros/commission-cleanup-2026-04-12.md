---
title: Commission batch cleanup (Apr 11-12)
date: 2026-04-12
status: complete
tags: [retro, commissions, cleanup]
---

## Context

56 commissions across 5 workers (Dalton 25, Octavia 18, Thorne 8, Celeste 2, Sienna 2) spanning April 11-12. This batch covers the niche champion display, LLM narrative, niche tag filtering, redundancy scoring, dark mode, game links, community stats, search thumbnails, and wishlist features, plus color system work and brainstorming. All commissions completed except one partial (Thorne's redundancy final review couldn't run shell commands).

## What Worked

Octavia's spec-then-plan chain is consistent and produces well-structured artifacts. Fresh-eyes review on every plan catches 2-3 real issues per pass.

Dalton's parallel implementation dispatches (6 commissions at 17:44, 5 at 22:11, 7 at 06:41) ship large features in batches. The niche tag filtering and redundancy scoring features each went from plan to implementation to review to fix in under 12 hours.

Celeste's brainstorms are high quality. The redundancy scoring brainstorm directly shaped the spec that followed. The shelf layout designer brainstorm surfaced the curation-vs-organization tension early.

## Loose Threads

### Unverified Thorne findings

Thorne raised ~30 findings across 8 reviews. These have NOT been verified against the codebase. Thorne has a known pattern of inventing defects and marking already-resolved issues as open. Treat this list as "check if you care," not a confirmed bug roster. Roughly grouped by theme:

**Niche engine:** isChampion tie handling, position-based vs rank-based neighbors, computeNicheImpact double-count for predicted games already in collection, CLI JSON missing niche data, collection page eager niche fetch.

**LLM narrative:** generateNarration() test coverage, staleness transition test, dead api.ts helper, fresh-state Regenerate button deviating from plan, MCP tool outlier filter gap, type assertion instead of Zod.

**Niche tag filtering:** PATCH endpoint property injection via object spread, test gap on GET /games with non-empty ignored tags.

**Redundancy scoring:** list/detail score source inconsistency, adjustedScore rounding, redundancyPreview optional vs nullable type, NaN risk in flattenWeighted and cosineSimilarity, missing spec-mandated test cases, weak assertion guard.

### Dalton implementation findings

**Histogram bucketing uses fixed breakpoints.** Produces empty buckets for axes with narrow ranges. Noted in review, never refined.

**Fabricated test fixtures.** At least one Dalton commission used invented test data rather than hand-crafted fixtures matching real BGG response shapes. Inconsistent with project testing patterns.

### Pending design work

**Color palette consolidation.** Sienna identified 28 variables to eliminate and structural improvements via `color-mix()` derivations. No implementation followed. Score spectrum derivations need visual validation.

## Infrastructure Issues

**Duplicate `linked_artifacts` entries.** Found in at least 6 commissions across all workers. The commission system double-registers artifacts under certain conditions.

**Commission 183920 (niche tag filtering plan) has a corrupted result.** `result_submitted` event came before the final `progress_report`. Result body is a progress summary, not the deliverable. `linked_artifacts` is empty despite a plan file being produced.

**Thorne's redundancy final review (064235) couldn't execute shell commands.** Commissions requiring `bun run test/typecheck/lint` should not be dispatched to Thorne, who has no bash tool.

**Duplicate commission files.** At least two pairs of Dalton commissions cover the same work, suggesting the dispatch system occasionally double-fires.

## Lessons

**Plans accumulate faster than implementations, but the gap is smaller than it looks.** Octavia produced 10+ plans in this batch. Many were implemented by Dalton (dark mode, game links, community stats, search thumbnails, niche champion, LLM narrative all shipped per git log). The commission system has no cross-worker chain tracking, so plans appear orphaned when they aren't.

**Thorne findings need codebase verification before acting on them.** The review-to-fix pipeline is a real concern, but Thorne's false positive rate means the raw finding list overstates the actual defect count. Future cleanups should not promote Thorne findings to "confirmed defects" without checking the code.
