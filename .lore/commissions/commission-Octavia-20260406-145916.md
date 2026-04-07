---
title: "Commission: Plan: Tournament ELO Ranking"
date: 2026-04-06
status: completed
tags: [commission]
worker: Octavia
workerDisplayTitle: "Guild Chronicler"
prompt: "Read the spec at `.lore/specs/tournament-ranking.md` and prepare an implementation plan.\n\nUse the `/lore-development:prep-plan` skill. Read the relevant source code to understand the current state: data model (`packages/shared/`), daemon services and routes (`packages/daemon/src/`), web UI (`packages/web/`), CLI (`packages/cli/`).\n\nAlso read the visual mockups at `.lore/visual-direction/tournament/` for the session filter UX and comparison screen designs.\n\nThe plan should be phased and commission-ready for Dalton. This is a large feature touching all four packages, so structure phases carefully with review gates. Consider:\n- Data model and shared types first\n- Tournament service (ELO math, session management, pairing) next\n- API routes\n- Web UI (session start, filter, comparison screen, game detail updates, collection sort)\n- CLI commands\n- Each phase should be independently testable"
dependencies: []
linked_artifacts:
  - .lore/plans/tournament-ranking.md

resource_overrides:
  model: opus

activity_timeline:
  - timestamp: 2026-04-06T21:59:16.553Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-06T21:59:16.555Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-06T21:59:16.572Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-06T21:59:22.728Z
    event: progress_report
    reason: "Starting commission: reading tournament ranking spec and current codebase to prepare implementation plan."
  - timestamp: 2026-04-06T22:00:01.325Z
    event: progress_report
    reason: "Finished reading all source files across shared, daemon, web, and CLI packages. Now reading the visual mockups and checking for existing designs/plans, then invoking prep-plan skill."
  - timestamp: 2026-04-06T22:00:14.085Z
    event: progress_report
    reason: "All source code and visual mockups read. Have full picture of the codebase architecture and the spec requirements. Now invoking prep-plan skill to produce the implementation plan."
  - timestamp: 2026-04-06T22:07:17.159Z
    event: result_submitted
    reason: "Implementation plan for tournament-based ELO ranking saved to `.lore/plans/tournament-ranking.md`.\n\nThe plan is structured into 7 phases with review gates between each:\n\n- **Phase 1**: Data model and shared types (Comparison, TournamentSession, TournamentData, TournamentGameStatsDisplay, SessionFilter + Zod schemas)\n- **Phase 2**: ELO engine as pure functions (expected score, rating update, recalculate, normalization). Heavy test phase with hand-calculated worked examples.\n- **Phase 3**: Tournament service (session management, adaptive pairing, filtering, game deletion hook). Most complex phase.\n- **Phase 4**: API routes (11 endpoints under `/api/tournament/`). Full request/response shapes specified inline.\n- **Phase 5**: Web UI (tournament page with session start/filter builder/comparison screen, game detail updates, collection sort toggle). References 4 visual mockups.\n- **Phase 6**: CLI commands (6 tournament subcommands + modifications to existing game/score commands).\n- **Phase 7**: Integration verification by Thorne.\n\nSuggested commission cadence: Phase 1+2 together, Phase 3 alone, Phase 4 alone, Phase 5 alone, Phase 6 parallel with Phase 5, Phase 7 as Thorne review.\n\nTechnical decisions documented: tournament settings in tournament.json (not config.json), API surface inline (no separate design doc), `onGameDeleted` callback pattern for cross-service coordination, construction order in index.ts.\n\nPlan reviewed by fresh-context plan-reviewer agent. Six findings addressed: K-factor threshold spec conflict documented, startSession dependency boundary clarified, field name divergence from spec called out, Phase 6 file list expanded, component type contradiction fixed, TournamentGameStatsDisplay moved to shared types."
  - timestamp: 2026-04-06T22:07:20.435Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "All source code and visual mockups read. Have full picture of the codebase architecture and the spec requirements. Now invoking prep-plan skill to produce the implementation plan."
projectName: shelf-judge
---
Implementation plan for tournament-based ELO ranking saved to `.lore/plans/tournament-ranking.md`.

The plan is structured into 7 phases with review gates between each:

- **Phase 1**: Data model and shared types (Comparison, TournamentSession, TournamentData, TournamentGameStatsDisplay, SessionFilter + Zod schemas)
- **Phase 2**: ELO engine as pure functions (expected score, rating update, recalculate, normalization). Heavy test phase with hand-calculated worked examples.
- **Phase 3**: Tournament service (session management, adaptive pairing, filtering, game deletion hook). Most complex phase.
- **Phase 4**: API routes (11 endpoints under `/api/tournament/`). Full request/response shapes specified inline.
- **Phase 5**: Web UI (tournament page with session start/filter builder/comparison screen, game detail updates, collection sort toggle). References 4 visual mockups.
- **Phase 6**: CLI commands (6 tournament subcommands + modifications to existing game/score commands).
- **Phase 7**: Integration verification by Thorne.

Suggested commission cadence: Phase 1+2 together, Phase 3 alone, Phase 4 alone, Phase 5 alone, Phase 6 parallel with Phase 5, Phase 7 as Thorne review.

Technical decisions documented: tournament settings in tournament.json (not config.json), API surface inline (no separate design doc), `onGameDeleted` callback pattern for cross-service coordination, construction order in index.ts.

Plan reviewed by fresh-context plan-reviewer agent. Six findings addressed: K-factor threshold spec conflict documented, startSession dependency boundary clarified, field name divergence from spec called out, Phase 6 file list expanded, component type contradiction fixed, TournamentGameStatsDisplay moved to shared types.

## Decisions

**Where should tournament-specific settings (K-factor threshold, normalization half-width, provisional threshold) be stored?**
Store tournament settings as a `settings` object inside `tournament.json`, not in the app-level `config.json`.
*Reasoning: AppConfig is for daemon infrastructure (socket path, data dir, BGG token). Tournament settings are domain-specific to the tournament feature and naturally co-locate with tournament data. Storing them in tournament.json keeps the feature self-contained and avoids widening the AppConfig interface that all packages import. The settings are read alongside tournament data anyway, so no extra file I/O.*

**Should the tournament API surface get a separate design document per REQ-TOURN-19, or should the API be specified inline in the plan?**
Specify the API surface inline in the plan. No separate design document.
*Reasoning: The MVP had a separate API design doc because the API pattern itself was being established. For tournament, the pattern is proven (Hono routes, service layer, operations registry). The plan can specify the endpoints, request/response shapes, and status codes directly in the relevant phase. This avoids an extra artifact that would just repeat what the plan says. If the reviewer flags this as insufficient, a design doc can be extracted from the plan.*
