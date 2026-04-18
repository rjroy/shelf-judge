---
title: Commission batch cleanup (Apr 12-16)
date: 2026-04-17
status: complete
tags: [retro, commissions, cleanup]
---

## Context

49 commissions across 5 workers (Dalton 28, Thorne 12, Octavia 6, Celeste 2, Sienna 2) spanning April 12-16. This batch covers four shipped features (wishlist, redundancy settings page move, previously-owned state, shelf capacity system) plus one fresh brainstorm (one-pass bracket mode). All chains completed cleanly. The shelf-capacity final validation fix commission (Dalton-20260416-211508) failed on a Claude usage limit; its findings were resolved manually by the user (verified in code) and the commission was marked abandoned rather than retried.

## What Worked

Dalton's review-fix cadence is consistently healthy. Every Thorne review paired with a Dalton fix commission in the same cycle; the one exception is the abandoned C20. Dalton also pushes back on Thorne findings with evidence (multiple findings on shelf-capacity flagged as "no action needed, established pattern") rather than silently accepting them, which is the correct posture given Thorne's ~40% false-positive rate.

Celeste's previously-owned brainstorm translated cleanly into spec, plan, and shipped implementation. The narrow-scope proposal (status field + UX + BGG import) survived intact through all downstream artifacts.

Sienna's mockups were linked into the corresponding plans before implementation and all five shelf-capacity mockups made it into Dalton's implementation chain.

## Loose Threads

### Shelf-capacity verification debt

Three consecutive shelf-capacity commissions (C16 Dalton-20260413-150119, C17 Dalton-20260413-150131 equivalent, C19 Dalton-20260413-150356) self-reported they could not run `bun run test`, `bun run typecheck`, or `bun run lint` due to a sandbox seccomp failure. Code was written against type contracts only. The C20 final validation that would have flushed this out didn't run (failed on usage limit, findings resolved manually by the user). No commission has re-run the checks since.

### Octavia spec stubs never filed as issues

Octavia's specs defined nine exit-point deferred items that never became issue files:

- From `previously-owned`: `played-only-state`, `bgg-import-ownership`, `tournament-ownership-filter`
- From `shelf-capacity`: `shelf-neighbors`, `manual-assignment`, `algorithm-tuning`, `dimension-filter`, `shelf-visualizer`, `niche-annotations`

Also dropped during the shelf-capacity spec reconciliation: Flaw 5 (BGG dimension data unverified) and Flaw 6 (refresh override for BGG dimensions). The "Known Flaws" section was removed entirely without migrating to issues.

### Previously-owned final review (no fix commission, labeled "cleanup, not blockers")

- Duplicated `--prev-owned-*` CSS tokens in `globals.css` (first block appears dead-coded).
- No chained round-trip reacquisition test, despite the spec's success criteria explicitly calling for it.
- CLI `gameSetStatus` doesn't validate status locally before the daemon round-trip.
- Redundant `predictionService.listGamesWithPredictions()` calls in GET /games.

### Redundancy settings page final review (no fix commission)

- Stale error banner persists after a failed save in `redundancy/page.tsx`.
- `settingsEqual` manual field enumeration is brittle to type growth.

### Shelf-capacity `setShelfConfig` dead code

C12 flagged `setShelfConfig` as possibly dead and deferred cleanup "if still unused after capacity/overflow phases." Those phases are now done; no follow-up.

### One-pass bracket mode brainstorm

`.lore/brainstorms/one-pass-bracket-mode.md` was produced 2026-04-16 with 5 proposals. No spec, no plan, no follow-up yet. Fresh (<1 day), so this loose thread is expected. Decide whether to spec, shelve, or close.

## Infrastructure Issues

**Sandbox bash failure (2026-04-17).** Seccomp-related `prctl` failure blocked `bun run` commands across a whole session, hitting C16, C17, C19, and killing C20 entirely. Sub-agents inherited the same failure — harness-level problem, not per-command.

**Claude usage-limit abandonment.** C20 (Dalton-20260416-211508) hit a usage limit, failed, and was manually abandoned with no retry. Final-validation commissions are the highest-value review step and also the most vulnerable — they need a recovery path.

**Duplicate `linked_artifacts` entries.** Still present in this batch (Dalton 174410, 174425; both Sienna commissions). Known commission-system bug; not worth tracking per-commission.

**Octavia's docs-only commission (20260412-144758)** edited `.lore/notes/color-system-consolidation.md` but `linked_artifacts` is empty. The note file isn't tracked as an output.

## Lessons

**Final-validation commissions need a recovery path.** C20 failed on a usage limit and the findings were resolved manually by the user rather than retried in-system. That worked here — the user closed the thread — but the commission artifact records "abandoned" with no content, so the resolution is only visible via the abandonment reason string ("Resolved Manually") and the code diff. Capstone commissions need either retry automation or a convention for recording the manual resolution in-artifact so future readers don't mis-read "abandoned" as "dropped."

**Abandonment reasons carry load-bearing state.** In this batch, a commission marked `abandoned` actually meant "resolved out-of-band by the user." A sub-agent reading only the timeline events would see "failed then abandoned" and report a loose thread. Cleanup passes must read the abandonment reason, not just the status transition.

**Spec deferrals need automatic issue filing.** Octavia's specs continue to produce deferred stub lists that never become issue files. Nine stubs went unfiled in this batch across two specs. The pattern from earlier memory (deferred items disappear from the backlog unless explicitly filed) is now a recurring failure mode. Standing order candidate: every spec-level "Known Flaws" entry or deferred stub must produce a same-session issue file.

**"Cannot verify" self-reports during sandbox outages must escalate.** Dalton's implementation commissions trusted type contracts when shell tools were unavailable. That debt only gets paid when a later verified commission runs — which in C16/C17/C19's case still hasn't happened because C20 was abandoned. Future sandbox-outage sessions should halt the chain or retry on a working harness, not continue blind.

**Thorne's style/nit findings are reliable; architectural claims are not.** The abandoned C20 validation would have been the exact filter this batch needed. Thorne caught the real CSS duplication and dead fields this batch. The axis-0 claim is the kind of finding where Thorne's FP rate matters most and where independent validation was specifically required.
