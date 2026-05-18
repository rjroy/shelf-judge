---
title: bindExtensions is not optional when extensions register providers
date: 2026-05-17
status: complete
tags: [pi-agent, sdk, extensions, debugging]
modules: [daemon-narration]
related:
  - .lore/retros/incident/narration-agent-sdk-to-pi-agent.md
---

# Retro: bindExtensions is not optional when extensions register providers

## Summary

The pi-coding-agent migration shipped with `NarrationService` constructed against pi-ai's static `getModel(provider, modelId)` and `createAgentSession({ model, ... })`. Tests, typecheck, and lint were all clean. On first real call, narration returned in ~1 second with no LLM output and the agent terminated without ever calling `submit_narration`. The daemon logged `using model fallback:text` (the user's preferred model via a pi extension), but pi behaved as if no model was actually configured.

Root cause was two compounding gaps in how the migration consumed pi-agent:

1. **Wrong model resolution path.** Pi-ai's `getModel(provider, modelId)` only knows about models compiled into the pi-ai static MODELS map. User-registered providers (here: a `fallback` provider supplied by a personal pi extension that proxies to OpenRouter/Anthropic chains) live in the session's `ModelRegistry`, populated at runtime from `~/.pi/agent/extensions/` and `~/.pi/agent/models.json`. Calling `getModel("fallback", "text")` returned a degenerate object that pi accepted as the configured model but could not actually stream from. The correct path is `session.modelRegistry.find(provider, modelId)` _after_ extensions have loaded.

2. **`bindExtensions` is required, not optional.** The migration guide's gotcha #3 said "Extension UI calls silently no-op without `bindExtensions`. For pure one-shot scripts that don't render UI, skip it — most non-UI extension behavior runs fine without binding." That advice is wrong for any extension that hangs setup work off the `session_start` event. Reading `agent-session.js`, `bindExtensions()` is the _only_ call site that emits `session_start`. The user's fallback extension uses `pi.on("session_start", ctx => modelRegistryRef = ctx.modelRegistry)` to capture a reference at runtime. Without `bindExtensions`, that handler never fires, `modelRegistryRef` stays `null`, and the extension's `streamSimple` throws "Model registry not available" the first time pi tries to use it.

The fix is a four-step initialization sequence: create the session with no model, call `bindExtensions({})` to fire `session_start`, resolve the model through `session.modelRegistry.find()`, then `setModel()`. Once that order was right, narration ran end-to-end.

## What Went Well

- The original `NarrationService.generateNarration(profile)` interface kept paying off. The route, both clients, the route mock test, and every downstream caller were untouched through the swap, then untouched again through the debugging sessions, then untouched again through the package namespace change from `@mariozechner/*` to `@earendil-works/*` at v0.75.1. Behavior interfaces are cheap to commit to and they protect against churn that's hard to predict at design time.
- Adding `session.modelRegistry.getAll()` enumeration plus per-message dumps plus event-stream logging turned a black-box "agent finished without calling submit_narration" into a concrete trace. Once the logs showed the model object that pi-ai's `getModel` returned was a stub with no usable provider config, the path forward was obvious. Before the instrumentation pass: speculation. After: each variable's actual value was visible.
- The breakthrough on `bindExtensions` came from `grep "Model registry not available"` across all three pi packages and finding nothing. The exact error string lived in the user's extension, not in pi. That negative result was decisive evidence that the problem was extension-side, not SDK-side.
- The user's pushback ("are you logging enough or just guessing?") was correct and well-timed. Treating it as a course correction instead of a defense exit unblocked the next 30 minutes of work.

## What Could Improve

- **Speculation outran observation early on.** When the first failing run produced `using model fallback:text` followed by silence, I jumped to "pi-ai's getModel returns a faux model when auth is missing" without proof. The phrase "fallback" in my mental model collided with pi-ai's "faux" provider name and produced a wrong story that I then defended. The correct move was instrument-first: dump the resolved model object, dump session events, dump messages. The user had to explicitly say "stop guessing" before I did that. Default to instrumenting an integration before forming theories about it.
- **The migration guide was load-bearing for two decisions and wrong on both.** It described `outputFormat` as if it existed in pi (it doesn't — handled correctly by the submit_narration tool pattern), and described `bindExtensions` as skippable (it isn't, for extensions that use `session_start`). Both gaps caused real damage. Reading the actual `.d.ts` caught the first one; reading the user's extension source caught the second. The lesson is not "trust the guide less" but "the guide is a sketch; integration tests against the real user environment are the spec." Every assumption the guide encodes can be wrong, and the cost of finding out at runtime is higher than the cost of an end-to-end test on the real config.
- **Defaults baked in my environment, not the user's.** I chose `anthropic:claude-haiku-4-5-20251001` as the default narration model "to match the prior haiku behavior." The user's pi environment has no Anthropic auth configured at all — their entire setup runs through OpenRouter and the fallback extension. The default I picked would have produced an auth error on first run on a fresh machine, just like it produced the wrong call here. When the user's existing infrastructure is the runtime environment, defaults need to come from _their_ environment, not the package being replaced. The current default `openrouter:openrouter/free` reflects that correction.
- **Tests covered the contract but not the integration.** All 1235 tests passed when shipped because they mocked the `NarrationService` interface. The actual SDK wiring (model resolution, extension lifecycle, `prompt()` end-to-end) had zero coverage. This is the same shape as the prior `isAvailable()` retro: aux tests pass while the load-bearing path is unverified. A single integration test that spins up `createAgentSession` against a stub model would have caught the missing `bindExtensions` immediately.

## Lessons Learned

- An agent SDK that supports user extensions is two things at once: a framework with a stable type surface, and a runtime hosting arbitrary user code that runs at lifecycle events. The first is documented in `.d.ts`. The second is only documented by reading the user's extensions. When debugging an integration against a configured user environment, treat user extension source as part of the SDK contract.
- Lifecycle events are not "optional" just because they sound peripheral. `session_start`, `before_agent_start`, `agent_start`, `turn_start` — each is the only seam at which certain extension code can run. If any extension in the user's config depends on a lifecycle event, the host program must fire that event, even in headless/programmatic use. The default assumption should be "all lifecycle events fire" and the migration guide should call out which programmatic entry points actually fire them.
- The correct order for pi-agent programmatic init when user extensions may register providers: (1) `createAgentSession` with no model, (2) `await session.bindExtensions({})` to fire `session_start` and let extensions set up, (3) `session.modelRegistry.find(provider, modelId)` to resolve the model (now including extension-registered providers), (4) `await session.setModel(model)`, (5) `await session.prompt(...)`. Skipping step 2 silently breaks any extension that does setup on `session_start`. Using pi-ai's `getModel` instead of step 3 silently breaks any model the user added through an extension.
- Misleading error strings from user code look indistinguishable from framework errors. The phrase "Model registry not available" was thrown by the user's fallback extension when its captured `modelRegistryRef` was still `null`. It sounded like a pi-coding-agent message. The disambiguating test is one grep across the SDK packages: if the string doesn't appear there, the source is outside the SDK. That negative search is faster than reading the SDK source forward.
- When you've burned more than two debugging cycles on a stale theory, stop and instrument. Add logs that print the actual values of the variables your theory is about. The instrumentation will either confirm the theory in one run or hand you the real answer in the next.

## Artifacts

- Branch: `feat/narration-pi-agent`
- PR: https://github.com/rjroy/shelf-judge/pull/31
- Initial migration commit: `6ebea4a` (wrong: used pi-ai `getModel`, no `bindExtensions` call)
- Fix commit: `e3f86a9` (correct init order; package namespace also moved to `@earendil-works/*` at v0.75.1)
- User's pi extension that exposed the gap: `~/.pi/extensions/pi-fallback-provider/src/index.ts` (loads fallback chains from `~/.pi/fallback-chains.json`, registers `fallback` provider, captures `ModelRegistry` reference on `session_start`)
- Migration guide that misled on this point: `~/Projects/pi-agent-migration.md` (gotcha #3, which says `bindExtensions` is skippable for non-UI scripts)
- Follow-up: the diagnostic logs added during this session are still in `narration-service.ts`. They should come out (or move to a debug flag) once the path is stable.
