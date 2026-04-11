---
title: "Commission: Implement game links per plan"
date: 2026-04-11
status: dispatched
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement game links following the plan at `.lore/plans/game-links.md`. Read the full plan and the spec at `.lore/specs/game-links.md` before starting. The plan has 8 steps; execute all of them.\n\nSummary of work:\n\n1. **Profile divergence links** — Wrap game names in `divergence.tsx` with `<Link href={/games/${game.gameId}}>` using class `game-link`\n2. **Profile outliers links** — Same treatment in `outliers.tsx`\n3. **Score breakdown reference game links** — Same in `score-breakdown.tsx` for reference game names in the confidence panel\n4. **Tournament recent comparison links** — Wrap opponent names in `app/games/[id]/page.tsx` with links. No pre-validation of game existence (REQ-GLINK-8).\n5. **Link styling** — Add `.game-link` CSS class using `var(--bgg-accent)`, no underline default, underline on hover, inherit font weight/size\n6. **Tests** — Create `packages/web/tests/game-links.test.tsx` covering all four surfaces\n7. **Visual validation** — Verify link color consistency and layout preservation\n8. **Validate against spec** — Sub-agent checks every REQ-GLINK requirement\n\n## Verification\n- `bun run typecheck` must pass\n- `bun run lint` must pass\n- `bun run test` must pass"
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-11T22:07:29.185Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-11T22:07:29.187Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
