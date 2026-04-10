---
title: "Commission: Reduce Tournament Overhead Phase 3: Service Layer"
date: 2026-04-10
status: blocked
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phase 3 of `.lore/plans/reduce-tournament-overhead.md`: Service Layer Changes.\n\nRead the plan's Phase 3 section thoroughly. Key changes:\n\n1. **Storage**: Integrate migration into `loadTournament()`, update `createDefaultTournament()` to post-migration format\n2. **submitComparison**: Push to `session.comparisons`, update cached wins/losses/recentComparisons with FIFO cap at 10\n3. **deriveDisplayStats**: Read from cached gameStats instead of scanning comparisons array\n4. **getNextPair**: Read from `session.comparisons` for pair dedup\n5. **endSession + all 4 auto-complete paths**: Clear `session.comparisons` on completion (the plan identifies 4 specific locations in getNextPair plus endSession itself)\n6. **startSession**: Initialize `comparisons: []` on new sessions\n7. **Remove `recalculate` from service interface and implementation**\n8. **Update all test fixtures** to post-migration format, add tests for all new behaviors\n\nThe plan has specific line numbers and code patterns. Follow them.\n\nRun `bun test` for the daemon package. Typecheck may still fail for routes/CLI (Phase 4). That's expected."
dependencies:
  - commission-Dalton-20260410-070836
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-10T14:08:46.897Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-10T14:09:54.550Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
current_progress: ""
projectName: shelf-judge
---
