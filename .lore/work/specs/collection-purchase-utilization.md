---
title: Collection purchase utilization insight
date: 2026-08-25
status: draft
tags: [collection, insights, acquisition-cost, play-count, utilization]
modules: [shared, daemon, web, cli]
related:
  [
    .lore/vision.md,
    .lore/specs/collection/collection-profiling.md,
    .lore/work/specs/derived-bgg-axes.md,
    .lore/issues/bgg/deferred-bgg-user-auth.md,
  ]
req-prefix: UTIL
---

# Collection Purchase Utilization Insight

## Purpose

Help the collection owner answer: **How much recorded use does this game record show relative to my lifetime out-of-pocket cost for it?**

This is a factual utilization lens, not a verdict on whether a purchase was worthwhile. The feature may identify well-used and little-used purchases, but it must not call a game a good value, a bad purchase, paid off, or worth selling.

## Decision

Proceed only with the data and per-game detail needed to evaluate a future **purchase utilization** insight.

- **Retain cost per recorded play** as the primary measure. Its inputs and limitations are understandable.
- **Retain cost per modeled player-hour as a detail-only experiment.** It uses recorded play count, BGG duration metadata, and a modeled player count derived from BGG's best-player poll or the midpoint of the BGG player range. It must never be presented as expected or observed player-hours, ranked, aggregated, or supplied to the collection brief.
- **Reject "value earned" as the product name and output.** Neither utilization measure captures enjoyment, quality, resale value, or whether the purchase was worthwhile.
- **Reject fitness-adjusted monetary value and configurable hourly-value targets.** They mix factual use with the owner's existing preference score, double-count preference when used to judge value, and turn an arbitrary hourly target into false monetary precision.
- **Keep acquisition data optional and manually entered.** BGG private-data authentication remains out of scope. Missing acquisition data causes the insight to abstain, not require new collection setup.
- **Defer the collection-insight and brief decision.** Optional price coverage is currently zero and no representative owner data demonstrates that these ratios are useful enough to prioritize. Ranking, aggregation, notability, and brief eligibility require a later decision after real coverage and usefulness are evaluated under the Trusted Collection Insights contract.

Collection-level implementation remains blocked by `shelf-judge-6kc`, which must define the concrete evidence, sufficiency, explanation, and abstention response contract consumed here. Optional acquisition capture, per-game cost per recorded play, and the detail-only modeled measure may proceed without claiming to be a trusted collection insight. This spec must be amended and re-approved before rankings, aggregation, or brief integration begin.

## Candidate Comparison

Let:

- `P` be the owner's lifetime landed acquisition cost for the game record.
- `N` be the recorded lifetime play count.
- `T` be the modeled play time in minutes.
- `C` be modeled player count.
- `F` be the current fitness score on a 1-10 scale.
- `H` be a configured monetary value assigned to one player-hour.

| Candidate                     | Formula                               | What it can answer                                                                                                  | Decision               |
| ----------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Cost per recorded play        | `P / N`                               | How much acquisition cost corresponds to each recorded play?                                                        | Primary                |
| Cost per modeled player-hour  | `P / (N * T / 60 * C)`                | What would cost per participant-hour be if every recorded play used the metadata-derived duration and player count? | Detail-only experiment |
| Fitness-adjusted social value | `(N * T / 60 * C) * (F / 10) * H - P` | Whether modeled use and preference have exceeded a configured monetary target                                       | Reject                 |

Cost per recorded play introduces only one new input, and changes in price or play count have an obvious effect. Cost per modeled player-hour can distinguish a short two-player game from a long group game, but it manufactures a hypothetical denominator from two metadata assumptions and is not approved as a collection insight. The fitness-adjusted candidate is numerically elaborate without becoming more factual: changing an axis rating, fitness configuration, or arbitrary hourly target changes claimed monetary value even when acquisition and use are unchanged.

### Illustrative Cases

These examples are hypothetical test cases, not claims about the owner's collection.

| Case                         | Inputs                                                                        |     Cost/play | Cost/modeled player-hour | Interpretation                                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------- | ------------: | -----------------------: | --------------------------------------------------------------------------------------------------- |
| Frequently played group game | `$60`, 10 plays, 90 min, best at 4                                            |       `$6.00` |                  `$1.00` | The second result models 60 player-hours; it does not claim they occurred.                          |
| Short two-player game        | `$20`, 2 plays, 30 min, best at 2                                             |      `$10.00` |                 `$10.00` | The modeled denominator is two player-hours under stated assumptions.                               |
| Gift                         | Explicit gift, 20 plays, 60 min, best at 4                                    |      No ratio |                 No ratio | Show "gift; no owner cost" and recorded plays rather than a trivially zero ratio.                   |
| Unplayed purchase            | `$80`, 0 plays                                                                |   Unavailable |              Unavailable | Show "no recorded plays"; do not divide by zero or report infinity.                                 |
| Unknown acquisition cost     | No cost, 12 plays                                                             |   Unavailable |              Unavailable | Abstain and identify the missing optional input.                                                    |
| Incomplete metadata          | `$45`, 6 plays, no duration                                                   |       `$7.50` |              Unavailable | Preserve the simpler measure instead of estimating missing duration.                                |
| Used then reacquired         | `$25` landed used purchase plus `$40` landed reacquisition, 13 lifetime plays |       `$5.00` |      Depends on metadata | The ratio describes cumulative record totals; it cannot attribute plays to either ownership period. |
| Free purchase                | Purchased at `$0`, 8 plays                                                    |      No ratio |                 No ratio | Show "No owner cost" and plays; do not treat the trivial zero as comparative evidence.              |
| Poll has only `4+`           | `$30`, 5 plays, 60 min, BGG range 2-6                                         |       `$6.00` |                  `$1.50` | Ignore the lower-bound poll bucket and model the BGG-range midpoint of 4 with fallback disclosure.  |
| Mixed currencies             | One USD record and one EUR record                                             | Per-game only |            Per-game only | Do not compare or aggregate without currency conversion.                                            |

### Sensitivity

- Doubling `P` doubles both retained measures.
- Doubling `N` halves both retained measures.
- Doubling `T` or `C` halves only cost per modeled player-hour.
- Changing fitness axes, ratings, weights, curves, vetoes, or prediction confidence changes neither retained measure.
- In the rejected fitness-adjusted candidate, modeled gross value scales linearly with `F` and `H`; doubling either doubles gross value before subtracting `P`. This sensitivity to a mutable preference score and arbitrary monetary target is part of the rejection.
- The player-count fallback can materially change the model for broad BGG ranges. The response must disclose whether BGG poll evidence or the BGG-range midpoint supplied `C`.
- Currency conversion, inflation, resale proceeds, market value, and replacement cost affect neither measure because they are outside the question being answered.

## Data Semantics

### Acquisition

- Acquisition data is optional and manual in this release.
- The entered amount represents **lifetime landed acquisition cost for the game record**, including item price, tax, shipping, and all purchases or reacquisitions. This aligns totals at the game-record level with BGG's lifetime aggregate play count, but it does not attribute plays to an individual acquisition period.
- A purchased game records a non-negative monetary amount and ISO 4217 currency. A free purchase may be zero.
- A gift is recorded explicitly as a gift and contributes zero owner acquisition cost. Gift status must remain distinguishable from unknown cost.
- A used purchase records its landed amount actually paid. Condition and original retail price are irrelevant.
- Reacquisition does not create a transaction ledger. The owner updates lifetime acquisition cost to include the additional outlay. Sale proceeds are not deducted.
- Every game record is evaluated independently. The current model has no reliable expansion identity or base-game relationship, so the feature makes no expansion-specific claim and performs no allocation. An expansion entered as a separate record may be absent or understated when plays were logged only against its base game.
- Mutation input supplies the amount as a base-10 major-unit string plus currency code, for example `{ amount: "12.34", currency: "USD" }`. Accepted syntax is `^\+?(0|[1-9]\d*)(?:\.\d+)?$`: surrounding whitespace, `.50`, `1.`, leading zeroes other than `0.x`, exponent notation, grouping separators, and negative signs are rejected. The amount is normalized and persisted as a non-negative integer minor-unit count, currency code, minor-unit exponent used, and currency-registry edition identifier. A versioned shared registry vendored from an identified ISO 4217 Maintenance Agency currency-data edition supplies supported codes and exponents without a runtime network dependency. Validation accepts values through JavaScript's safe-integer range after conversion and rejects unsupported codes and excess fractional precision. A later registry change shall not reinterpret persisted money; an exponent change requires an explicit migration decision. Currency conversion is not performed.
- Manual acquisition provenance is `manual`. Its confirmation time is one ISO 8601 UTC timestamp captured when a set mutation succeeds, including when the submitted value is identical; clearing the record removes it. Unrelated game edits do not change this time.

### Usage

- `numPlays` is a lifetime count of plays recorded for the game. BGG-imported counts mean the number of plays the owner has logged on BGG; they are not session records and do not prove attendance, duration, or recency.
- A positive play count is required for either ratio. Zero is valid evidence of no recorded plays but does not produce a ratio. A missing count means unknown, not zero.
- Provenance and observation time must be retained for play count, duration, and player-count evidence. One ISO 8601 UTC observation timestamp is captured when each successful BGG response is parsed and assigned to every retained value contained in that response. If a later response omits a value and the application retains the previous value, it also retains the previous observation time. A manual observation time is captured when a set mutation succeeds, including an identical submitted value. Existing values whose source and observation time cannot be established migrate with `legacy-unknown` provenance and no invented timestamp. Unrelated edits do not refresh any observation time.
- Modeled duration is the positive uncapped `playingTime` value already stored on the game. No configured play-time-axis cap, curve, or personal override may alter it.
- Modeled player count is derived directly from BGG's stored suggested-player-count poll when available. Consider only exact positive safe-integer buckets; an `N+` bucket is a lower bound and is not a modeled attendance value. Select the exact bucket with the highest positive "Best" vote count; when multiple exact buckets tie, use their arithmetic mean and disclose the tie and vote count. If no eligible poll bucket exists and the BGG range contains finite positive safe integers with `minPlayers <= maxPlayers`, use its arithmetic midpoint and disclose that poll evidence was absent or ineligible. A fractional result is permitted. If no source is usable, return `invalid-modeled-player-count` when any player-count evidence was present and `missing-modeled-player-count` only when all such evidence was absent.
- Modeled player-hours equal `numPlays * playingTime / 60 * modeledPlayerCount`. The response must expose every factor, source, observation time, poll vote support or fallback, and formula rather than only the quotient.

### Currency And Aggregation

- Every purchased amount carries its own ISO 4217 currency. A collection may contain more than one currency.
- Per-game ratios retain the acquisition currency.
- The approved per-game slice does not aggregate or rank results, even within one currency. A future collection-level amendment must define aggregation math, ordering, ties, minimum evidence, zero-cost treatment, and currency cohorts before implementation.
- The system must not sum, average, compare, rank, or generate a single collection statistic across currencies without an explicit conversion model. This release provides no conversion model.

## Usefulness Gate

The current collection has no acquisition-cost field, so real coverage is zero and a collection-level usefulness claim cannot yet be tested. Hypothetical arithmetic validates comprehensibility and edge behavior, not salience.

The approved first slice exists to permit an evidence-based decision later: optional manual landed-cost capture, per-game cost per recorded play, and a clearly experimental modeled player-hour detail. Before promotion to a collection insight, a follow-up amendment must evaluate representative real records across cheap and expensive, lightly and heavily played, short and long, solo and group, gift/free, used/reacquired, previously-owned, and incomplete-data cases. The owner must judge whether the resulting distinctions reveal something worth attention rather than merely restating price and play count. Trusted Collection Insights must then determine whether coverage, freshness, and support are sufficient for ranking or brief candidacy.

## Requirements

### Insight Contract

1. **REQ-UTIL-1:** The product shall use the labels "Purchase utilization," "Cost per recorded play," and "Experimental: cost per modeled player-hour." User-facing surfaces shall not use "value earned," "return on investment," "paid off," "good value," or "bad value" for these results.
2. **REQ-UTIL-2:** Purchase utilization shall remain observational. The approved slice may report per-game utilization but shall not rank games or recommend buying, keeping, selling, or avoiding one.
3. **REQ-UTIL-3:** Collection ranking, aggregation, notability, and brief integration shall not begin until this spec is amended to consume the shared evidence, sufficiency, explanation, notability, and abstention contract produced by Trusted Collection Insights. The approved per-game slice shall not add presentation-only confidence heuristics or claim collection-insight status.
4. **REQ-UTIL-4:** Every available result shall expose the acquisition amount and currency, recorded play count, derived result, input provenance, and observation freshness required to reproduce it. Modeled player-hour results shall additionally expose modeled duration, modeled player count, poll support or fallback, each input's source, and the formula.
5. **REQ-UTIL-5:** Unavailable per-game results shall return one or more stable abstention codes from `missing-acquisition`, `no-owner-cost`, `missing-play-count`, `invalid-play-count`, `no-recorded-plays`, `missing-modeled-duration`, `invalid-modeled-duration`, `missing-modeled-player-count`, and `invalid-modeled-player-count`. Surfaces shall map each code to a specific explanation and may return cost per recorded play while separately abstaining from the modeled measure.

### Acquisition Data

6. **REQ-UTIL-6:** A game shall support optional manual acquisition data that distinguishes unknown acquisition data, a purchase, and a gift. Entering or editing acquisition data shall not be required to add, import, rate, score, or browse a game.
7. **REQ-UTIL-7:** Purchase mutation input shall be a major-unit string matching `^\+?(0|[1-9]\d*)(?:\.\d+)?$` and an ISO 4217 currency code. A shared registry shall identify its vendored ISO 4217 Maintenance Agency data edition and define supported codes and minor-unit exponents. Validation shall normalize input to a non-negative safe integer minor-unit count and reject invalid syntax, unsupported codes, excess fractional precision, and values outside the safe-integer range. Persisted purchase data shall contain that integer, currency code, exponent used, registry edition, `manual` provenance, and an ISO 8601 UTC confirmation timestamp. A future registry change shall not reinterpret persisted money. A gift shall represent zero owner outlay without inventing a market price.
8. **REQ-UTIL-8:** The amount shall mean lifetime landed acquisition cost for that game record, including item price, tax, shipping, used purchases, and reacquisition outlay. It shall not imply that lifetime plays are attributable to a particular acquisition period. Sale proceeds, inflation, current market value, and replacement cost are outside this release.
9. **REQ-UTIL-9:** BGG private acquisition import and authentication shall remain out of scope. The data contract shall retain acquisition provenance so a future authenticated import can be added without misrepresenting manual values.
10. **REQ-UTIL-10:** Existing games shall migrate with acquisition data absent. Migration shall not assign zero cost, infer gifts, infer currency, or block collection loading.

### Calculations

11. **REQ-UTIL-11:** Both retained ratios shall use arbitrary-precision exact rational arithmetic from persisted minor units and rational denominator factors. Structured JSON results shall serialize reduced numerator and positive denominator as canonical unsigned base-10 integer strings. Display values shall round half-up to the persisted currency minor-unit exponent. No rounded display value shall be used as a future comparison key. Cost per recorded play shall equal lifetime acquisition cost divided by positive recorded lifetime play count.
12. **REQ-UTIL-12:** A zero play count shall produce a `no-recorded-plays` abstention, not zero cost per play, infinity, or an exception. A missing play count shall produce a `missing-play-count` abstention.
13. **REQ-UTIL-13:** Cost per modeled player-hour shall equal acquisition cost divided by `numPlays * playingTime / 60 * modeledPlayerCount`, with all denominator inputs positive and finite. It shall appear only on game detail and structured per-game output with the experimental label from REQ-UTIL-1.
14. **REQ-UTIL-14:** Modeled player count shall select the exact positive safe-integer BGG poll bucket with the highest positive "Best" vote count. Tied maxima shall resolve to their arithmetic mean and expose every tied bucket and the shared vote count. `N+`, malformed, non-positive, and unsafe-integer buckets shall be ineligible. When no eligible poll bucket exists, use and identify the arithmetic midpoint when `minPlayers` and `maxPlayers` are finite positive safe integers and `minPlayers <= maxPlayers`, while disclosing whether poll evidence was absent or ineligible. No minimum vote count is imposed for this detail-only experiment, but vote support must be shown. Only when neither poll nor range is usable shall present evidence produce `invalid-modeled-player-count` and wholly absent evidence produce `missing-modeled-player-count`.
15. **REQ-UTIL-15:** Modeled duration shall use uncapped `playingTime` only when it is a finite positive safe integer. Its evidence shall identify `bgg`, `manual`, or `legacy-unknown` provenance. Invalid present evidence shall produce `invalid-modeled-duration`; absent evidence shall produce `missing-modeled-duration`. A play-time axis cap, utility curve, fitness transformation, or personal override shall not alter it.
16. **REQ-UTIL-16:** Modeled player-hours and their cost ratio shall always carry an experimental model classification and the sentence "Models each recorded play at the shown duration and player count; actual sessions may differ." Publisher-range midpoint fallback shall not be represented as BGG poll consensus or actual attendance.
17. **REQ-UTIL-17:** Fitness score, fitness components, predicted ratings, utility curves, and a configurable hourly monetary target shall not contribute to either retained calculation.
18. **REQ-UTIL-18:** Calculations shall be deterministic and finite for every accepted input. A present play count that is not a non-negative safe integer shall produce `invalid-play-count`. Missing or invalid optional inputs shall cause the affected result to abstain without suppressing another result whose inputs are sufficient.

### Provenance And Scope

19. **REQ-UTIL-19:** The game data model shall retain source and ISO 8601 UTC observation time for play count, duration, and player-count evidence on future writes. One timestamp captured while parsing a successful BGG response shall apply to each contained value; an omitted retained value shall not receive a newer time. A successful manual set mutation, including one with an identical value, shall capture a new time. Existing values lacking reliable provenance shall migrate as `legacy-unknown` with no timestamp. Unrelated edits shall not alter these times, and no root-level value shall be described as BGG data solely because that is its usual source.
20. **REQ-UTIL-20:** Every game record shall be calculated independently. The system shall not infer an expansion relationship, allocate cost or plays between records, combine records, or make expansion-specific completeness claims without a future game-relationship model.
21. **REQ-UTIL-21:** Previously-owned games may retain and display historical purchase-utilization data on their detail surfaces. The approved slice shall not produce current-collection aggregates, rankings, or brief candidates for any ownership state.
22. **REQ-UTIL-22:** Per-game calculations shall preserve their acquisition currency. Collection aggregation, averaging, ranking, and brief selection are deferred. Cross-currency arithmetic shall not be introduced by the approved per-game slice.

### Interfaces And Presentation

23. **REQ-UTIL-23:** Shared types and validation shall define acquisition input, utilization result, evidence, model classification, and abstention reasons. Daemon, web, and CLI clients shall consume those contracts rather than reimplement formulas or missing-value rules.
24. **REQ-UTIL-24:** The daemon shall provide mutation operations for setting, correcting, and clearing manual acquisition data and a read operation for per-game utilization. Clearing data shall restore the unknown state rather than write zero.
25. **REQ-UTIL-25:** Game detail shall show available measures, calculation factors, source labels, observation times, and abstention reasons. Acquisition editing shall state: "Enter the total item price, tax, and shipping you have paid for this game across purchases."
26. **REQ-UTIL-26:** The CLI shall support setting, clearing, and reading acquisition data and shall return structured purchase-utilization results suitable for agents. Human-readable CLI output shall use the same labels and model disclosures as web.
27. **REQ-UTIL-27:** Before this spec can approve a collection insight, a follow-up evaluation shall report optional acquisition-data coverage among owned games, results on representative paid games, the owner's assessment of whether distinctions are useful, and the completed trusted-insight contract's sufficiency outcome. The amended spec shall define aggregation math, stable ordering, ties, minimum evidence, zero-cost treatment, currency cohorts, and brief eligibility.
28. **REQ-UTIL-28:** Gifts and zero-cost purchases shall show acquisition kind, "No owner cost," and recorded plays instead of a zero cost ratio. They shall not enter ratio-based comparisons if collection behavior is approved later.

## Out Of Scope

- BGG user authentication or private acquisition-data import.
- Detailed play-history import or manual session logging.
- Actual session duration, attendance, or player-hours.
- Currency conversion, exchange-rate history, inflation adjustment, and purchasing-power comparisons.
- Transaction history, purchase dates, sale proceeds, depreciation, resale value, or market value.
- Allocating base-game cost or plays across expansions.
- Fitness-adjusted value, entertainment budgets, hourly value targets, break-even dates, or "paid off" claims.
- Prescriptive curation or purchase advice.
- Collection aggregation, ranking, notability, and collection-brief presentation until the usefulness gate is passed in an approved amendment.

## AI Validation

1. Run the repository typecheck, lint, formatting, test, and build gates required by the project verification workflow.
2. Verify exact calculation fixtures for every illustrative case above, including the `$60 / 10 / 90 minutes / 4 players` case producing `$6.00` per play and `$1.00` per modeled player-hour, and the reacquisition case using cumulative landed cost without acquisition-period attribution.
3. Verify proportional sensitivity: doubling acquisition cost doubles both measures; doubling plays halves both; doubling duration or modeled player count halves only the modeled player-hour measure; changing fitness configuration or scores changes neither.
4. Verify modeled-player-count selection with one exact poll maximum, tied exact maxima, an `N+` maximum, malformed buckets, zero votes, odd and even BGG-range fallbacks, malformed bounds, and all inputs missing. Confirm tied buckets and votes are disclosed, `N+` is not treated as attendance, midpoint fallback is identified, and fractional results remain deterministic.
5. Verify duration uses uncapped BGG `playingTime` when a configured Play Time axis has a lower cap, non-default curve, veto, and personal override. None may alter utilization.
6. Verify structured abstention for absent acquisition data, absent play count, zero plays, absent/zero duration, and absent/malformed player-count evidence. Confirm cost per play remains available when only modeled player-hour inputs are insufficient.
7. Verify unknown, purchased-at-zero, and gift states remain distinct through API validation, persistence, migration, web editing, and CLI output. Confirm zero-cost records show "No owner cost" without a ratio and clearing acquisition data restores unknown.
8. Verify USD-style two-decimal, JPY-style zero-decimal, and KWD-style three-decimal inputs; excess precision; safe-integer boundaries; exact rational results for repeating quotients; and half-up display rounding at each currency exponent.
9. Load pre-feature JSON fixtures containing null, zero, positive, negative, reversed-range, and unsafe-integer metadata. Test non-finite values directly at the calculation boundary because JSON cannot represent them. Confirm migration adds no acquisition assumptions, marks unverifiable play-count, duration, and player-count provenance as `legacy-unknown`, returns the specified missing or invalid abstention codes, remains idempotent, and preserves all existing game and scoring behavior.
10. Verify subsequent BGG refreshes record BGG source and the successful containing-response time for imported play count, duration, and player-count evidence. Verify an omitted retained value keeps its prior time, manual changes set their own time, acquisition changes set confirmation time, clearing removes acquisition time, and unrelated game edits do not falsify freshness.
11. Verify the approved slice exposes no collection aggregation, ordering, ranking, notability, or brief candidate. Confirm mixed-currency records remain independent, previously-owned records are detail-only, and no game records are automatically combined or treated specially as expansions.
12. Verify daemon routes, web proxy/client helpers, and CLI helpers share response types and preserve evidence, model classification, exact rational results, and abstention codes end to end.
13. Run a fresh-context review that checks required labels and disclosures from REQ-UTIL-1, REQ-UTIL-16, REQ-UTIL-25, and REQ-UTIL-28 and rejects the prohibited labels in REQ-UTIL-1.

## Follow-Up Decisions

- After Trusted Collection Insights is specified, map its concrete evidence and sufficiency fields into this response and resolve whether `legacy-unknown` play-count provenance is eligible for the brief or detail-only.
- If detailed play history is added later, define a separate observed player-hours measure. Do not silently replace this model while retaining the same label or provenance.
- If BGG private authentication is implemented later, define conflict resolution between manual lifetime cost and imported acquisition price before enabling import.
