---
title: "Collection Identity and Taste Profiling"
date: 2026-04-09
status: open
tags: [brainstorm, profiling, collection, llm, agent-sdk, vision-principle-3]
related:
  - .lore/issues/deferred-collection-profiling.md
  - .lore/issues/deferred-llm-integration.md
  - .lore/issues/deferred-prediction-engine.md
  - .lore/specs/utility-curves.md
  - .lore/designs/mvp-data-model.md
  - .lore/designs/mvp-fitness-model.md
  - .lore/research/claude-agent-sdk.md
  - .lore/brainstorms/fitness-model-options.md
---

# Brainstorm: Collection Identity and Taste Profiling

## Header

**Vision status:** Active. Four-step alignment analysis applied to each proposal.

**Context scanned:** `.lore/vision.md`, all `.lore/issues/` (open and resolved), `.lore/brainstorms/` (fitness-model-options, collection-filter-sort), `.lore/specs/utility-curves.md`, `.lore/designs/mvp-data-model.md`, `.lore/designs/mvp-fitness-model.md`, `.lore/research/claude-agent-sdk.md`, `packages/shared/src/types.ts`, `packages/daemon/src/services/fitness-service.ts`, recent git history.

**Recent brainstorm check:** Two prior brainstorms exist. `fitness-model-options.md` (resolved) explored Approach 3 (Collection Profile + Attribute Similarity) and Approach 5 (LLM-Mediated Synthesis), both adjacent to this territory. Neither was selected as the primary fitness model, but both contain observations that apply here. `collection-filter-sort.md` (resolved) is unrelated. No prior brainstorm addresses collection profiling directly.

---

## What data already exists for profiling

Before imagining what a profile could say, inventory what the system already knows. The profiling feature doesn't start from zero; it reads a dataset that's been accumulating since the user's first game import.

**Per-game structured data (from `Game` and `BggGameData` in `packages/shared/src/types.ts`):**

- Personal axis ratings: `Record<string, number>` keyed by axis ID, 1-10 scale
- BGG mechanics and categories: `BggTag[]` arrays with id and name
- BGG weight (complexity): 1-5 continuous scale
- BGG community rating: 1-10 scale
- BGG families: `BggTag[]` (publisher families, series, etc.)
- BGG subdomains: `string[]` ("Strategy Games", "Family Games", etc.)
- Player count range: `minPlayers` / `maxPlayers`
- Suggested player counts: community poll data with best/recommended/notRecommended votes
- Play time in minutes
- Year published

**Per-axis configuration (from `Axis`):**

- Weight (1-100): how much the user cares about this dimension
- Preference shape, ideal value, tolerance, lean direction (utility curves, being built)
- Veto thresholds

**Tournament data (from `TournamentData`):**

- ELO ratings per game: the user's revealed preference ordering
- Comparison history: every pairwise choice with timestamps
- Win/loss records between specific games

**Computed at query time:**

- Fitness scores with full breakdowns per axis
- Veto status

This is a rich dataset. A user with 30 rated games, 5 custom axes, and a tournament history has hundreds of data points that encode preference patterns they never explicitly articulated.

---

## Proposal 1: Algorithmic Taste Profile from Rating Distributions

### Evidence

The `ratings` field on each `Game` (`packages/shared/src/types.ts:57`) stores per-axis values. The `Axis` type stores weights. The fitness service (`packages/daemon/src/services/fitness-service.ts:33-120`) iterates every axis for every game. No code currently aggregates across games to characterize the collection.

BGG mechanics and categories are stored as `BggTag[]` arrays on `BggGameData` (`types.ts:39-40`). These are structured, enumerable, and already present for every BGG-imported game. The utility curves spec (REQ-CURVE-7 through REQ-CURVE-9) adds ideal values, tolerance levels, and lean directions to axes, which are direct declarations of preference shape.

### Proposal

Build a deterministic profiling service in the daemon that computes collection-level statistics from existing data. No LLM. No external API calls. Pure aggregation over the data the user has already entered.

The profile computes:

1. **Axis rating distributions.** For each axis, calculate mean, median, standard deviation, and range across all rated games. Surface the shape: "Your 'Wife will play it' ratings cluster between 6-9 (mean 7.4, std 1.1). Your 'Visual design' ratings spread across the full range (mean 5.8, std 2.9)." The tight cluster says "you don't own games your wife won't play." The wide spread says "visual design varies a lot in your collection, and you're fine with that."

2. **Axis weight interpretation.** The user's axis weights already declare relative importance. The profile narrates this: "Playability with your partner dominates your scoring at 40% weight. Visual design and complexity matter equally at 20% each." This is the preference the user chose but may not have articulated in words.

3. **BGG attribute clustering.** Group the collection by BGG mechanics, categories, subdomains, and weight ranges. Surface concentrations: "67% of your collection includes hand management. Your complexity sweet spot is BGG weight 2.0-3.0 (18 of 27 games). You own zero games in the 'Wargames' subdomain."

4. **Tournament-derived preference.** Where tournament data exists, compare ELO rankings against fitness scores. Divergence is the interesting signal: games that rank high in tournaments but low on fitness have qualities the axes don't capture. Games that rank low in tournaments but high on fitness are games the user thinks they should like but don't reach for.

5. **Utility curve declarations.** When utility curves are configured, the profile includes them as explicit preference statements: "You've declared a complexity sweet spot at BGG weight 2.75 with moderate tolerance. You've vetoed any game your wife rates below 4."

The profile is a read-only computation. It doesn't alter scores, ratings, or any stored data. It updates whenever the underlying data changes (new ratings, new games, curve changes).

### Rationale

This is the minimum viable profile. Everything it computes is derivable from data the user already entered through the normal workflow. No new input burden. No API costs. No non-determinism. The profile is as transparent as the fitness score itself: every statement traces back to specific ratings, weights, and BGG data.

The insight it surfaces is genuinely useful: most users have never computed the standard deviation of their "Wife will play it" ratings, but that number tells them something real about what they tolerate on their shelf.

### Vision alignment

1. **Anti-goal check.** Does this create automated purchase decisions? No. The profile describes what the user already owns and how they've rated it. It doesn't recommend acquisitions. Does this create social/competitive features? No. Single-user, local-only. Does this replace BGG? No. It reads BGG data but produces a personal profile, not a game database.

2. **Principle alignment.** Principle 3 ("your collection has an identity") is the direct driver. The vision's example: "You favor low-interaction, medium-weight games with strong visual design. Party games score consistently low on your axes." This proposal produces exactly that kind of statement. Principle 2 ("one number, honestly derived") extends: the profile is honestly derived from the same transparent data the fitness score uses. Principle 1 ("ownership is personal") is respected: the profile reflects the user's axes, not a universal rating system.

3. **Tension resolution.** Personal axes vs BGG data accuracy: the profile uses both but distinguishes them (axis ratings are personal, mechanic clusters are BGG-derived). Fitness precision vs transparency: the profile is fully transparent, every statistic traces to source data. Prediction honesty: the profile makes no predictions, only observations.

4. **Constraint check.** No new dependencies. No external services. The daemon already has all the data. The computation is local math plus aggregation.

### Scope

**Medium.** New daemon service, new API endpoints, new UI section (web) and command (CLI). The math is straightforward. The interesting work is deciding which statistics are worth surfacing and how to present them without overwhelming the user.

---

## Proposal 2: LLM-Narrated Profile via Claude Agent SDK

### Evidence

The deferred issue (`deferred-collection-profiling.md:31-32`) includes user notes: "What if this was LLM driven?" and "use Claude Agent SDK to gain the benefits of using the subscription." The Agent SDK research (`.lore/research/claude-agent-sdk.md`) documents the TypeScript SDK with structured outputs, in-process MCP servers, session management, and budget controls. The deferred LLM integration issue (`deferred-llm-integration.md:19`) describes "natural language score explanation" as a deferred feature category.

The existing fitness breakdown (`FitnessResult` in `types.ts:107-121`) already provides the structured data an LLM would narrate from: score, axis contributions, veto status, and hypothetical scores.

### Proposal

Use the Claude Agent SDK (TypeScript) to create an LLM-powered profile narrator. The daemon exposes a new endpoint that:

1. Computes the algorithmic profile from Proposal 1 (distributions, clusters, divergences).
2. Passes the structured profile data to a Claude agent via the Agent SDK.
3. The agent produces a natural-language narrative that interprets the statistics in the context of the user's collection.

The Agent SDK integration uses:

- **Structured outputs** (`outputFormat` with JSON Schema): the agent returns a typed `ProfileNarrative` object with sections (summary, surprises, tensions, blind spots), not free-form text. This keeps the output parseable and displayable in structured UI.
- **In-process MCP server**: the daemon exposes collection data as MCP tools (`getCollectionStats`, `getGameDetails`, `getAxisConfig`). The agent can pull additional context if the initial structured profile isn't enough.
- **Budget control** (`maxBudgetUsd`): caps per-profile generation cost. A single profile narrative should cost pennies.
- **Session management**: the profile session can be resumed if the user wants to ask follow-up questions ("Why do you say I have a blind spot for cooperative games?").

What the LLM adds over pure statistics:

- **Pattern naming.** Statistics say "67% of your collection includes hand management." The LLM says "You're a hand management collector. This isn't just a mechanic preference; it shows up in your thematic games (Wingspan, Everdell) and your abstract games (Jaipur, 7 Wonders Duel). It's a throughline."
- **Tension identification.** "Your axis weights say complexity matters (20% weight), but your tournament choices consistently favor lighter games over heavier ones when forced to choose. Your stated and revealed preferences disagree here."
- **Blind spot surfacing.** "You have no games with area control as a primary mechanic, despite owning several that include it as a secondary. This might be intentional, or it might be an unexplored territory."
- **Connection to utility curves.** "Your complexity sweet spot at 2.75 aligns with your actual collection: 22 of 30 games fall within your 'flexible' tolerance range. The curve isn't aspirational; it describes what you already do."

The key constraint: **the LLM never determines scores.** The fitness calculation remains deterministic math in `fitness-service.ts`. The LLM reads the results of that math and narrates them. This preserves the vision's transparency guarantee. The user can always ignore the narrative and look at the numbers directly.

### Rationale

The user specifically asked for LLM-driven profiling and specifically called out the Agent SDK as the integration mechanism. The Agent SDK's structured outputs solve the non-determinism concern from the fitness-model brainstorm's Approach 5 verdict: the LLM narrates a deterministic profile, it doesn't produce one. The narrative is regenerable (different words, same data) but the underlying profile is stable.

The subscription benefit is real: the user already pays for Claude access. Using the Agent SDK for profile narration lets the tool leverage that subscription for a feature that pure statistics can't replicate, naming patterns that exist in the data but require interpretation to articulate.

### Vision alignment

1. **Anti-goal check.** Automated purchase decisions? No. The narrative describes the existing collection, not what to buy next. Social/competitive? No. BGG replacement? No.

2. **Principle alignment.** Principle 3 is the direct driver. Principle 2 ("one number, honestly derived") is preserved: the fitness score is still deterministic. The narrative sits alongside the score, not inside it. Principle 4 ("data serves judgment") applies: the LLM is serving the user's judgment by making their data more legible, not replacing their judgment with its own.

3. **Tension resolution.** Prediction honesty: the narrative makes observations, not predictions. If it speculates ("you might enjoy cooperative games"), it's clearly framed as interpretation, not a score. Fitness precision vs transparency: the underlying profile data is fully transparent; the narrative is an additional layer, not a replacement.

4. **Constraint check.** New dependency: Claude Agent SDK (TypeScript). This is an external service dependency, but it's the user's own subscription. Network required for LLM calls. The algorithmic profile (Proposal 1) must work standalone without the LLM; the narrative is an enhancement, not a requirement. Cost scales per profile generation, not per page load (profiles are cached and regenerated on demand).

### Scope

**Large.** Agent SDK integration is a new architectural capability for the daemon. Requires: SDK dependency, MCP tool definitions, structured output schema, session management, cost tracking, caching, and a fallback path when the LLM is unavailable. The algorithmic profile (Proposal 1) is a prerequisite.

---

## Proposal 3: Tournament/Fitness Divergence as a First-Class Insight

### Evidence

The system computes two independent quality signals: fitness score (weighted average of explicit axis ratings) and tournament ELO (pairwise comparison choices). These are computed by different services (`fitness-service.ts` and the tournament system) and displayed independently in the web UI's collection table. No code currently compares them.

The fitness-model brainstorm (`fitness-model-options.md:466-476`) chose the hybrid model precisely because stated preferences (axis ratings) and revealed preferences (pairwise choices) capture different truths: "People rate Gloomhaven a 9 because they think they should, then never play it. Forced pairwise comparison ('which stays?') surfaces the truth."

### Proposal

Add a divergence analysis to the profile that identifies games where fitness score and tournament ranking disagree significantly. Define "significant divergence" as: a game whose normalized tournament score and fitness score differ by more than 1.5 points on a 1-10 scale.

Two types of divergence:

1. **Tournament outliers (high ELO, low fitness).** These are games the user reaches for in head-to-head comparisons but rates poorly on their explicit axes. The profile surfaces: "Catan ranks #4 in your tournament but scores 5.2 on fitness. Something about this game appeals to you beyond what your axes capture." This is a signal that the user's axis set may be incomplete, that there's a preference dimension they haven't named.

2. **Fitness outliers (high fitness, low ELO).** Games that score well on paper but lose in direct comparison. "Terraforming Mars scores 8.1 on fitness but ranks #18 in your tournament. Your axes say it should be great; your gut says otherwise." This is a signal of aspirational preference versus revealed preference.

The divergence list becomes a prompt for self-reflection: are the axes wrong, or is the tournament capturing something the axes shouldn't? Both answers are valid. The system names the tension; the user resolves it.

Implementation: a new section in the profile response that lists divergent games with both scores, the gap, and which direction the divergence runs. For the LLM narrative (Proposal 2), divergence data is particularly rich material for interpretation.

### Rationale

This is the insight that falls out of having two independent scoring systems and nobody asking "do they agree?" The data for this analysis already exists in every collection with tournament history. The computation is trivial (compare two numbers per game). The insight is non-trivial: it surfaces the gap between what the user says they value and what they actually choose.

This addresses the profiling issue's core intent: "the collection itself tells you something about what you value." Divergence tells the user something they probably don't know about themselves.

### Vision alignment

1. **Anti-goal check.** Not a purchase recommendation. Not social. Not a BGG replacement.

2. **Principle alignment.** Principle 3 directly. Principle 2 extends: the divergence is as transparent as the scores themselves (two numbers, their difference). Principle 4: the system presents the tension; the user decides what it means.

3. **Tension resolution.** This proposal creates a new tension: "which signal should the user trust?" The answer, consistent with the vision, is that neither overrides the other. The profile names the disagreement. The user judges. This is "data serves judgment" in action.

4. **Constraint check.** No new dependencies. Computation is local. Requires tournament data to be populated (at least some comparisons completed).

### Scope

**Small.** New computation (difference between two existing numbers), new section in profile output, new UI element. Minimal code.

---

## Proposal 4: Profile-Driven Axis Suggestions

### Evidence

The Axis type (`types.ts:64-78`) requires the user to define axes manually: name, weight, source, and (with utility curves) preference shape. The deferred LLM issue (`deferred-llm-integration.md:23`) describes "conversational axis creation" as a deferred feature. The current axis configuration flow (both web and CLI) assumes the user already knows what dimensions they care about.

The BGG data stored per game includes mechanics (`BggTag[]`), categories (`BggTag[]`), and families (`BggTag[]`). These are structured vocabularies that describe game attributes. The collection-level distribution of these tags (which mechanics appear most, which are absent) is computable without an LLM.

### Proposal

After the algorithmic profile (Proposal 1) identifies the user's collection characteristics, suggest new axes the user might not have thought to create. Two sources of suggestions:

1. **Unexpressed concentration.** If 80% of the user's games share a mechanic (say, "Hand Management") and no existing axis captures that dimension, suggest: "You own 24 hand-management games but don't have an axis for it. Creating a 'Hand Management Quality' axis would let you distinguish between the ones that do it well and the ones where it's incidental."

2. **High-variance BGG attributes.** If the collection spans a wide range on a BGG dimension that isn't currently an axis (e.g., play time ranges from 15 to 240 minutes with no "play time" axis), suggest: "Your collection ranges from 15-minute fillers to 4-hour epics. A play-time preference axis would help the fitness score reflect your time-budget preferences."

3. **Tournament divergence repair.** From Proposal 3: if specific games consistently diverge between tournament and fitness, and those games share an attribute not captured by existing axes, suggest: "Your tournament favorites that underperform on fitness all happen to be cooperative games. A 'Cooperative Appeal' axis might close this gap."

The suggestions are presented as questions, not imperatives. The user can dismiss any suggestion. No axis is created without explicit user action.

For the LLM-narrated profile (Proposal 2), axis suggestions become a natural part of the narrative: "Your axes cover theme, complexity, and partner playability. But your tournament data suggests you also care deeply about game length, even though you haven't named it."

### Rationale

The profiling issue's context notes include: "Could surface things like: 'you consistently rate theme higher than mechanics.'" But the more actionable insight is "here's a dimension you care about that your scoring system doesn't capture." The profile doesn't just describe what exists; it identifies gaps in the user's self-model.

This connects profiling to the scoring system in a feedback loop: profile observes patterns, suggests axes, user creates axes, axes refine scores, scores feed back into the profile. The system gets more accurate without the user having to intuit what's missing.

### Vision alignment

1. **Anti-goal check.** Not purchase recommendations. Not social. Not BGG replacement. Suggestions are about the user's own rating system, not about which games to buy.

2. **Principle alignment.** Principle 1 ("ownership is personal and specific"): suggestions help the user articulate their own criteria. The axis remains personal; the system just noticed a pattern the user didn't name. Principle 3 directly. Principle 4: the suggestion is data-informed, but the user decides whether to act.

3. **Tension resolution.** Personal axes vs BGG data: suggestions drawn from BGG attributes (mechanics, categories) are grounded in BGG vocabulary, but the resulting axis is personal. The user rates it; BGG named it. This is the right balance.

4. **Constraint check.** No new dependencies for algorithmic suggestions. LLM-powered suggestions require Agent SDK (Proposal 2). The algorithmic version can ship independently.

### Scope

**Medium.** Requires Proposal 1 as foundation. The algorithmic suggestion engine is new logic in the daemon. UI needs a "suggested axes" section in the profile view. If LLM-narrated, the suggestions are part of the Agent SDK prompt.

---

## Proposal 5: Prediction Engine Seeded by Profile

### Evidence

The deferred prediction engine issue (`deferred-prediction-engine.md`) describes similarity-based prediction for unowned games. The fitness-model brainstorm's Approach 3 (Collection Profile + Attribute Similarity) proposed cosine similarity between game attribute vectors and a taste profile centroid (`fitness-model-options.md:207-285`). That approach was not chosen as the fitness model, but the profile concept is directly relevant here.

The `BggGameData` type (`types.ts:33-44`) stores mechanics, categories, families, weight, community rating, and suggested player counts. These fields constitute a feature vector for any BGG game.

### Proposal

The algorithmic profile from Proposal 1 produces a collection centroid in BGG attribute space: the average mechanic distribution, complexity range, player count preference, and category frequency across rated games. This centroid is the "taste vector" that the prediction engine uses to estimate fitness for unowned games.

The prediction works:

1. Represent each rated game as a feature vector: BGG mechanics (binary), categories (binary), weight (continuous), player count range, play time. Weight each dimension by how much variance it explains in the user's fitness scores (a simple correlation).
2. The collection profile is the weighted centroid of these vectors, biased toward higher-rated games.
3. For an unowned game, compute similarity to the centroid. Map similarity to predicted fitness on the 1-10 scale, anchored to the user's actual score distribution (so the prediction lands in the range the user actually uses, not an abstract 1-10).
4. Confidence signal: how many similar games exist in the collection, how tight the cluster is, and which axes have data vs. which are interpolated.

The profile IS the prediction model. No separate training step, no ML pipeline, no external service. The same statistics that describe the collection's identity also power the prediction.

This connects three deferred features in one architecture: collection profiling, prediction engine, and (via axis suggestions from Proposal 4) the collection-awareness that the redundancy scoring stub (`[STUB: redundancy-scoring]`) eventually needs.

### Rationale

The fitness-model brainstorm evaluated and rejected Approach 3 as the primary fitness model because it couldn't handle personal, idiosyncratic axes. But as a prediction layer for unowned games (where personal ratings don't exist by definition), the attribute-similarity approach is ideal. The brainstorm's own verdict: "Prediction is the strongest of any approach, any BGG game can be scored."

The profile-prediction connection means the prediction engine gets better as the collection grows, with no additional user effort. Every new rating sharpens the centroid. Every new axis weight shifts what the centroid emphasizes.

### Vision alignment

1. **Anti-goal check.** Predicted fitness is information, not a purchase recommendation. The anti-goal is "automated purchase decisions"; the prediction explicitly doesn't tell the user to buy anything. It shows what the data looks like through the lens of their preferences.

2. **Principle alignment.** Principle 4 ("data serves judgment") is the direct driver. Principle 2 extends: predicted scores must be as decomposable as rated scores, showing which attributes drove the prediction and at what confidence.

3. **Tension resolution.** Prediction coverage vs prediction honesty: honesty wins (per tension table). The prediction includes confidence signals, and "insufficient data" is a valid output. The minimum viable collection threshold (deferred-prediction-engine.md:25 suggests 20+ games) is enforced: the profile refuses to predict below that threshold.

4. **Constraint check.** No external services. Local computation. The feature vectors come from BGG data already cached in the collection. Requires Proposal 1 as foundation.

### Scope

**Large.** Feature vector representation, centroid computation, similarity scoring, confidence estimation, prediction caching, UI for predicted scores (distinct from rated scores), and the "minimum viable collection" threshold logic. This is the largest single feature in the profiling space.

---

## Proposal 6: Profile Changelog and Drift Detection

### Evidence

The `Collection` type (`types.ts:80-87`) stores `createdAt` and `updatedAt`. Individual games and axes have timestamps. Tournament comparisons have `createdAt` (`types.ts:155`). No code tracks how the collection's aggregate character has changed over time.

The vision's Principle 3 example says "after rating 20 games, the system can surface" preferences. But the profile at 20 games is different from the profile at 50 games. The user's taste may have genuinely shifted, or the early profile may have been an artifact of which games were rated first.

### Proposal

Store periodic profile snapshots (weekly or on significant collection changes, like adding 5+ games or completing 10+ tournament comparisons). The profile view includes a "how your taste has evolved" section:

- "When you had 15 games, your collection was 70% strategy. After adding 10 family games last month, it's now 55% strategy, 30% family."
- "Your complexity sweet spot has drifted from BGG weight 3.0 (January) to 2.5 (April). Your recent additions are consistently lighter."
- "Your tournament preferences have become more consistent with your fitness scores over time. The divergence gap narrowed from 2.1 average to 0.8."

This is meaningful for a curation tool specifically. The user is making deliberate shelf decisions; seeing how those decisions have shifted their collection's identity over months is the long-game version of Principle 3.

Snapshots are stored as JSON in the data directory alongside `collection.json`. Each snapshot is the output of the algorithmic profile (Proposal 1) at a point in time. The changelog is a diff between snapshots.

### Rationale

A static profile describes what the collection is now. A profile with history describes what the user has been building. For a tool whose thesis is intentional curation, the trajectory matters as much as the current state. "Your shelf is getting lighter and more partner-friendly" is information the user can act on, whether to continue the trend or push back against it.

This also provides a natural hook for the LLM narrative (Proposal 2): temporal patterns are rich material for interpretation. "Six months ago you owned zero cooperative games. Now you own five and they're climbing your tournament rankings. Something changed."

### Rationale for small snapshots: the collection is stored as a single JSON file. A profile snapshot is a few KB of aggregate statistics, not a full collection copy. Even weekly snapshots for a year produce under 1MB.

### Vision alignment

1. **Anti-goal check.** Observational, not prescriptive. Describes what happened, not what should happen next. Not social, not a BGG feature.

2. **Principle alignment.** Principle 3 extended over time. Principle 2: drift is computed from the same transparent data as the current profile. Principle 4: the trajectory is data that serves judgment about future curation decisions.

3. **Tension resolution.** No new tensions. The changelog inherits the transparency properties of the underlying profile.

4. **Constraint check.** No external dependencies. Small storage footprint. Requires Proposal 1 as foundation.

### Scope

**Medium.** Snapshot storage, periodic trigger logic, diff computation between snapshots, UI for displaying timeline. The snapshot format is a subset of the profile output. The diff logic is the interesting part.

---

## Anti-Goals for Profiling

The following are things the profiling feature should explicitly not become:

1. **Not a recommendation engine.** The profile describes what the user already owns and values. It does not say "you should buy X." Prediction (Proposal 5) estimates fitness for unowned games, but presenting that as "recommended" crosses into the anti-goal of automated purchase decisions. The distinction matters: "this game would score 7.8 based on your profile" is information. "We recommend this game" is a purchase decision.

2. **Not a social signal.** No sharing, exporting for social media, or "what kind of gamer are you?" quiz-style outputs. The profile serves the owner, not an audience.

3. **Not a replacement for axis ratings.** The profile observes patterns in existing ratings. It doesn't generate ratings, fill in missing ratings, or override the user's input. If the profile suggests an axis (Proposal 4), the user still creates it and rates games on it manually.

4. **Not always-on LLM inference.** The LLM narration (Proposal 2) is an on-demand feature, not a background process. The algorithmic profile (Proposal 1) updates deterministically when data changes. The LLM narrative is regenerated when the user requests it. No ambient LLM calls, no background token consumption.

5. **Not a prescriptive curation coach.** "You should cull your party games" is not the system's job. "Your party games consistently score below 4 on your axes and rank in the bottom third of your tournament" is. The user decides what to do with that information.

---

## Implementation Sequence

The proposals have a natural dependency chain:

1. **Proposal 1 (Algorithmic Profile)** is the foundation. Everything else reads from it.
2. **Proposal 3 (Tournament/Fitness Divergence)** is small and depends only on existing data. Can ship alongside Proposal 1.
3. **Proposal 4 (Axis Suggestions)** requires Proposal 1's distribution data. Can ship in the same release or immediately after.
4. **Proposal 6 (Profile Changelog)** requires Proposal 1's output format to be stable before snapshotting. Ship after Proposal 1 has been in use briefly.
5. **Proposal 2 (LLM Narration via Agent SDK)** is an enhancement layer over Proposal 1. Ship when the algorithmic profile proves its value and the Agent SDK integration is justified.
6. **Proposal 5 (Prediction Engine)** is the largest feature. Depends on Proposal 1's centroid computation. Can be developed in parallel with Proposals 2-4 but should ship after the profile is validated.

The minimum viable profiling feature is Proposal 1 + Proposal 3. That gives the user a deterministic, transparent collection identity with the most interesting insight (stated vs. revealed preference divergence) included from the start.

---

## Open Questions

1. **Where does the profile live in the UI?** A dedicated "Profile" page? A section on the collection page? A separate view accessible from the nav? The profile is a different mode of looking at the collection (aggregate vs. per-game), which suggests a separate page. But it should be reachable from the collection page, since that's where the user encounters their games.

2. **CLI presentation.** A `shelf-judge profile` command is natural. How much statistical detail goes in the terminal output vs. being web-only? The CLI should show the highlights; the web UI can show the full distribution visualizations.

3. **Minimum collection size.** Below what threshold is the profile not meaningful? The prediction engine issue suggests 20 games. The algorithmic profile might produce useful observations with fewer (even 10 games show mechanic concentrations). Define a progressive disclosure: show what's meaningful at each collection size, not an arbitrary "unlock at N games" gate.

4. **Profile regeneration trigger.** Every data change? On demand only? A hybrid (dirty flag that triggers recalculation on next view)? The profile should feel current without requiring explicit refresh, but computing distributions over the full collection on every page load is wasteful even for small collections.

5. **Agent SDK authentication.** The SDK research (`claude-agent-sdk.md:192-195`) documents authentication via `ANTHROPIC_API_KEY` or cloud provider credentials. How does Shelf Judge store and manage the API key? This is a new secret management concern for a previously local-only tool.
