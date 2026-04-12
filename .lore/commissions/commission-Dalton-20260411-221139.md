---
title: "Commission: Niche tag filtering: Phase 7 (CLI)"
date: 2026-04-12
status: completed
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Phase 7 of the niche tag filtering plan at `.lore/plans/niche-tag-filtering.md`.\n\nRead the full plan first. You are implementing:\n\n- `shelf-judge niche ignored` — lists currently ignored tags (text table or JSON with `--json`)\n- `shelf-judge niche ignore <type> <name>` — adds a tag to the ignore list (POST /niches/settings/ignore)\n- `shelf-judge niche unignore <type> <name>` — removes a tag (DELETE /niches/settings/ignore)\n\nCreate `packages/cli/src/commands/niche.ts` and register the `niche` command group in the CLI's command registry.\n\nValidation: `type` must be one of `mechanic`, `category`, `family`. Provide a helpful error message on invalid type.\n\nCheck how existing CLI commands are structured (e.g., `packages/cli/src/commands/`) for the registration and output patterns.\n\nRun `bun run test`, `bun run typecheck`, and `bun run lint` before declaring complete."
dependencies:
  - commission-Dalton-20260411-221125
linked_artifacts:
  - packages/cli/src/commands/niche.ts

  - packages/cli/src/index.ts
  - packages/cli/src/client.ts
  - packages/cli/src/index.ts
  - packages/cli/src/client.ts
activity_timeline:
  - timestamp: 2026-04-12T05:11:39.796Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-12T05:19:25.235Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-12T05:27:24.249Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-12T05:27:24.281Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-12T05:27:24.302Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-12T05:27:36.092Z
    event: progress_report
    reason: "Read the plan and dependency commission. Now reading existing CLI commands to match patterns."
  - timestamp: 2026-04-12T05:28:07.234Z
    event: progress_report
    reason: "Context gathered. Need to extend DaemonClient.del to support body parameter, then create niche.ts command file and register it. Writing code now."
  - timestamp: 2026-04-12T05:29:32.124Z
    event: result_submitted
    reason: "## Phase 7: CLI niche commands — Done\n\n### Created\n- `packages/cli/src/commands/niche.ts` — Three commands:\n  - `shelf-judge niche ignored` — lists ignored tags as a text table (or JSON with `--json`)\n  - `shelf-judge niche ignore <type> <name>` — adds a tag via POST /niches/settings/ignore\n  - `shelf-judge niche unignore <type> <name>` — removes a tag via DELETE /niches/settings/ignore\n  - Type validation rejects anything other than `mechanic`, `category`, `family` with a helpful error message\n  - Multi-word names supported (args after type are joined with spaces)\n\n### Modified\n- `packages/cli/src/index.ts` — Registered `niche ignored`, `niche ignore`, `niche unignore` in the COMMANDS map and switch dispatch\n- `packages/cli/src/client.ts` — Extended `DaemonClient.del` to accept an optional `body` parameter (the DELETE /niches/settings/ignore endpoint requires a JSON body with `{ type, name }`)\n\n### Verification\n- `bun run typecheck`: clean\n- `bun run test`: 928 pass, 0 fail, 1 skip\n- `bun run lint`: clean"
  - timestamp: 2026-04-12T05:29:37.515Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "Context gathered. Need to extend DaemonClient.del to support body parameter, then create niche.ts command file and register it. Writing code now."
projectName: shelf-judge
---
## Phase 7: CLI niche commands — Done

### Created
- `packages/cli/src/commands/niche.ts` — Three commands:
  - `shelf-judge niche ignored` — lists ignored tags as a text table (or JSON with `--json`)
  - `shelf-judge niche ignore <type> <name>` — adds a tag via POST /niches/settings/ignore
  - `shelf-judge niche unignore <type> <name>` — removes a tag via DELETE /niches/settings/ignore
  - Type validation rejects anything other than `mechanic`, `category`, `family` with a helpful error message
  - Multi-word names supported (args after type are joined with spaces)

### Modified
- `packages/cli/src/index.ts` — Registered `niche ignored`, `niche ignore`, `niche unignore` in the COMMANDS map and switch dispatch
- `packages/cli/src/client.ts` — Extended `DaemonClient.del` to accept an optional `body` parameter (the DELETE /niches/settings/ignore endpoint requires a JSON body with `{ type, name }`)

### Verification
- `bun run typecheck`: clean
- `bun run test`: 928 pass, 0 fail, 1 skip
- `bun run lint`: clean

## Decisions

**How should the CLI call DELETE /niches/settings/ignore which requires a JSON body, when the DaemonClient.del method doesn't accept a body?**
Extend DaemonClient.del to accept an optional body parameter, matching the post/put signatures.
*Reasoning: The daemon route reads the body from the DELETE request. The client's internal request() function already supports a body parameter; del just doesn't expose it. Adding the optional parameter is a one-line change to the interface and implementation, maintains backward compatibility, and is the correct fix rather than a workaround.*
