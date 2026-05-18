---
title: Migrating narration from Claude Agent SDK to pi-coding-agent
date: 2026-05-17
status: complete
tags: [migration, sdk, llm]
modules: [daemon-narration]
related:
  - .lore/plans/features/llm-narrative.md
  - .lore/research/claude-agent-sdk.md
  - .lore/retros/incident/narration-isavailable-gate-removal.md
---

# Retro: Migrating narration from Claude Agent SDK to pi-coding-agent

## Summary

The narration service was built against `@anthropic-ai/claude-agent-sdk`'s one-shot `query()` API. The replacement (`@mariozechner/pi-coding-agent` 0.73.1) ships a session-based agent surface with no direct equivalent to `query`'s `outputFormat` / structured output. A user-supplied migration guide covered the bulk of the concept mapping but had a hole at exactly the feature this code depended on most: guaranteed JSON output against a schema.

The migration was a single-file rewrite of `packages/daemon/src/services/narration-service.ts` plus a dependency swap. The public `NarrationService.generateNarration(profile)` signature was preserved, so `profile-service.ts`, the `/profile/narrate` route, both clients (web and CLI), and the route mock test all kept working unchanged. The structured-output gap was bridged by defining `submit_narration` as a custom tool whose TypeBox parameters _are_ the `ProfileNarration` schema; the tool's `execute()` closure-captures the args and returns `terminate: true` to end the agent loop after a single submission. Model selection moved from a hardcoded `"haiku"` to an env-var-configurable `SHELF_JUDGE_NARRATION_MODEL` (provider:model-id format) with the same haiku default.

## What Went Well

- The public service interface was already the right seam. Because `profileService` reaches narration through `generateNarration(profile)` and no caller poked at SDK types directly, the rewrite stayed entirely inside one file. The route's test mock was an interface mock, not an SDK mock, so it passed without edits.
- Verifying pi's actual `dist/*.d.ts` before committing to a pattern caught the structured-output gap during planning instead of at runtime. The `submit_narration` tool pattern is the canonical workaround when an agentic framework lacks explicit structured output, but choosing it confidently required confirming the gap was real, not just under-documented.
- Pi's `terminate: true` hint on `AgentToolResult` is the exact primitive the closure-capture pattern needs. The agent stops after submission instead of looping on a now-finished task.
- Dynamic imports for `pi-coding-agent` and `pi-ai` survived the rewrite, keeping the heavier pi-tui transitive off daemon startup the same way the old SDK lazy-load did.
- 1235 tests, lint, typecheck all clean after a single fix-up cycle. The blast radius was exactly the suspected files.

## What Could Improve

- The migration guide's "Common patterns mapped over" section described `getModel`, tools, system prompts, gating, and aborts, but said nothing about structured output. That's a load-bearing gap. Anyone migrating a `query({ outputFormat: ... })` callsite who trusts the guide as a spec is going to either build a brittle "parse JSON out of the final assistant text" path or stall. The guide should call out that pi has no `outputFormat` and recommend the tool-as-schema pattern explicitly.
- TypeScript narrowing fought the closure-captured result variable. `let captured: ProfileNarration | null = null` followed by an assignment inside a tool callback got narrowed to `null` at the post-prompt read site (TS doesn't track closure mutation across `await`). The fix (wrap in an object so the property assignment isn't narrowed) is a known idiom, but the first compile error read as "Property does not exist on type 'never'" which obscured the real cause. Worth remembering when porting any code that captures async-mutated state in a closure.
- The `agent-sdk` dependency in `~/Projects/pi-agent-migration.md` lived outside the repo (parent directory). External-to-repo guidance is hard to version against the code: if the guide updates after a migration, there's no diff trail. Future migrations of this kind would benefit from copying the guide into `.lore/research/` at the time of use so the snapshot the migration was built against is preserved.

## Lessons Learned

- When a migration guide describes "concept mapping," treat it as a sketch, not a contract. The `dist/*.d.ts` is the contract. Reading the types directly is cheap and forecloses a class of integration surprises that documentation alone cannot.
- Agentic frameworks without an explicit structured-output API have one canonical workaround: make the output schema a tool's input schema. Closure-capture the validated args, return `terminate: true`, and read the captured value after the loop ends. This is more robust than parsing JSON from final assistant text, because the schema is enforced at the tool boundary by the framework's own validator instead of by the model's JSON discipline.
- Closure-mutated state with `let x: T | null = null` runs into TS narrowing under strict mode. Wrap in an object (`const x = { value: null as T | null }`) and assign to `x.value`. The property access defeats narrowing because TS treats properties as potentially externally mutable.
- The migration question worth asking first is not "how do I call the new SDK?" but "what's the replacement pattern for the _specific feature_ my old code depended on?" For this code, the feature was structured JSON output. Identifying that as the load-bearing piece up front would have surfaced the guide gap before any code was written.
- Preserving a public interface during an SDK swap pays compound interest. The route, both clients, and the existing mock test all kept working. The cost of designing `NarrationService` as a thin behavior interface (rather than leaking SDK types) was paid once in the original implementation and saved real time here.

## Artifacts

- Migration guide used: `~/Projects/pi-agent-migration.md` (lives outside the repo; not versioned)
- Files touched in the swap:
  - `packages/daemon/src/services/narration-service.ts` (full rewrite of `generateNarration()`; interface unchanged)
  - `packages/daemon/package.json` (dropped `@anthropic-ai/claude-agent-sdk`, added `@mariozechner/pi-coding-agent` and `@mariozechner/pi-ai` at `^0.73.1`)
- Files notably _not_ touched (preserved interface paying off):
  - `packages/daemon/src/services/profile-service.ts`
  - `packages/daemon/src/routes/profile.ts`
  - `packages/daemon/tests/routes/profile-narrate.test.ts`
  - `packages/daemon/tests/helpers/test-app.ts`
  - `packages/web/lib/api.ts`, `packages/web/components/profile/*`
  - `packages/cli/src/client.ts`, `packages/cli/src/commands/profile.ts`
- Stale references worth a follow-up sweep (not in scope for this change):
  - `.lore/plans/features/llm-narrative.md` — marked `status: executed`; still describes the Agent SDK integration
  - `.lore/research/claude-agent-sdk.md` — reference doc; will need an equivalent for pi if future work touches narration
