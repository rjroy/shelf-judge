---
title: "Collection Identity and Taste Profiling"
date: 2026-04-10
status: draft
tags: [spec, profiling, collection, llm, agent-sdk, outlier, divergence]
modules: [daemon, shared, web, cli]
req-prefix: PROFILE
related:
  - .lore/brainstorms/collection-profiling.md
  - .lore/brainstorms/prediction-engine.md
  - .lore/issues/deferred-collection-profiling.md
  - .lore/issues/deferred-llm-integration.md
  - .lore/specs/mvp.md
  - .lore/specs/utility-curves.md
  - .lore/designs/mvp-data-model.md
  - .lore/designs/mvp-fitness-model.md
  - .lore/research/claude-agent-sdk.md
  - .lore/vision.md
---

# Spec: Collection Identity and Taste Profiling

## Overview

The collection tells the owner something about what they value. Profiling makes that legible.

This feature computes a deterministic statistical profile from the user's existing collection data (ratings, axes, BGG attributes, tournament results) and presents it as a Profile Overview page. The profile surfaces patterns the user never explicitly articulated: rating distributions, mechanic concentrations, preference shapes, games that diverge between stated and revealed preferences, and games that don't fit the collection's statistical identity.

An optional LLM narration layer (via Claude Agent SDK) interprets the algorithmic profile in natural language, naming patterns and tensions that statistics alone can't articulate. The narration is cached, user-initiated, and never determines scores.

This is the realization of Vision Principle 3: "Your collection has an identity."

## Entry Points

- Profile Overview page (replaces home page in web UI)
- `shelf-judge profile` CLI command
- Profile section on individual game detail view (divergence/outlier status)
- Axis configuration flow (suggested axes from profile analysis)

## Requirements

### Algorithmic Profile

- REQ-PROFILE-1: The daemon computes a collection-level statistical profile from existing data. The profile is a read-only computation that does not alter scores, ratings, or any stored data. The profile covers four categories: axis rating distributions, axis weight interpretation, BGG attribute clustering, and utility curve declarations.

- REQ-PROFILE-2: For each axis, the profile computes mean, median, standard deviation, and range across all rated games. These statistics describe the shape of the user's ratings on that dimension: whether values cluster tightly (strong preference filter) or spread widely (tolerance for variance).

- REQ-PROFILE-3: The profile interprets the user's axis weights as a relative importance ranking. Weights are expressed as percentages of total weight, making the implicit priority ordering explicit.

- REQ-PROFILE-4: The profile groups the collection by BGG mechanics, categories, subdomains, and weight ranges. For each attribute, the profile reports the count and percentage of games that share it. Attributes that appear in fewer than two games are still reported but not highlighted as concentrations.

- REQ-PROFILE-5: When utility curves are configured on an axis, the profile includes them as explicit preference declarations: the shape, ideal value (if sweet spot), tolerance, lean direction, and veto thresholds. These are reported in native-scale terms (per the utility curves spec).

- REQ-PROFILE-6: The profile computation uses only data already stored in the collection. No external API calls, no LLM inference, no new user input. Every statement in the profile traces back to specific ratings, weights, BGG data, or tournament results.

### Tournament/Fitness Divergence

- REQ-PROFILE-7: The profile identifies games where normalized tournament score (the `normalizedScore` from `TournamentGameStatsDisplay`, which maps ELO to a 1-10 scale) and fitness score disagree by more than 1.5 points. This threshold defines "significant divergence." Games with a null normalized score (fewer than 5 games ranked, or zero comparisons) are treated as having no tournament data for divergence purposes and are excluded.

- REQ-PROFILE-8: Two divergence types are distinguished. **Tournament outliers** (high ELO, low fitness): games the user reaches for in head-to-head comparisons but rates poorly on their explicit axes. **Fitness outliers** (high fitness, low ELO): games that score well on paper but lose in direct comparison.

- REQ-PROFILE-9: Each divergent game is reported with both scores, the gap magnitude, and which direction the divergence runs. The divergence list is informational. The system names the tension; the user resolves it.

- REQ-PROFILE-10: Divergence analysis requires tournament data. Games with zero comparisons are excluded. When no tournament data exists, the divergence section is omitted from the profile (not shown as empty).

### Collection Outlier Detection

- REQ-PROFILE-11: The profile identifies games whose BGG attributes place them far from the collection's statistical center across multiple dimensions. The outlier threshold (REQ-PROFILE-12) applies to an aggregate multi-dimensional distance, not per-dimension counting. A game that is extreme on one dimension alone is not necessarily an outlier; the distance metric naturally weights games that deviate across several dimensions higher than games that deviate on only one.

- REQ-PROFILE-12: Outlier detection considers mechanics, categories, subdomains, complexity (BGG weight), player count range, and play time. The default threshold is 2 standard deviations from the collection centroid. The threshold should be validated against the existing 200-game collection during implementation and adjusted if it flags too many or too few games.

- REQ-PROFILE-13: Three outlier classifications are reported:
  - **Lone wolves**: games with no close neighbors in the collection across multiple attribute dimensions.
  - **Category orphans**: games in BGG categories or subdomains that appear nowhere else in the collection.
  - **High-fitness outliers**: games whose axes say "keep it" but whose BGG attributes say "this doesn't fit the collection's identity."

- REQ-PROFILE-14: Outlier detection is observation, not judgment. The profile surfaces which games are statistically unusual without recommending action. "This game doesn't look like the rest of your collection" is the limit of what the system says.

### Axis Suggestions

- REQ-PROFILE-15: The profile suggests new axes the user might create, drawn from three sources:
  - **Unexpressed concentration**: a BGG mechanic or category shared by 80%+ of the collection with no corresponding axis.
  - **High-variance BGG attributes**: a BGG dimension (e.g., play time, player count) that spans a wide range across the collection with no corresponding axis.
  - **Tournament divergence repair**: when divergent games (per REQ-PROFILE-8) share a BGG attribute not captured by existing axes.

- REQ-PROFILE-16: Axis suggestions are presented as questions, not imperatives. No axis is created without explicit user action. Dismissing a suggestion removes it from the current profile view. Dismissals are session-only (not persisted). When the profile recomputes, all suggestions reappear for fresh consideration.

- REQ-PROFILE-17: The algorithmic suggestion engine operates without LLM inference. When LLM narration is available (REQ-PROFILE-22), suggestions become part of the narrative with richer interpretation, but the underlying suggestion logic is deterministic.

### LLM Narration

- REQ-PROFILE-18: The daemon integrates with the Claude Agent SDK (TypeScript) to produce a natural-language narrative that interprets the algorithmic profile. The narrative sits alongside the profile data as an enhancement, not a replacement. The algorithmic profile (REQ-PROFILE-1 through REQ-PROFILE-17) must function fully without the LLM.

- REQ-PROFILE-19: The Agent SDK integration uses structured outputs (`outputFormat` with JSON Schema). The agent returns a typed response with named sections (summary, surprises, tensions, blind spots), not free-form text. This keeps the output parseable and displayable in structured UI.

- REQ-PROFILE-20: The daemon exposes collection data to the agent via in-process MCP tools. The agent can pull additional context beyond the initial structured profile if needed.

- REQ-PROFILE-21: Budget control (`maxBudgetUsd`) caps per-profile generation cost. A single profile narrative should be bounded to prevent runaway token consumption.

- REQ-PROFILE-22: The LLM adds interpretation that statistics alone cannot provide:
  - **Pattern naming**: identifying throughlines across games that share a mechanic in different contexts.
  - **Tension identification**: surfacing disagreements between stated preferences (axis weights) and revealed preferences (tournament choices).
  - **Blind spot surfacing**: naming attribute categories that are absent or underrepresented.
  - **Utility curve connection**: relating configured curves to actual collection distributions.

- REQ-PROFILE-23: The LLM never determines scores. The fitness calculation remains deterministic math. The LLM reads the results of that math and narrates them. This preserves the vision's transparency guarantee (Principle 2).

### Profile Storage and Caching

- REQ-PROFILE-24: The profile is persisted as a stored dataset, following the same pattern as tournament data. It is not recomputed on every page view.

- REQ-PROFILE-25: Any write to collection data (ratings, games, axes, tournament results, BGG refreshes) sets a dirty flag. The profile recomputes lazily on the next view when the flag is set.

- REQ-PROFILE-26: The LLM narration is cached alongside the profile data. Three states:
  - **Current**: the narration matches the current profile data. Display it.
  - **Stale**: the profile data has changed since narration was generated. Display the old narration with a visual indicator and a "regenerate" button.
  - **Empty**: no narration has been generated. Show a prompt to generate, or show nothing if the Agent SDK is unavailable.

- REQ-PROFILE-27: Narration regeneration is always user-initiated, never automatic. No ambient LLM calls, no background token consumption. Stale narration is better than nothing.

- REQ-PROFILE-28: Agent SDK authentication is not the application's concern. The daemon uses the Agent SDK; the SDK handles its own authentication (via `ANTHROPIC_API_KEY` or equivalent). Shelf Judge does not store, configure, or manage API keys for the LLM. If the SDK cannot authenticate, the narration is unavailable (empty state per REQ-PROFILE-26).

### Web UI

- REQ-PROFILE-29: The Profile Overview page replaces the current home page. The collection list moves to a separate "Collection" page in the navigation. Different interaction modes (aggregate understanding vs. per-game browsing) belong on different pages.

- REQ-PROFILE-30: The Profile Overview page displays:
  - LLM narration summary at the top (when available, per REQ-PROFILE-26 states)
  - Axis rating distributions with statistical summaries
  - Axis weight breakdown as percentages
  - BGG attribute clustering (top mechanics, categories, subdomains, weight distribution)
  - Utility curve declarations (when configured)
  - Tournament/fitness divergence list (when tournament data exists)
  - Collection outlier list
  - Suggested axes section

- REQ-PROFILE-31: The game detail view includes the game's divergence status (if applicable) and outlier status (if applicable) as part of its profile context. A game that is both a divergence outlier and a collection outlier shows both.

### CLI

- REQ-PROFILE-32: The `shelf-judge profile` command returns the full profile as structured JSON. The CLI is a programmatic interface for LLM/agent access, not a human-facing summary. The web UI handles all human-facing presentation and visualization.

- REQ-PROFILE-33: The `--json` flag (per REQ-MVP-23) applies to the profile command. Since the profile command's default output is already structured JSON, the flag is accepted but has no behavioral difference.

- REQ-PROFILE-34: The CLI can trigger LLM narration regeneration via a subcommand (e.g., `shelf-judge profile narrate`). The command returns the narration as part of the profile JSON response. If the Agent SDK is unavailable, the command reports the error and returns the algorithmic profile without narration.

### Anti-Goals

- REQ-PROFILE-35: The profiling feature must not become a recommendation engine. The profile describes what the user already owns and values. It does not say "you should buy X."

- REQ-PROFILE-36: The profile is not a social signal. No sharing, exporting for social media, or quiz-style outputs. The profile serves the owner, not an audience.

- REQ-PROFILE-37: The profile does not generate, fill in, or override ratings. If the profile suggests an axis (REQ-PROFILE-15), the user still creates it and rates games manually.

- REQ-PROFILE-38: The profile is not a prescriptive curation coach. "Your party games consistently score below 4 on your axes" is acceptable. "You should cull your party games" is not. The system presents data; the user decides what it means.

## Exit Points

| Exit                         | Triggers When                                                               | Target                                                   |
| ---------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------- |
| Prediction engine            | User wants fitness estimates for unowned games based on profile centroid    | [STUB: prediction-engine]                                |
| Redundancy scoring           | Collection-aware fitness that uses profile clusters to detect overlap       | [STUB: redundancy-scoring]                               |
| Conversational axis creation | User wants to create axes through natural language dialogue with the LLM    | [STUB: conversational-axis-creation]                     |
| Custom curve editor          | Profile analysis reveals preference shapes not covered by the three presets | [Spec: utility-curves] (exit point: custom-curve-editor) |
| Profile drift detection      | User wants temporal snapshots of how the profile changes over time          | [STUB: profile-drift-detection]                          |

## Success Criteria

### Automated Tests

- [ ] Axis rating distributions compute correct mean, median, standard deviation, and range for a known dataset
- [ ] BGG attribute clustering correctly counts and percentages mechanics, categories, and subdomains
- [ ] Tournament/fitness divergence correctly identifies games above the 1.5-point threshold in both directions
- [ ] Divergence analysis excludes games with zero tournament comparisons
- [ ] Divergence section is omitted (not empty) when no tournament data exists
- [ ] Outlier detection flags games that deviate on multiple BGG attribute dimensions simultaneously
- [ ] A game unusual on only one dimension is not flagged as an outlier
- [ ] Category orphan detection correctly identifies games in categories appearing only once
- [ ] Lone wolf detection flags a game sharing zero mechanics with any other collection game
- [ ] High-fitness outlier detection flags a game with high fitness score but BGG attributes placing it beyond the outlier threshold from the collection centroid
- [ ] Axis suggestion engine identifies unexpressed concentrations at the 80% threshold
- [ ] Axis suggestion engine identifies high-variance BGG attributes with no corresponding axis
- [ ] Profile dirty flag is set on any collection mutation (game add/remove, rating change, axis change, tournament comparison, BGG refresh)
- [ ] Profile recomputes on next read when dirty flag is set
- [ ] Profile does not recompute when dirty flag is not set
- [ ] LLM narration cache returns current/stale/empty states correctly
- [ ] Agent SDK structured output parses into the expected typed response
- [ ] Profile computation produces identical results on repeated calls with unchanged data (determinism)

### Manual Verification

- [ ] Profile Overview page displays all sections with real collection data (200-game dataset)
- [ ] LLM narration contains at least one specific claim traceable to the algorithmic profile (e.g., names a mechanic concentration, identifies a specific divergent game, or references a configured utility curve)
- [ ] Stale narration displays with a visual indicator and regenerate button after a rating change
- [ ] Outlier threshold (2 standard deviations) produces a reasonable number of flagged games (not zero, not half the collection)
- [ ] CLI `shelf-judge profile` returns complete profile as parseable JSON
- [ ] Profile Overview replaces home page; collection list is accessible from separate nav entry
- [ ] Game detail view shows divergence and outlier status when applicable
- [ ] When Agent SDK is unavailable, the profile page shows the algorithmic profile without narration (empty state)

## AI Validation

**Defaults** (apply unless overridden):

- Unit tests with mocked time/network/filesystem/LLM calls (including Agent SDK `query()`)
- 90%+ coverage on new code
- Code review by fresh-context sub-agent

**Custom:**

- Profile statistics validated against hand-calculated examples for a small known dataset (5-10 games, 3 axes)
- Divergence detection tested against games with known fitness and tournament scores at both sides of the 1.5-point threshold
- Outlier detection tested against a collection with one deliberate outlier (a heavy wargame in a collection of medium-weight euros)
- LLM integration tested with Agent SDK calls mocked at the SDK boundary, verifying structured output parsing and cache state transitions
- When adding profile routes to the daemon, verify that both web proxy route and CLI client helper are updated in the same change (per tournament retro lesson)
- Feature vector computations (mechanic overlap, attribute distance) should be structured for reuse by the future prediction engine ([STUB: prediction-engine])

## Constraints

- The fitness formula and calculation remain unchanged. Profiling reads fitness results; it does not participate in computing them.
- No new external service dependencies except the Claude Agent SDK (TypeScript), which is optional. The algorithmic profile has zero external dependencies.
- Profile data follows the existing JSON file persistence pattern (REQ-MVP-20, REQ-MVP-21). Atomic writes via temp file + rename.
- The Agent SDK integration uses the user's own Claude subscription. Shelf Judge does not bundle, manage, or proxy API credentials.
- Profile computation is local math and aggregation. No network calls for the algorithmic profile.
- The prediction engine is explicitly out of scope. The profile computes what the collection _is_; it does not estimate what unowned games _would be_. However, feature vector computations should be structured for reuse by the prediction engine when it ships.
- No minimum collection size gate. The profile computes from whatever data exists. With fewer than 3 games, some analyses (outlier detection, divergence) will produce empty or partial results, which is acceptable. The profile page still displays; sections with insufficient data are omitted rather than showing empty states.

## Open Questions

1. **Profile data file location.** Should the profile persist as a separate file (e.g., `~/.shelf-judge/profile.json`) alongside `collection.json` and `tournament.json`, or as a section within an existing file? Separate file matches the tournament data precedent and keeps concerns isolated. The implementer should follow the tournament pattern unless there's a reason not to.
USER NOTE: That's the location I expected.

2. **Outlier distance metric.** The brainstorm specifies "multi-dimensional distance from collection centroid" but doesn't name the metric. Euclidean distance over normalized attribute vectors is the obvious choice, but cosine similarity may better capture "doesn't fit" for sparse categorical data (mechanics, categories). The implementer should evaluate both against the 200-game dataset and choose the one that produces more intuitive results.
USER NOTE: This needs seperate design.

3. **Agent SDK session resumption.** The brainstorm mentions session resumption for follow-up questions ("Why do you say I have a blind spot for cooperative games?"). Whether the profile page supports conversational follow-up with the LLM agent or only one-shot narration is an implementation scope decision. One-shot narration is sufficient for this spec; conversational follow-up can be added as an enhancement.
USER NOTE: Conversational follow-up is out of scope entirely.

## Context

- [Brainstorm: Collection Identity and Taste Profiling](.lore/brainstorms/collection-profiling.md): Approved brainstorm with five proposals, all included in this spec. Profile Drift Detection was rejected; Prediction Engine was parked to a separate issue.
- [Brainstorm: Prediction Engine](.lore/brainstorms/prediction-engine.md): Open brainstorm that shares feature vectors and similarity computations with profiling. The prediction engine's interaction map recommends building profiling's feature vector module with prediction in mind.
- [Vision](.lore/vision.md): Principle 3 ("Your collection has an identity") is the direct driver. Principle 2 ("One number, honestly derived") constrains the LLM to narration, not scoring. Principle 4 ("Data serves judgment") shapes the anti-goals.
- [MVP Spec](.lore/specs/mvp.md): Collection profiling was deferred as [STUB: collection-profile]. This spec resolves that stub.
- [Utility Curves Spec](.lore/specs/utility-curves.md): Curve declarations feed into the profile (REQ-PROFILE-5). Native scales and preference shapes are reported as part of the profile.
- [Agent SDK Research](.lore/research/claude-agent-sdk.md): Documents the TypeScript SDK capabilities used in the LLM narration layer: structured outputs, in-process MCP servers, budget control, session management.
- [Retro: Tournament Stats Shape Mismatch](.lore/retros/tournament-stats-record-shape-mismatch.md): Lesson applied in AI Validation: when adding daemon routes, update both web and CLI client helpers in the same change.
- [Issue: Deferred Collection Profiling](.lore/issues/deferred-collection-profiling.md): The issue that triggered this spec. Contains user notes requesting LLM-driven profiling via Agent SDK.
- [Issue: Deferred LLM Integration](.lore/issues/deferred-llm-integration.md): Related LLM features (natural language explanation, conversational axis creation) that share the Agent SDK dependency.
