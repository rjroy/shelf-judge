---
title: Fitness-ranked Profile attention discovery
date: 2026-09-20
status: approved
tags: [collection, profile, attention, ranking, rules]
modules: [shared, daemon, web]
related:
  - .lore/reference/specs/current/useful-collection-profile.md
  - .lore/reference/specs/current/collection-purchase-utilization.md
  - .lore/work/specs/expanded-profile-attention-opportunities.md
req-prefix: RANKED-ATTN
---

# Fitness-ranked Profile Attention Discovery

## Goal

The Profile question **“What deserves my attention or a decision now?”** should
surface a small number of meaningful situations the owner may not already
recognize. It should not be limited to repeating decisions the owner has already
made, such as marking a game **Want to play**.

The system evaluates a built-in catalog of attention rules, chooses at most one
reason per game, ranks the resulting cards by attention score, and shows only the
configured number of cards. The default is six cards, which forms two rows of
three at the default desktop layout.

The cards inform owner judgment. They do not declare that a game is bad, demand
that it be played, or automatically decide whether it should remain in the
collection.

## Examples

### A game that has never been played

The current play evidence validly reports zero plays. A card may say:

> You have not recorded a play of Heat: Pedal to the Metal.

It can then ask whether the owner wants to make a plan to play it, intentionally
keep it without a plan, or reconsider it.

### A game that has gone dormant

The game has recorded plays, but its trustworthy latest play was fourteen months
ago. A card may say:

> You have not played Cascadia since July 2025.

It can ask whether the game still fits how the owner wants to use the collection.

### An underused purchase outranks an intention

One game has an active **Want to play** intention with score `0.7`. Another has
reached only 10% of its purchase-value target, producing an underused-purchase
score of `0.9`. If both cannot fit, the underused purchase appears first. An
explicit intention is eligible, not guaranteed a slot.

## Attention Model

### Rules

The first release uses a built-in rule catalog. Adding a built-in rule should
require registering one rule definition, not adding special-case dispatch logic
through every consumer. Owners cannot author formulas or message templates in
the first release.

Each rule defines:

- a stable rule ID;
- the conditions under which it applies;
- a plain-language reason template;
- a normalized signal strength from `0` through `1`;
- a category weight from `0` through `1`;
- semantic supersession of redundant rules;
- the game, collection, settings, and clock inputs it depends on;
- when those inputs require reevaluation;
- the decisions and actions the card offers.

**Attention score is not game fitness.** Game fitness describes how well a game
fits the owner's preferences. Attention score describes how strongly one current
situation deserves a limited Profile slot.

For every applicable rule:

```text
attention score = signal strength × category weight
```

All arithmetic is deterministic. Scores outside `[0, 1]` are invalid rather than
silently accepted.

### One card per game

Selection happens in this order:

1. Evaluate applicable rules for the game.
2. Apply any active game-level disposition. If one applies, the game produces no
   card and no other rule may replace the deferred reason.
3. Remove rules superseded by a more specific applicable rule.
4. Choose the remaining rule with the greatest attention score.
5. Break an exact rule-score tie by stable rule ID.
6. Produce one card using the winning rule's reason, question, and actions.

Losing rule matches may remain in daemon diagnostics, but the owner-facing card
presents one primary reason. They never create additional cards for that game.

### Collection ranking

Game winners are sorted by:

1. attention score, descending;
2. NFC-normalized game name, ascending;
3. stable game ID, ascending;
4. stable rule ID, ascending.

The final three keys are deterministic tie-breakers, not additional priority
signals. The configured cap is applied after sorting.

## Initial Rule Catalog

The constants below are first-release product defaults. They are versioned rule
behavior, not owner-editable settings in this release.

### Never played

- **Rule ID:** `never-played`
- **Category weight:** `0.6`
- **Applies when:** the game is currently owned and current Profile play-count
  evidence is valid and exactly zero.
- **Signal strength:** binary `1`.
- **Attention score:** `0.6`.
- **Reason:** `You have not recorded a play of <game.name>.`
- **Decision:** `Do you want to make a plan to play it, intentionally keep it
  without a plan, or reconsider it?`
- **Actions:** Want to play, Not now, This is intentional, open the game, and
  correct play data.
- **Dependencies:** ownership, current play-count evidence, and the latest
  play-count check that determines whether retained evidence is current.
- **Reevaluation:** whenever one of those dependencies or the rule version
  changes. It has no clock boundary.

Missing, invalid, or stale evidence does not imply zero and must not qualify.
Never played and dormant are mutually exclusive because dormant requires prior
play. Neither supersedes the other in the initial catalog.

### Dormant

- **Rule ID:** `dormant`
- **Category weight:** `0.8`.
- **Applies when:** the game is currently owned, has at least one recorded play,
  has a trustworthy dated latest play, and at least 180 whole UTC days have
  elapsed since that play.
- **Signal strength:**

  ```text
  dormant periods / (dormant periods + 6)
  dormant periods = floor(elapsed UTC days / 30)
  ```

- **Reason:** `You have not played <game.name> since <localized last-play date>.`
- **Decision:** `Does this game still fit how you want to use your collection?`
- **Actions:** Want to play, Not now, This is intentional, open the game, and
  correct play data.
- **Dependencies:** ownership, accepted dated play sessions, current play-count
  evidence, latest-play date, and the rule version.
- **Reevaluation:** when a dependency changes or at the next UTC midnight on
  which another whole 30-day dormant period is reached.

Elapsed days are the difference between the stored play date and the controlled
UTC evaluation date, both treated as date-only values. The play date itself is
day zero. At 180 days there are six periods, signal strength is `0.5`, and the
attention score is `0.4`. Future-dated play records do not qualify. This avoids
month-end and leap-day ambiguity while preserving a transparent month-like
curve. The curve approaches, but never exceeds, `1`.

An aggregate lifetime count without trustworthy dated play history is not enough
to establish dormancy.

### Underused purchase

- **Rule ID:** `underused-purchase`
- **Category weight:** `1.0`.
- **Applies when:** the game is currently owned and the existing purchase
  utilization calculation returns `not-met` with a calculated value multiplier
  whose exact rational numerator and denominator are valid and consistent with
  that outcome.
- **Signal strength:**

  ```text
  (denominator - numerator) / denominator
  ```

- **Reason:** `<game.name> has reached <percentage> of its purchase-value target.`
- **Decision:** `Do you want to play it more, intentionally keep it as-is, or
  reconsider owning it?`
- **Actions:** Want to play, Not now, This is intentional, open the game, and
  correct purchase or utilization inputs.
- **Dependencies:** the complete dependency contract and calculation version of
  the existing purchase-utilization result, including acquisition, play evidence,
  duration, modeled player count, displayed game fitness inputs, and the
  collection entertainment benchmark.
- **Reevaluation:** whenever any purchase-utilization dependency, relevant global
  benchmark, calculation version, or this rule's version changes. It has no
  independent clock boundary.

The existing utilization target is met at multiplier `1`. A multiplier of `0.1`
therefore produces strength and score `0.9`; a multiplier of `0.8` produces
`0.2`. A met, unavailable, not-applicable, malformed, or non-finite result does
not qualify.

Scoring and ordering use exact rational comparison. An implementation may expose
a normalized decimal score only if serialization preserves deterministic order.
The reason percentage is display-only, rounded to the nearest whole percentage
with half values rounded away from zero. Display rounding never feeds back into
score calculation or ordering.

This rule reuses the existing purchase-utilization calculation and its evidence.
It does not infer an acquisition date, estimate time owned, or create a second
value formula.

### Explicit intention

- **Rule ID:** `explicit-intention`
- **Category weight:** `0.7`.
- **Applies when:** the game is currently owned and has an active unresolved play
  intention.
- **Signal strength:** binary `1`.
- **Attention score:** `0.7`.
- **Reason:** `You marked <game.name> as Want to play.` for current
  `want-to-play` intentions, with equivalent truthful wording for retained
  historical intention kinds.
- **Decision:** `Do you still want to make this happen?`
- **Actions:** resolve or retire the intention, Not now, This is intentional,
  open the game, and use existing intention actions.
- **Dependencies:** ownership, active intention identity, kind, creation state,
  resolution, and the rule version.
- **Reevaluation:** whenever one of those dependencies or the rule version
  changes. It has no clock boundary.

The intention follows existing creation, completion, retirement, and history
semantics. It competes with discovered rules and is not guaranteed to appear.

## Cards, Decisions, and Turnover

Every card shows:

- the game;
- the winning rule's reason;
- the decision being asked;
- the attention score or an understandable score explanation;
- relevant existing evidence or correction destinations;
- actions appropriate to that rule.

The exact decision text may differ by rule, but it must permit more than one
reasonable owner response. Cards may reuse existing actions such as **Want to
play**, resolve or retire an intention, correct source data, or open the game.

Every discovered rule also supports:

- **Not now:** hide the whole game from attention for exactly `30 × 24` hours
  from the recorded response instant, unless the game leaves current ownership,
  which clears the disposition early.
- **This is intentional:** hide the whole game until the winning rule's declared
  non-clock input fingerprint changes.

Viewing a card does not alter its score, dismiss it, or count as a response.
There is no automatic exposure decay.

Snooze and intentional dispositions are local durable records keyed by owner and
game while retaining the winning stable rule ID. A disposition stores only the
minimum identity, expiration, rule version, and input-fingerprint data needed to
apply it. It does not store free text, send data to a provider, or modify the
underlying game, evidence, intention, purchase, or play history.

An active disposition is applied before supersession and winner selection, so no
other reason for that game immediately replaces the deferred card. A snooze
ignores dependency and rule-version changes until its exact expiry. An intentional
disposition remains active while the winning rule's current non-clock fingerprint
and rule version equal the stored values. On the first observed mismatch, the
disposition is permanently cleared before reevaluation; returning inputs to their
old values does not restore it. Losing ownership clears either disposition, so
reacquiring the game begins with no inherited deferral.

Clearing a disposition after ownership loss, dependency mismatch, or rule-version
mismatch is a narrowly defined derived maintenance write. It occurs atomically
with the source update or candidate-maintenance transaction that observes the
change, never as an incidental Profile-render side effect.

## Card Limit and Layout

The owner setting `profileAttentionCardLimit` accepts whole numbers from `0`
through `24` and defaults to `6`.

- `0` disables attention cards and shows no attention-rule results.
- A positive value limits the number of globally ranked cards returned.
- The default desktop presentation uses three columns, yielding two rows at the
  default limit.
- Narrower layouts may reflow the same cards without changing order or count.

The setting controls presentation output, not rule weights or formulas.

## Performance and Freshness

Profile cache hits may perform the existing bounded work needed to establish and
validate Profile source identity, but they must not iterate the collection to
evaluate attention rules or rebuild attention candidates.

Rule definitions declare their dependencies. When a game-local dependency
changes, the daemon must reevaluate only that game's rules and update the
candidate projection. Collection-wide settings, utilization benchmarks, rule
versions, or other genuinely global dependencies may trigger a full rebuild. A
full rebuild is also an allowed recovery path for missing, corrupt, or incompatible
disposable candidate state, but not the normal response to a declared local
change.

Time-based rules use a controlled UTC day and a recorded next-evaluation boundary.
Crossing that boundary invalidates the relevant candidate projection once; merely
refreshing the Profile page repeatedly on the same day does not.

Candidate projection and Profile publication remain daemon-owned, validated, and
atomic under the existing Profile snapshot and concurrency boundary. A Profile
read does not mutate collection source data. Durable snooze or intentional
responses are explicit write operations, not read-side effects.

## Special Cases and Scope

- Previously owned and unowned games do not qualify.
- Missing evidence causes the affected rule to abstain, not to invent a value.
- Malformed or version-mismatched disposable cache or candidate state is discarded
  and recomputed atomically. The existing unavailable and retry behavior is used
  only when validation, recomputation, or safe persistence cannot complete.
- Successful evaluation with no eligible unsuppressed candidates keeps the
  existing successful-empty behavior.
- The browser renders daemon-selected cards and relays actions. It does not score,
  rank, supersede, or select candidates.
- Rule weights and formulas are built-in constants in the first release. Only the
  visible card limit is an owner setting.
- This feature does not add user-authored expressions, plugins, free-text
  feedback, reminders, notifications, an AI provider, or an accepted-source
  provenance and conflict system.

## Authority and Supersession

When approved, this specification supersedes the attention-selection scope of
`.lore/work/specs/expanded-profile-attention-opportunities.md`. It also amends the
current Profile authority where that authority limits attention to explicit
intentions, requires alphabetical attention ordering, has no cap or rule setting,
or prohibits purchase utilization from producing an attention candidate.

It specifically replaces the requirements that every active intention be
visible, that attention cards correspond one-to-one with active intentions, and
that card identity and runtime validation always derive from an intention.
Active intentions and their history remain durable lifecycle authority, but each
active intention is now one competitive attention candidate and may fall below
the visible cap. Discovered cards use stable game-and-rule identity; intention
cards additionally retain their intention association.

Existing intention lifecycle, ownership, evidence correction, strict validation,
successful-empty versus unavailable behavior, Profile snapshot consistency, and
no-read-side-source-mutation rules remain in force unless this specification
explicitly changes them.

## Requirements

1. **REQ-RANKED-ATTN-1:** Profile attention must discover eligible situations from a built-in rule catalog rather than requiring an explicit owner intention for every card.
2. **REQ-RANKED-ATTN-2:** Only currently owned games may produce attention candidates.
3. **REQ-RANKED-ATTN-3:** Every rule must define a stable ID, applicability, reason, normalized signal strength, category weight, supersession metadata, declared dependencies, reevaluation behavior, and owner actions.
4. **REQ-RANKED-ATTN-4:** A rule's attention score must equal its `[0,1]` signal strength multiplied by its `[0,1]` category weight; attention score must remain distinct from existing game fitness.
5. **REQ-RANKED-ATTN-5:** For each game, the daemon must apply semantic supersession and then select the highest-scoring remaining applicable rule, producing at most one card for that game.
6. **REQ-RANKED-ATTN-6:** The daemon must globally sort game winners by descending attention score, then NFC-normalized game name, stable game ID, and stable rule ID.
7. **REQ-RANKED-ATTN-7:** The card limit setting must accept whole numbers from `0` through `24`, default to `6`, and apply after global ranking; `0` must disable attention cards.
8. **REQ-RANKED-ATTN-8:** The first release must include the exact never-played, dormant, underused-purchase, and explicit-intention rules and defaults defined in this specification.
9. **REQ-RANKED-ATTN-9:** The never-played rule must require valid current exact-zero evidence; missing, stale, or invalid evidence must not imply zero.
10. **REQ-RANKED-ATTN-10:** The dormant rule must require prior play and trustworthy dated history, begin at 180 elapsed UTC days, and use the specified whole-30-day-period curve and boundary behavior.
11. **REQ-RANKED-ATTN-11:** The underused-purchase rule must use the existing finite purchase-utilization value multiplier and specified shortfall formula, abstaining for every other utilization outcome.
12. **REQ-RANKED-ATTN-12:** The explicit-intention rule must preserve existing intention lifecycle semantics while competing normally for a capped slot.
13. **REQ-RANKED-ATTN-13:** Every card must explain why it surfaced, ask an owner decision with multiple reasonable responses, and expose relevant actions or correction destinations.
14. **REQ-RANKED-ATTN-14:** Viewing a card must not mutate state or reduce score; turnover must result from an explicit response or a declared source dependency change.
15. **REQ-RANKED-ATTN-15:** Not now must hide the whole game for exactly 30 times 24 hours, during which no other rule may replace the deferred reason; leaving current ownership clears the disposition early.
16. **REQ-RANKED-ATTN-16:** This is intentional must hide the whole game while the winning rule's stored version and non-clock input fingerprint remain unchanged, then clear permanently on the first observed mismatch.
17. **REQ-RANKED-ATTN-17:** Attention dispositions must remain local, minimal, durable, owner-scoped, and separate from game evidence, intentions, purchase data, and play history.
18. **REQ-RANKED-ATTN-18:** Cache-hit Profile reads must not iterate games to evaluate attention rules; declared local dependency changes must reevaluate only affected games, while declared global changes and recovery from unusable disposable state may rebuild all candidates.
19. **REQ-RANKED-ATTN-19:** Time-based reevaluation must use a controlled UTC boundary so repeated same-day Profile reads do not repeatedly evaluate the collection.
20. **REQ-RANKED-ATTN-20:** Candidate updates and Profile publication must be daemon-owned, validated, atomic, and free of client-side scoring or read-side collection mutation.
21. **REQ-RANKED-ATTN-21:** The attention response must distinguish successful empty results from unavailable or invalid computation.
22. **REQ-RANKED-ATTN-22:** The default desktop layout must render up to six cards as three columns by two rows, while responsive reflow preserves daemon order and the configured cap.
23. **REQ-RANKED-ATTN-23:** Adding a future built-in rule must not require changing closed scoring and selection dispatch logic in unrelated consumers.
24. **REQ-RANKED-ATTN-24:** The first release must not add runtime-authored rules, free-text feedback, exposure decay, notifications, provider/AI behavior, or accepted-source conflict machinery.

## AI Validation

1. Build fixtures for each initial rule at, below, and above every applicability threshold. Independently reproduce signal strength, category weight, attention score, reason, and abstention behavior.
2. Fixture multiple applicable initial rules on one game and verify the greatest remaining score wins and only one card is emitted. Separately inject two valid overlapping test rules with a supersession edge and verify the superseded rule cannot win.
3. Fixture more eligible games than the configured cap. Verify exact descending scores, deterministic ties, one card per game, limits `0`, `1`, `6`, and `24`, and responsive rendering that preserves order.
4. Verify an explicit intention can lose a visible slot to a stronger underused-purchase or dormant candidate without altering the intention.
5. Exercise Not now with a controlled clock. Verify the entire game remains absent for exactly 30 times 24 hours despite dependency changes other than ownership loss, no alternate rule replaces it, ownership loss clears the disposition early, and the game is reevaluated at ordinary expiry.
6. Exercise This is intentional. Verify the entire game remains absent while the stored fingerprint and rule version match; clock passage and unrelated inputs do not reopen it; the first declared dependency or rule-version mismatch clears it permanently; ownership loss clears it; and input reversion does not restore the disposition.
7. Verify missing, stale, invalid, unavailable, not-applicable, malformed, and non-finite evidence makes only the dependent rule abstain or causes the documented unavailable state.
8. Compare incremental candidate updates with a full pure recomputation oracle after play, ownership, purchase, intention, settings, and clock changes.
9. Instrument cache-hit Profile reads to prove they perform no collection iteration for attention-rule evaluation or candidate rebuilding, while permitting the existing bounded source-identity validation. Verify a local mutation does not reevaluate unrelated games and a declared global change safely rebuilds the projection.
10. Corrupt and version-mismatch candidate/cache state. Verify safe discard and atomic recomputation without publishing partial results.
11. Verify Profile reads do not change collection revision, evidence, intentions, ownership, purchase data, play history, or dispositions. Verify disposition creation occurs only through explicit actions and that dependency-driven clearing occurs only in the atomic source-update or candidate-maintenance transaction defined above.
12. Verify the browser performs no scoring, ranking, supersession, or fallback inference and distinguishes populated, successful-empty, loading, and unavailable states.

## Technical Contract

The implementation may choose the storage shape, but the shared runtime contract
must expose enough information to validate each selected card's stable game ID,
rule ID, reason, decision, score, category weight, signal strength, actions,
dependency version, and disposition state. Internal candidate caches are
disposable; owner responses are durable local state.

Rule and scoring versions must participate in cache identity. The card-limit
setting, relevant global benchmarks, controlled time boundary, and all declared
rule dependencies must either participate in cache identity or cause a targeted
candidate update before publication.
