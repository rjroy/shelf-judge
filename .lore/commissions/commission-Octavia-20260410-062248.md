---
title: "Commission: Spec: Reduce Tournament Overhead"
date: 2026-04-10
status: completed
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Review the issue at `.lore/issues/reduce-tournament-overhead.md` and write a specification.\n\nUse the `/lore-development:specify` skill. Before writing the spec, investigate the current tournament implementation to understand what's actually stored and how:\n\n1. Read the tournament data model and storage (check `.lore/designs/` for tournament design docs, then the actual implementation in `packages/shared/` and `packages/daemon/`)\n2. Understand what match history is currently stored and how it scales\n3. Evaluate the question in the issue: is full tournament history useful or noise? Is `elo` + `comparisons` sufficient alongside the active session?\n\nGround the spec in the project's vision (`.lore/vision.md`) and existing specs (`.lore/specs/` for conventions). The issue raises a legitimate scaling concern (400 games = 160,000 potential matches). The spec should define what to keep, what to drop, and what the migration path looks like."
dependencies: []
linked_artifacts:
  - .lore/specs/reduce-tournament-overhead.md

activity_timeline:
  - timestamp: 2026-04-10T13:22:48.959Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-10T13:22:48.962Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-10T13:22:48.986Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-10T13:22:54.993Z
    event: progress_report
    reason: "Starting spec work for reduce-tournament-overhead. Reading the issue, vision, existing designs, and implementation."
  - timestamp: 2026-04-10T13:23:33.298Z
    event: progress_report
    reason: "Finished reading all source material: issue, vision, tournament spec, types, services, ELO engine. Now consulting compendium and invoking the specify skill."
  - timestamp: 2026-04-10T13:26:12.126Z
    event: progress_report
    reason: "Research complete. Key tension identified: REQ-TOURN-7 requires recalculability from full history, but practical display only uses last 5 comparisons per game. Computation cost (linear scan on every stats request) is more immediate than storage cost. Drafting spec now."
  - timestamp: 2026-04-10T13:30:44.802Z
    event: result_submitted
    reason: "Wrote specification at `.lore/specs/reduce-tournament-overhead.md` (14 requirements, REQ-RTO-1 through REQ-RTO-14).\n\nThe spec makes three key decisions:\n1. **Full history recalculability (REQ-TOURN-7) is superseded.** Cached ELO scores become authoritative. The rationale: K-factor is already configurable going forward, replay fidelity degrades when games are deleted, and the cost is paid on every read (O(n) scan per game per request).\n2. **Completed session comparisons are pruned.** Session metadata is retained for history; the comparisons array is cleared on session completion.\n3. **Derived stats promoted to cached-on-write.** `TournamentGameStats` gains `wins`, `losses`, and `recentComparisons` (rolling window of 10). `deriveDisplayStats` reads from cache instead of scanning.\n\nMigration is format-detected (presence of top-level `comparisons` array), runs automatically on first load, and is idempotent. No schema versioning. Zod schema accepts both pre- and post-migration formats.\n\nThe spec was reviewed by a fresh-context spec-reviewer agent. Six findings were addressed: stale type comment callout, active session migration test gap, pair-dedup test specificity, schema field default clarification, normalizeFitness scope note, and K-factor migration note."
  - timestamp: 2026-04-10T13:30:50.208Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Research complete. Key tension identified: REQ-TOURN-7 requires recalculability from full history, but practical display only uses last 5 comparisons per game. Computation cost (linear scan on every stats request) is more immediate than storage cost. Drafting spec now."
projectName: shelf-judge
---
Wrote specification at `.lore/specs/reduce-tournament-overhead.md` (14 requirements, REQ-RTO-1 through REQ-RTO-14).

The spec makes three key decisions:
1. **Full history recalculability (REQ-TOURN-7) is superseded.** Cached ELO scores become authoritative. The rationale: K-factor is already configurable going forward, replay fidelity degrades when games are deleted, and the cost is paid on every read (O(n) scan per game per request).
2. **Completed session comparisons are pruned.** Session metadata is retained for history; the comparisons array is cleared on session completion.
3. **Derived stats promoted to cached-on-write.** `TournamentGameStats` gains `wins`, `losses`, and `recentComparisons` (rolling window of 10). `deriveDisplayStats` reads from cache instead of scanning.

Migration is format-detected (presence of top-level `comparisons` array), runs automatically on first load, and is idempotent. No schema versioning. Zod schema accepts both pre- and post-migration formats.

The spec was reviewed by a fresh-context spec-reviewer agent. Six findings were addressed: stale type comment callout, active session migration test gap, pair-dedup test specificity, schema field default clarification, normalizeFitness scope note, and K-factor migration note.
