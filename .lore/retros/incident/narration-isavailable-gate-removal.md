---
title: Removing the ANTHROPIC_API_KEY gate from narration
date: 2026-04-11
status: complete
tags: [auth]
modules: [daemon-narration, web-profile, cli-profile]
related: [.lore/plans/features/llm-narrative.md, .lore/commissions/commission-Thorne-20260411-174549.md]
---

# Retro: Removing the ANTHROPIC_API_KEY gate from narration

## Summary

The narration service shipped with an `isAvailable()` method that returned `!!process.env.ANTHROPIC_API_KEY`, and the narrate route returned 503 when it was false. The web UI and CLI both had matching 503 branches that told users to "set ANTHROPIC_API_KEY on the daemon to enable." This was wrong: the Claude Agent SDK resolves credentials from several sources (subscription login in `~/.claude/`, `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, and the env var), so any user authenticated through subscription login was getting a false-negative 503 even though `query()` would have worked fine.

The fix was to rip the gate out entirely. The SDK surfaces its own auth errors at `query()` time, and the route's existing 502 catch already handles them with the real message. Removing the gate also let `narrationService` drop out of `ProfileRoutesDeps` and `AppDeps` — the route never needed a direct reference, it just reached narration through `profileService.generateNarration()`.

## What Went Well

- The gate was small and localized. Removing it was a clean cascade: service interface → route → app deps → index wiring → tests in two packages.
- `narrationService` being a distinct layer behind `profileService` meant the route's dep could drop entirely instead of being nullified. Decoupling paid off.
- Typecheck, lint, and the 898-test suite caught nothing because nothing else depended on the gate. The blast radius was exactly the suspected files.
- Fresh-eyes audit on a single question ("does this actually use the Agent SDK?") surfaced the real issue (the gate's semantics) faster than a generic review would have.

## What Could Improve

- **The plan prescribed the bug.** `.lore/plans/features/llm-narrative.md:224` explicitly specified `isAvailable()` checks `ANTHROPIC_API_KEY`. The implementer followed the plan faithfully. Nobody checked whether the gate's premise matched how the Agent SDK actually authenticates.
- **Test coverage reinforced the mistake.** The deleted `narration-service.test.ts` had three tests, all for `isAvailable()`. The core `generateNarration()` function had zero coverage. The tests locked in the wrong behavior and gave no signal about the real integration.
- **Error messages copied the assumption across layers.** The same wrong hint ("set ANTHROPIC_API_KEY") lived in the daemon 503, the web component, and the CLI fallback. Three copies of one bad claim, each of which had to be found and removed.

## Lessons Learned

- Gating on env var presence to decide "is this SDK available" is almost always wrong for SDKs that resolve credentials from multiple sources. The SDK's own error is the source of truth; let it fire and catch it. Pre-gates produce false negatives and drift out of sync with the SDK's real auth rules.
- When a plan prescribes a pre-flight check for an external dependency, verify the check's premise against the dependency's actual behavior before implementing. Plan fidelity is not the same as correctness.
- Coverage on auxiliary methods (`isAvailable`) instead of the core function (`generateNarration`) is a red flag that the test surface was chosen for convenience, not for validating behavior. If the happy path of a new integration has zero tests, the integration isn't verified, regardless of how many aux tests exist.
- Error messages that name a specific configuration mechanism ("set ANTHROPIC_API_KEY") bake a premise into user-facing text. When the premise is wrong, every surface that repeats it has to be hunted down. Prefer letting the underlying layer's error propagate than synthesizing a "helpful" hint at a higher layer.

## Artifacts

- Plan that prescribed the gate: `.lore/plans/features/llm-narrative.md` (see Phase 2, section on `isAvailable()`)
- Commission that validated the mis-scoped test coverage: `.lore/commissions/commission-Thorne-20260411-174549.md`
- Files touched in the removal:
  - `packages/daemon/src/services/narration-service.ts`
  - `packages/daemon/src/routes/profile.ts`
  - `packages/daemon/src/app.ts`
  - `packages/daemon/src/index.ts`
  - `packages/daemon/tests/narration-service.test.ts` (deleted)
  - `packages/daemon/tests/routes/profile-narrate.test.ts`
  - `packages/daemon/tests/helpers/test-app.ts`
  - `packages/web/components/profile/narration-actions.tsx`
  - `packages/cli/src/commands/profile.ts`
  - `packages/cli/tests/commands/profile.test.ts`
