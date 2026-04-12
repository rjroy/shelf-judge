---
title: "Collection Identity and Taste Profiling"
date: 2026-04-09
status: resolved
tags: [brainstorm, profiling, collection, llm, agent-sdk]
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

## Direction

The home page currently shows the collection list. Profiling replaces this with a **Profile Overview** page: a collection of statistics about the user's taste, with an LLM narration summary at the top. The collection list moves to its own page (or becomes a section/tab accessible from the profile).

The profile dataset is generated and stored persistently, the same pattern used for tournament data. It recomputes when underlying data changes (new ratings, new games, axis changes) but does not regenerate on every page view. The LLM narration is cached alongside the profile and only regenerated when the profile data itself has changed.

The profile page is the primary surface for several distinct insights, each described in its own proposal below. The UX provides ways to explore and interact with the profile summary, not just read it passively.

**Proposals included in this direction:**

- **Proposal 1** (Algorithmic Profile): the stored dataset, foundation for everything else
- **Proposal 2** (LLM Narration): cached natural-language summary at the top of the page
- **Proposal 3** (Tournament/Fitness Divergence): section surfacing stated vs. revealed preference gaps
- **Proposal 4** (Axis Suggestions): actionable suggestions for new scoring dimensions
- **Proposal 5** (Collection Outlier Detection): games that don't fit the collection's statistical identity

**Parked:**

- **Prediction Engine** (originally Proposal 5): estimating fitness for unowned games based on the profile centroid. Valuable but separate from the profile feature itself. Deferred to `.lore/issues/deferred-prediction-engine.md`.
- **Profile Drift Detection** (originally Proposal 6): tracking how the profile changes over time via periodic snapshots. Rejected for now. Taste drift happens over years, not months, and the snapshot-and-diff model assumes frequent enough change to produce interesting diffs. For a collector who adds a few games a year, most snapshots would be identical. The interesting temporal question ("what changed?") is better answered by the outlier detection in Proposal 5 than by a changelog.

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

Build a deterministic profiling service in the daemon that computes collection-level statistics from existing data. No LLM. No external API calls. Pure aggregation over the data the user has already entered. The profile is persisted as a stored dataset (like tournament data), recomputed when underlying data changes.

The profile computes:

1. **Axis rating distributions.** For each axis, calculate mean, median, standard deviation, and range across all rated games. Surface the shape: "Your 'Wife will play it' ratings cluster between 6-9 (mean 7.4, std 1.1). Your 'Visual design' ratings spread across the full range (mean 5.8, std 2.9)." The tight cluster says "you don't own games your wife won't play." The wide spread says "visual design varies a lot in your collection, and you're fine with that."

2. **Axis weight interpretation.** The user's axis weights already declare relative importance. The profile narrates this: "Playability with your partner dominates your scoring at 40% weight. Visual design and complexity matter equally at 20% each." This is the preference the user chose but may not have articulated in words.

3. **BGG attribute clustering.** Group the collection by BGG mechanics, categories, subdomains, and weight ranges. Surface concentrations: "67% of your collection includes hand management. Your complexity sweet spot is BGG weight 2.0-3.0 (18 of 27 games). You own zero games in the 'Wargames' subdomain."

4. **Utility curve declarations.** When utility curves are configured, the profile includes them as explicit preference statements: "You've declared a complexity sweet spot at BGG weight 2.75 with moderate tolerance. You've vetoed any game your wife rates below 4."

The profile is a read-only computation. It doesn't alter scores, ratings, or any stored data.

### Rationale

This is the minimum viable profile. Everything it computes is derivable from data the user already entered through the normal workflow. No new input burden. No API costs. No non-determinism. The profile is as transparent as the fitness score itself: every statement traces back to specific ratings, weights, and BGG data.

The insight it surfaces is genuinely useful: most users have never computed the standard deviation of their "Wife will play it" ratings, but that number tells them something real about what they tolerate on their shelf.

### Vision alignment

1. **Anti-goal check.** Does this create automated purchase decisions? No. The profile describes what the user already owns and how they've rated it. It doesn't recommend acquisitions. Does this create social/competitive features? No. Single-user, local-only. Does this replace BGG? No. It reads BGG data but produces a personal profile, not a game database.

2. **Principle alignment.** Principle 3 ("your collection has an identity") is the direct driver. The vision's example: "You favor low-interaction, medium-weight games with strong visual design. Party games score consistently low on your axes." This proposal produces exactly that kind of statement. Principle 2 ("one number, honestly derived") extends: the profile is honestly derived from the same transparent data the fitness score uses. Principle 1 ("ownership is personal") is respected: the profile reflects the user's axes, not a universal rating system.

3. **Tension resolution.** Personal axes vs BGG data accuracy: the profile uses both but distinguishes them (axis ratings are personal, mechanic clusters are BGG-derived). Fitness precision vs transparency: the profile is fully transparent, every statistic traces to source data. Prediction honesty: the profile makes no predictions, only observations.

4. **Constraint check.** No new dependencies. No external services. The daemon already has all the data. The computation is local math plus aggregation.

### Scope

**Medium.** New daemon service, new API endpoints, new UI page (Profile Overview replaces home), and CLI command. The math is straightforward. The interesting work is deciding which statistics are worth surfacing and how to present them without overwhelming the user.

---

## Proposal 2: LLM-Narrated Profile via Claude Agent SDK

### Evidence

The deferred issue (`deferred-collection-profiling.md:31-32`) includes user notes: "What if this was LLM driven?" and "use Claude Agent SDK to gain the benefits of using the subscription." The Agent SDK research (`.lore/research/claude-agent-sdk.md`) documents the TypeScript SDK with structured outputs, in-process MCP servers, session management, and budget controls. The deferred LLM integration issue (`deferred-llm-integration.md:19`) describes "natural language score explanation" as a deferred feature category.

The existing fitness breakdown (`FitnessResult` in `types.ts:107-121`) already provides the structured data an LLM would narrate from: score, axis contributions, veto status, and hypothetical scores.

### Proposal

Use the Claude Agent SDK (TypeScript) to create an LLM-powered profile narrator. The daemon exposes a new endpoint that:

1. Computes the algorithmic profile from Proposal 1 (distributions, clusters, outliers).
2. Passes the structured profile data to a Claude agent via the Agent SDK.
3. The agent produces a natural-language narrative that interprets the statistics in the context of the user's collection.
4. The narrative is cached alongside the profile data. It regenerates only when the underlying profile data changes, not on every page view.

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

The caching model keeps costs predictable: the narrative regenerates when profile data changes, not on every page view. For a collector who adds a few games a month and tweaks ratings occasionally, this means a handful of LLM calls per month at most.

### Vision alignment

1. **Anti-goal check.** Automated purchase decisions? No. The narrative describes the existing collection, not what to buy next. Social/competitive? No. BGG replacement? No.

2. **Principle alignment.** Principle 3 is the direct driver. Principle 2 ("one number, honestly derived") is preserved: the fitness score is still deterministic. The narrative sits alongside the score, not inside it. Principle 4 ("data serves judgment") applies: the LLM is serving the user's judgment by making their data more legible, not replacing their judgment with its own.

3. **Tension resolution.** Prediction honesty: the narrative makes observations, not predictions. If it speculates ("you might enjoy cooperative games"), it's clearly framed as interpretation, not a score. Fitness precision vs transparency: the underlying profile data is fully transparent; the narrative is an additional layer, not a replacement.

4. **Constraint check.** New dependency: Claude Agent SDK (TypeScript). This is an external service dependency, but it's the user's own subscription. Network required for LLM calls. The algorithmic profile (Proposal 1) must work standalone without the LLM; the narrative is an enhancement, not a requirement. Cost scales per profile regeneration, not per page load.

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

After the algorithmic profile (Proposal 1) identifies the user's collection characteristics, suggest new axes the user might not have thought to create. Three sources of suggestions:

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

## Proposal 5: Collection Outlier Detection

### Evidence

The algorithmic profile (Proposal 1) computes what's typical for the collection: mechanic distributions, complexity ranges, category concentrations. Any game that falls far outside these norms is an outlier, a game that doesn't look like the rest of the shelf.

This is distinct from Proposal 3 (tournament/fitness divergence). Proposal 3 asks "where do your two scoring systems disagree about a game?" Outlier detection asks "which games don't fit who you are?" A game could score fine on both fitness and tournament and still be the lone heavy wargame in a collection of medium-weight euros.

The BGG data needed for this analysis is already stored per game: mechanics, categories, weight, player count, play time. The profile from Proposal 1 provides the baseline to compare against.

### Proposal

Use the collection's statistical profile as a baseline to identify games that sit outside the collection's identity. An outlier is a game whose BGG attributes place it far from the collection's center of gravity across multiple dimensions.

Outlier detection computes:

1. **Attribute distance.** For each game, measure how far its mechanics, categories, complexity, and play time deviate from the collection's typical values. A game that's unusual on one dimension isn't necessarily an outlier (you might own one 4-hour game among mostly 1-hour games). A game that's unusual on several dimensions is genuinely different from everything else on the shelf.

2. **Outlier classification.** Not all outliers mean the same thing:
   - **Lone wolves:** games with no close neighbors in the collection. "Twilight Imperium shares zero mechanics with any other game you own and sits 2 points above your complexity sweet spot."
   - **Category orphans:** games in BGG categories or subdomains that appear nowhere else in the collection. "This is your only wargame."
   - **High-fitness outliers:** games the axes love but the profile says shouldn't belong. These are interesting because the user's explicit ratings say "keep it" even though the collection's identity says "this doesn't fit." That's a deliberate choice worth naming.

3. **Outlier as signal, not judgment.** The profile surfaces outliers without recommending action. "This game doesn't look like the rest of your collection" is an observation. The user decides whether that means "maybe I should sell it" or "I love this game precisely because it's different."

For the LLM narrative (Proposal 2), outliers are rich material: "Your shelf has a clear identity: medium-weight, hand-management-heavy euros. Three games break that pattern: Twilight Imperium, Codenames, and Gloomhaven. Each is an outlier for different reasons."

### Rationale

The original Proposal 6 (drift detection over time) was rejected because taste drift happens over years, not months, and the snapshot model would produce identical snapshots for long stretches. But the question underlying it, "what doesn't fit?", is still valuable. Outlier detection answers it without needing temporal data. It works on the collection as it exists right now.

For a curation tool, knowing which games sit outside your collection's identity is directly useful. It might confirm a suspicion ("I always felt like that game didn't belong"), or it might surface something unexpected ("I didn't realize this was my only cooperative game").

### Vision alignment

1. **Anti-goal check.** Not a purchase recommendation. Not social. Not prescriptive ("you should sell these outliers"). The system names what's different; the user decides what it means.

2. **Principle alignment.** Principle 3 ("your collection has an identity"): outliers are the negative space that defines the identity. Knowing what doesn't fit sharpens understanding of what does. Principle 4: data serves judgment. The outlier list is information, not a cull recommendation.

3. **Tension resolution.** The interesting tension: does an outlier indicate a bad purchase or a valued exception? The system doesn't resolve this. It names the game as unusual and lets the user decide. Consistent with "data serves judgment, doesn't replace it."

4. **Constraint check.** No new dependencies. Computation is local. Requires Proposal 1's profile data as the baseline.

### Scope

**Medium.** Requires Proposal 1 as foundation. New computation (multi-dimensional distance from collection centroid), new section in profile output, new UI elements. The interesting design work is choosing the right distance metric and deciding what threshold constitutes "outlier" without being too noisy.

---

## Anti-Goals for Profiling

The following are things the profiling feature should explicitly not become:

1. **Not a recommendation engine.** The profile describes what the user already owns and values. It does not say "you should buy X." The prediction engine (parked) would estimate fitness for unowned games, but even that presents information, not recommendations.

2. **Not a social signal.** No sharing, exporting for social media, or "what kind of gamer are you?" quiz-style outputs. The profile serves the owner, not an audience.

3. **Not a replacement for axis ratings.** The profile observes patterns in existing ratings. It doesn't generate ratings, fill in missing ratings, or override the user's input. If the profile suggests an axis (Proposal 4), the user still creates it and rates games on it manually.

4. **Not always-on LLM inference.** The LLM narration (Proposal 2) regenerates when the profile data changes, not on every page view. No ambient LLM calls, no background token consumption. The algorithmic profile (Proposal 1) is the primary dataset; the narrative is a cached enhancement.

5. **Not a prescriptive curation coach.** "You should cull your party games" is not the system's job. "Your party games consistently score below 4 on your axes and rank in the bottom third of your tournament" is. The user decides what to do with that information.

---

## Implementation Sequence

The proposals have a natural dependency chain:

1. **Proposal 1 (Algorithmic Profile)** is the foundation. Everything else reads from it. Includes the Profile Overview page replacing home.
2. **Proposal 3 (Tournament/Fitness Divergence)** is small and depends only on existing data. Ships alongside Proposal 1 as a section on the profile page.
3. **Proposal 5 (Collection Outlier Detection)** requires Proposal 1's profile data as a baseline. Can ship alongside or immediately after Proposals 1+3.
4. **Proposal 4 (Axis Suggestions)** requires Proposal 1's distribution data and benefits from Proposal 3's divergence data. Ships after the profile page is established.
5. **Proposal 2 (LLM Narration via Agent SDK)** is an enhancement layer over all of the above. Ships when the algorithmic profile, divergence, and outlier data prove their value and provide rich material for the narrative. The cached narration sits at the top of the Profile Overview page.

The minimum viable profiling feature is **Proposals 1 + 3**: a deterministic, transparent collection identity with the most interesting insight (stated vs. revealed preference divergence) included from the start. Proposal 5 (outlier detection) is a strong candidate for the same release since it reads from the same data Proposal 1 already computes.

---

## Resolved Questions

1. **Profile Overview as home page.** The profile replaces the current home page. The collection list moves to a separate "Collection" page in the nav. Different interaction modes (aggregate understanding vs. per-game browsing) belong on different pages.

2. **CLI presentation.** The CLI is a programmatic interface for LLM/agent access, not a human-facing summary. The `shelf-judge profile` command returns the full profile as structured JSON. The web UI handles all human-facing presentation and visualization.

3. **Minimum collection size.** No minimum gate. The profile computes everything from whatever data exists. At 200 games (current dataset size), every analysis is meaningful. No progressive disclosure needed.

4. **Profile regeneration trigger.** Dirty flag model. Any write to collection data (ratings, games, axes, tournament results, BGG refreshes) sets the flag. Profile recomputes lazily on next view.

5. **LLM narration cache invalidation.** Three states: **current** (show narration), **stale** (show old narration with indicator and "regenerate" button), **empty** (no narration generated yet, prompt to generate or show nothing if no API key). Stale narration is better than nothing. Regeneration is always user-initiated, never automatic.

6. **Agent SDK authentication.** Not the app's concern. The daemon uses the Claude Agent SDK; the SDK handles its own authentication. Shelf Judge does not store, configure, or manage API keys. If the SDK can't authenticate, the narration is unavailable (empty state).

7. **Outlier threshold tuning.** Default to 2 standard deviations from the collection centroid. Validate against the 200-game collection during implementation; adjust if it flags too many or too few.
