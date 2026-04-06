---
title: "Commission: Responsive Phase 1: Tokens + Sidebar (Steps 1-2)"
date: 2026-04-06
status: dispatched
tags: [commission]
worker: Dalton
workerDisplayTitle: "Guild Artificer"
prompt: "Implement Steps 1-2 from the responsive web plan at `.lore/plans/responsive-web.md`.\n\n## Scope\n\n**Step 1: Responsive Spacing Tokens and Viewport Meta**\n- Verify viewport meta tag in Next.js layout\n- Add responsive spacing custom properties (--content-padding, --topbar-padding) with media query overrides for phone (max-width: 599px) and tablet (600px-899px)\n- Replace all hardcoded padding values listed in the plan with the new custom properties\n\n**Step 2: Sidebar Responsive Behavior**\n- Make sidebar hidden by default below 900px\n- Add hamburger toggle button in the topbar (visible only below 900px)\n- Implement full-screen overlay sidebar with backdrop on mobile/tablet\n- Add brand name \"Shelf Judge\" to topbar when sidebar is hidden\n- Close sidebar on nav item selection and backdrop tap\n- CSS transitions for open/close\n\n## Key Files\n- `packages/web/app/globals.css`\n- `packages/web/app/layout.tsx`\n- `packages/web/components/sidebar.tsx`\n\n## Requirements\n- Desktop layout (900px+) must be completely unchanged\n- All responsive CSS goes at the end of globals.css in clearly marked sections per the plan\n- Use `max-width` queries against existing desktop-first CSS\n- Run `bun run typecheck`, `bun run lint`, and `bun run test` before declaring complete"
dependencies: []
linked_artifacts: []

activity_timeline:
  - timestamp: 2026-04-06T13:28:15.974Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-06T13:28:15.976Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
current_progress: ""
projectName: shelf-judge
---
