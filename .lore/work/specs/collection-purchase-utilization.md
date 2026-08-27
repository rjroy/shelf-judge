---
title: Did this purchase earn its cost?
date: 2026-08-25
status: implemented
tags: [collection, insights, acquisition-cost, play-count, value]
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

# Did This Purchase Earn Its Cost?

## Goal

Help the owner understand which games were good purchases.

The feature compares what a game cost with how much use it has received and how well it fits the owner's preferences. Its purpose is to keep the owner honest about whether they got their money's worth.

This is not about resale value and it does not decide whether a game should be kept or sold.

## What The Owner Sees

Assume the owner decides that one person-hour of entertainment is worth `$8` for a game with fitness `6`.

They bought a game for `$60`. It has:

- 10 recorded plays
- a 90-minute published play time
- a modeled player count of 4
- a current fitness of 6

Those 10 plays represent 60 modeled player-hours:

```text
10 plays x 1.5 hours x 4 players = 60 modeled player-hours
```

The game cost `$1` per modeled player-hour:

```text
$60 / 60 modeled player-hours = $1 per modeled player-hour
```

The owner's benchmark for a fitness-6 game is `$8` per person-hour. The game has therefore delivered eight times the modeled value needed to earn its cost.

The game detail page should lead with something like:

> **Value threshold met: 8.00x**
>
> You paid `$1.00` per modeled player-hour. Your benchmark for a fitness-6 game is `$8.00`.
>
> Value remaining: `$0.00`
>
> Estimated additional plays to value threshold: `0`

The page should then show the numbers used in the calculation so the owner can decide whether the estimate is believable.

Here is a purchase that has not reached the threshold:

- purchase cost: `$20`
- recorded plays: 2
- modeled duration: 30 minutes
- modeled player count: 2
- current fitness: 6
- entertainment benchmark: `$8`

Each play represents one modeled player-hour and `$8` of modeled value. Two plays have delivered `$16`, leaving `$4` of value remaining. One more whole play would cross the threshold.

> **Value threshold not yet met: 0.80x**
>
> Value remaining: `$4.00`
>
> Estimated additional plays to value threshold: `1`

## The Benchmark

The owner chooses what one person-hour of entertainment is worth for a fitness-6 game. This value is called the **entertainment benchmark**.

A movie ticket gives the owner a practical way to choose it. A `$16` ticket for a two-hour movie costs `$8` per person-hour. This is an example, not a price Shelf Judge looks up or updates automatically.

Fitness normally runs from 1 to 10. A higher score means the game better fits what the owner values. A veto is the exception and gives the game a fitness of 0.

Fitness changes how much the owner is willing to pay for an hour. The first version uses a straight-line adjustment:

| Fitness | Hourly benchmark when fitness 6 is worth `$8` |
| ------: | --------------------------------------------: |
|       1 |                                      `≈$1.33` |
|       3 |                                       `$4.00` |
|       6 |                                       `$8.00` |
|       9 |                                      `$12.00` |
|      10 |                                     `≈$13.33` |

The `≈` values repeat beyond two decimal places. Calculations use the exact values, while the table shows rounded examples.

This model is deliberately simple. It assumes fitness and acceptable hourly cost rise at the same rate. Real preferences may not be linear, so the owner must be able to see this assumption. A later version may replace the straight line with a curve.

## How It Works

For each paid game, Shelf Judge:

1. Estimates player-hours from recorded plays, published play time, and a modeled player count.
2. Divides the purchase cost by those modeled player-hours.
3. Adjusts the owner's entertainment benchmark using the game's current fitness.
4. Compares the game's cost per modeled player-hour with the adjusted benchmark.
5. Shows how much purchase value remains and estimates how many additional similar plays would reach the threshold.

If the game's hourly cost is at or below the adjusted benchmark, the purchase has met its modeled value threshold.

The same comparison can be shown as a multiplier:

- `1.00x` means the purchase has exactly met the threshold.
- More than `1.00x` means it has delivered more modeled value than required.
- Less than `1.00x` means it has not yet met the threshold.

**Value remaining** is the part of the purchase cost that has not yet been justified by modeled use. It stops at `$0`; a game that has crossed the threshold does not show negative remaining value.

**Estimated additional plays to value threshold** assumes future plays use the same duration, player count, fitness, and entertainment benchmark shown in the calculation. It rounds up to a whole play. It is an estimate, not a prediction that the game will actually be played that many times.

## Collection Sorting

The collection list can be sorted by:

- value remaining
- estimated additional plays to value threshold

Sorting by value remaining helps the owner find purchases with the most money left to justify. Sorting by additional plays helps distinguish games that are close to the threshold from games that would require much more use.

Shelf Judge treats all entered amounts as the owner's one implicit personal currency. It does not store currency codes or distinguish dollars, pounds, or other units. Value remaining therefore sorts directly by its half-up rounded number of hundredths used for the two-decimal display.

For additional plays, "Unreachable at current fitness" is larger than any finite estimate. It appears first when sorting high to low and after all finite estimates when sorting low to high. Results that cannot be calculated appear last in either direction.

This is a user-selected way to inspect the collection. Shelf Judge does not automatically label the first games in the sort as bad purchases or place them in the collection brief.

## Important Choices

### Current Fitness

The calculation uses the same current fitness score shown elsewhere for the game. It does not create a second hidden score.

When the displayed fitness changes, the purchase-value result changes with it. The result answers, "Was this a good purchase according to what I value now?" It is not a historical snapshot of how the owner felt when they bought or played the game.

A vetoed game has fitness `0`. Its adjusted hourly benchmark is therefore `$0`, even when the collection benchmark is missing or invalid, so a paid vetoed game cannot currently meet the value threshold.

### Modeled Player-Hours

Shelf Judge does not have individual play sessions with actual duration and attendance. It estimates player-hours by applying one duration and one player count to every recorded play.

The estimate may be wrong. The result must always show:

- recorded play count
- published play time
- modeled player count
- where each value came from
- when each value was last observed, when known

The interface must say:

> Models each recorded play at the shown duration and player count; actual sessions may differ.

### Player Count

When possible, modeled player count comes from the exact player count with the most "Best" votes in BGG's suggested-player poll.

- If exact player counts tie, use their average and show the tie.
- Show a tied average as a modeled value, such as `3.5 players`, rather than implying that half a person attended.
- Ignore entries such as `4+` because they are lower bounds, not exact attendance.
- If the poll cannot provide a count, use the midpoint of BGG's minimum and maximum player counts.
- If neither source works, do not produce a modeled value result.

### Purchase Cost

Purchase cost means the total amount the owner has paid for that game record over its lifetime. Include item price, tax, and shipping. For a used game, use the amount actually paid. If the owner buys the game again, add the new cost to the existing total.

It does not subtract sale proceeds. It does not include inflation, current market value, replacement cost, or the original retail price of a used game.

Recorded plays are also lifetime totals. Shelf Judge does not try to decide which ownership period produced each play.

## Special Cases

| Situation                        | What the owner sees                                                                                                                                                                                                                                                                |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No purchase cost entered         | Explain that purchase cost is needed. Continue showing any available use data.                                                                                                                                                                                                     |
| No entertainment benchmark       | For a positive-play, non-vetoed game, explain that the benchmark is needed for the value judgment. Continue showing available cost measures. A known zero-play or vetoed purchase still shows `0.00x` and its full cost remaining because those results do not need the benchmark. |
| Play count unavailable           | Explain that play count is unknown. Do not judge the purchase unless current fitness is `0`; a veto alone is enough to show the full cost remaining and an unreachable additional-play estimate.                                                                                   |
| Exactly zero recorded plays      | Show `0.00x`, the full paid cost as value remaining, and "Value threshold not yet met," even when fitness or the benchmark is unavailable. Estimate additional plays only when duration, player count, positive fitness, and a benchmark are usable.                               |
| Missing duration or player count | Show cost per recorded play when possible. Explain why modeled value is unavailable unless current fitness is `0`; a veto alone is enough to show the full cost remaining and an unreachable additional-play estimate.                                                             |
| Gift                             | Show "Gift; no owner cost." Do not calculate a value multiplier.                                                                                                                                                                                                                   |
| Purchased for zero               | Show "No owner cost." Do not calculate a value multiplier.                                                                                                                                                                                                                         |
| Previously owned game            | Show the result on game detail using its historical cost and plays, but make clear that fitness and the benchmark are current.                                                                                                                                                     |
| Expansion stored as its own game | Judge that record independently. Do not move cost or plays between the expansion and its base game.                                                                                                                                                                                |
| Value threshold already met      | Show `$0.00` remaining and `0` additional plays. Do not show a negative balance.                                                                                                                                                                                                   |
| Vetoed game                      | Show the full paid cost as value remaining. The additional-plays field says "Unreachable at current fitness," even when the benchmark or modeled-use inputs are missing or invalid. Do not show infinity.                                                                          |

## Requirements

### Result

1. **REQ-UTIL-1:** A paid game with enough data must show whether its modeled value threshold is met or not yet met.
2. **REQ-UTIL-2:** A positive-play result must show the value multiplier, value remaining, estimated additional plays, cost per modeled player-hour, fitness-adjusted hourly benchmark, and all inputs used. A zero-play result must show `0.00x`, the full paid cost as value remaining, and that hourly cost is unavailable. It shows the benchmark when available; otherwise it explains that the benchmark was not needed for those zero-play results. A fitness-zero result shows a `$0.00` adjusted benchmark and explains that the collection benchmark was not needed.
3. **REQ-UTIL-3:** The threshold is met when the exact cost per modeled player-hour is less than or equal to the exact fitness-adjusted benchmark. If rounded numbers would make the displayed status look wrong, the interface must show enough extra precision to explain the difference.
4. **REQ-UTIL-4:** Cost per recorded play must remain available whenever purchase cost and a positive recorded play count are known, even if the modeled value result is unavailable.
5. **REQ-UTIL-5:** The product must use the labels "Value threshold met," "Value threshold not yet met," "Value remaining," "Estimated additional plays to value threshold," "Cost per recorded play," "Cost per modeled player-hour," and "Fitness-adjusted hourly benchmark."
6. **REQ-UTIL-6:** Value remaining must be the portion of purchase cost not yet justified by modeled use. It cannot be less than zero.
7. **REQ-UTIL-7:** Estimated additional plays must divide value remaining by the modeled value of one more play and round up to the next whole play.
8. **REQ-UTIL-8:** A purchase that has met its threshold must show `$0.00` remaining and `0` additional plays.
9. **REQ-UTIL-9:** When current fitness is `0`, a paid game must show its full purchase cost as value remaining. Its additional-plays field must show "Unreachable at current fitness" rather than a number or infinity. This fitness rule takes precedence when the benchmark or modeled-use inputs are missing or invalid.

### Benchmark And Fitness

10. **REQ-UTIL-10:** The collection must have one optional entertainment benchmark containing a positive amount in the owner's implicit personal currency.
11. **REQ-UTIL-11:** The benchmark means the acceptable cost of one person-hour of entertainment for a fitness-6 game.
12. **REQ-UTIL-12:** The fitness-adjusted benchmark must change in direct proportion to fitness. Fitness 6 uses the configured benchmark exactly.
13. **REQ-UTIL-13:** The benchmark settings must explain the movie-ticket method and identify `$16 / 2 hours = $8 per person-hour` as an example.
14. **REQ-UTIL-14:** The calculation must use the current fitness score shown for the game.
15. **REQ-UTIL-15:** A vetoed fitness of `0` must produce an hourly benchmark of zero without requiring a valid collection benchmark.
16. **REQ-UTIL-16:** Changing fitness or the entertainment benchmark must update the result without changing purchase or usage data.

### Purchase And Usage Data

17. **REQ-UTIL-17:** Purchase cost is optional. The owner must be able to mark a game as unknown, a gift, or a purchase and correct that choice later.
18. **REQ-UTIL-18:** Purchase cost means lifetime landed cost for that game record, including item price, tax, shipping, and later reacquisitions.
19. **REQ-UTIL-19:** A known play count of zero must produce zero modeled player-hours, `0.00x` value, and the full paid cost remaining without requiring fitness, benchmark, duration, or player-count metadata. Estimating additional plays still requires valid positive fitness, a benchmark, duration, and player-count metadata.
20. **REQ-UTIL-20:** A positive play count requires a valid positive duration and modeled player count before modeled player-hours or modeled purchase value can be shown, except for the fitness-0 result defined by REQ-UTIL-9.
21. **REQ-UTIL-21:** A gift must show "Gift; no owner cost." A zero-cost purchase must show "No owner cost." Neither receives value remaining, a value multiplier, or a met/not-met judgment.
22. **REQ-UTIL-22:** Purchase cost and the entertainment benchmark must use the same implicit personal currency. The system must not store currency codes, convert amounts, or infer exchange rates.

### Honesty And Scope

23. **REQ-UTIL-23:** Every positive-play modeled result must show its play count, duration, player count, fitness, benchmark, sources, and known observation times. A zero-play result must show which inputs were and were not needed for each displayed value.
24. **REQ-UTIL-24:** Every modeled result must state that actual sessions may differ from the model.
25. **REQ-UTIL-25:** Estimated additional plays must state that future plays are assumed to match the shown duration and player count.
26. **REQ-UTIL-26:** The result describes purchase value. It must not describe cash recovery, resale return, or investment return.
27. **REQ-UTIL-27:** The feature must not recommend buying, keeping, selling, or avoiding a game.
28. **REQ-UTIL-28:** The feature must calculate every game record independently and must not infer base-game or expansion relationships.
29. **REQ-UTIL-29:** This feature must not feed its purchase-value result back into the fitness score used by the same calculation.
30. **REQ-UTIL-30:** This release must not aggregate collection value or add purchase value to the collection brief. User-selected sorting is allowed under REQ-UTIL-35 and REQ-UTIL-36.

### Product Surfaces

31. **REQ-UTIL-31:** Game detail must lead with the met, not-met, unavailable, or not-applicable result before showing calculation details.
32. **REQ-UTIL-32:** Web and CLI must let the owner mark a game as a gift, enter or correct a purchase, restore an unknown acquisition state, and set, correct, or clear the entertainment benchmark.
33. **REQ-UTIL-33:** Clearing purchase cost or the entertainment benchmark must restore the unknown state rather than save zero.
34. **REQ-UTIL-34:** Web and CLI must show the same result for the same game and inputs.
35. **REQ-UTIL-35:** The web collection list must support ascending and descending sorts by displayed value remaining and by estimated additional plays. Value remaining sorts by the half-up rounded number of hundredths used for its two-decimal display, so an exact zero and a positive sub-cent value displayed as `<$0.01` share the zero sort key and use the tie-breaker instead of the hidden fraction.
36. **REQ-UTIL-36:** Calculated values must sort before results without a sort value. A zero-play or fitness-zero value remaining is calculated even when other result components are unavailable. For estimated plays, unreachable results sort above every finite result in descending order and below every finite result in ascending order. Unavailable and not-applicable results have no sort value and remain together after calculated and unreachable results in either direction. Exact ties, including results without a sort value, always sort ascending by the game's NFC-normalized name using Unicode code-point order and then by stable game ID using code-point order, regardless of the selected primary direction.

## Deferred Collection Insight

The first release calculates each game independently and adds user-selected collection-list sorts. The collection does not currently contain purchase costs or an entertainment benchmark, so there is no real data proving that an automatic ranking or collection summary would be useful.

Before this becomes a collection insight, the owner must review real results across:

- cheap and expensive games
- played and unplayed games
- short and long games
- low- and high-fitness games
- solo and group games
- gifts, free games, used games, and reacquisitions
- missing or uncertain data

That review should answer whether the feature identifies genuinely good and poor purchases rather than merely producing interesting arithmetic.

Automatic ranking, interpretation, and brief placement also depend on the separate Trusted Collection Insights work. The user-selected sorts in this spec do not depend on that work.

## Technical Contract

This section records details needed for consistent implementation. A reader does not need it to review the product behavior above.

### Formulas

Let:

- `P` = positive lifetime purchase cost
- `N` = recorded lifetime plays
- `T` = published play time in minutes
- `C` = modeled player count
- `F` = current fitness, from 0 through 10
- `H` = hourly entertainment benchmark at fitness 6

```text
modeled player-hours (Q) = N * T / 60 * C
cost per modeled player-hour (A) = P / Q
fitness-adjusted hourly benchmark (B) = H * F / 6
value multiplier (R) = Q * B / P
value remaining (V) = max(P - Q * B, 0)
modeled value of one additional play (W) = T / 60 * C * B
estimated additional plays (K) = ceil(V / W)
```

`R >= 1` is `met`. `R < 1` is `not-met`. For positive `N`, comparing `R` with `1` is equivalent to comparing `A` with `B`.

Apply the fitness-0 rule first. For a positive-cost purchase with valid `F = 0`, set `B = 0`, `R = 0`, `V = P`, and `K = unreachable-at-current-fitness` without requiring `H`, `N`, `T`, or `C`. Supporting use measures still require their normal inputs.

Otherwise, when `N = 0`, set `Q = 0`, `R = 0`, and `V = P` without reading `T` or `C`. `A` remains unavailable because it would require division by zero. `K` still requires valid positive `T`, `C`, and `B`.

When `V = 0`, set `K = 0`. When `V > 0` and `B = 0`, classify `K` as `unreachable-at-current-fitness` rather than dividing by zero. Otherwise, `K` is the smallest whole number of additional identical modeled plays that makes the threshold met.

### Exact Values

- Perform calculations with exact rational numbers.
- Interpret amounts using their stored integer hundredths.
- Interpret fitness from the base-10 value returned by the shared fitness contract, not its binary floating-point bits.
- Compare exact values before rounding.
- Round monetary displays half-up.
- Round amount displays to two decimal places.
- Display the value multiplier with two decimal places.
- Display estimated additional plays as a whole number after exact ceiling.
- If two-decimal display would hide why a result is met or not met, show additional digits for that result.
- Show a positive value that rounds to zero as `<$0.01`, rather than `$0.00`. A value that rounds up to one hundredth displays normally as `$0.01`.
- Sort value remaining by its rounded minor-unit display amount. Sort estimated plays by its whole-number result and availability category.

### Money

- Amount input is a decimal string with at most two fractional digits.
- Store the integer number of hundredths, manual source, and confirmation time. Do not store a currency code.
- All purchase and benchmark amounts use the owner's one implicit personal currency. The first release uses `$` as its display symbol and does not add currency or symbol settings.
- Reject input that cannot be represented exactly in hundredths or as a safe stored integer; never round input silently.
- Benchmark amount must be positive. Purchase amount may be zero.
- Existing collections migrate with purchase cost and benchmark absent.
- Malformed persisted amount data remains available for correction but does not prevent the collection from loading.

### Evidence

- A play count is valid when it is a non-negative safe integer.
- A duration is valid when it is a positive safe integer.
- Exact positive safe-integer BGG poll buckets are eligible for modeled player count.
- Use the eligible bucket with the most positive "Best" votes.
- Average tied winning buckets.
- Ignore lower-bound buckets such as `4+`.
- If no eligible poll bucket exists, use the midpoint of a valid positive BGG player range.
- Store enough poll state to distinguish absent, empty, unusable, and usable evidence.
- Future BGG and manual writes retain their source and observation time.
- Existing values without reliable provenance use `legacy-unknown` and do not receive invented timestamps.

### Result Reasons

The shared result uses these stable reasons for unavailable, not-applicable, and unreachable component outcomes:

- `missing-acquisition`
- `invalid-acquisition`
- `no-owner-cost`
- `missing-benchmark`
- `invalid-benchmark`
- `missing-play-count`
- `invalid-play-count`
- `missing-modeled-duration`
- `invalid-modeled-duration`
- `missing-modeled-player-count`
- `invalid-modeled-player-count`
- `missing-fitness`
- `invalid-fitness`
- `unreachable-at-current-fitness`

Each result component has an explicit `calculated`, `unavailable`, `not-applicable`, or `unreachable` outcome and reports only reasons relevant to that outcome. `no-owner-cost` is not applicable, and `unreachable-at-current-fitness` is unreachable rather than unavailable. For example, missing duration prevents modeled purchase value but does not prevent cost per recorded play.

## Out Of Scope

- Importing private BGG purchase data
- Recording individual play sessions, attendance, or actual duration
- Looking up movie-ticket prices
- Nonlinear fitness adjustment
- Currency metadata, conversion, or inflation adjustment
- Purchase dates, transaction history, sale proceeds, depreciation, or market value
- Moving cost or plays between base games and expansions
- Purchase recommendations or selling recommendations
- Automatic collection rankings, summaries, or brief placement
- Automatic judgment based on sort position

## AI Validation

1. Run the repository's typecheck, lint, formatting, test, and build checks.
2. Test the `$60`, 10-play, 90-minute, four-player, fitness-6, `$8` benchmark example. It must produce 60 modeled player-hours, `$1.00` per modeled player-hour, and `8.00x` met value.
3. Test the `$20`, two-play, 30-minute, two-player, fitness-6, `$8` benchmark example. It must produce `$4.00` value remaining and one estimated additional play.
4. Test fitness 1, 3, 6, 9, and 10 against an `$8` benchmark. Fitness 6 must produce exactly `$8`.
5. Test a result exactly at, immediately below, and immediately above `1.00x`. Classification and value remaining must use exact results rather than displayed values. A positive sub-minor-unit remainder must not display as zero.
6. Test estimated additional plays when no plays remain, when a fractional number of plays remains, and when one additional play overshoots the threshold. The result must be zero or round up to a whole play.
7. Test zero plays with fitness, benchmark, duration, and player count present, missing, and malformed. Each case must produce `0.00x` and the full paid cost remaining without division by zero; only the additional-play estimate requires all future-play inputs.
8. Test gifts, zero-cost purchases, unknown cost, and unknown benchmark.
9. Test ordinary, predicted, vetoed, tournament-influenced, and redundancy-adjusted fitness. The value calculation must use the score shown for the game. A vetoed paid game must report the overall threshold as not met and only the additional-play estimate as `unreachable-at-current-fitness`, never as infinity.
10. Test player-count selection for one poll winner, tied winners, `N+`, unusable polls, valid range fallback, invalid range, and no evidence.
11. Test amounts with zero, one, and two fractional digits, invalid precision, safe-integer boundaries, exact storage as hundredths, and malformed persisted amounts.
12. Verify source and observation information survives daemon, web, and CLI responses.
13. Verify ascending and descending web sorts for remaining money, additional plays, displayed-money ties, unreachable games, unavailable games, gifts, and zero-cost purchases. Remaining-money sorts must use the rounded-hundredths display key, including an exact-zero/sub-cent tie; additional-play sorts must use whole-number results and the specified availability order. Zero-play and fitness-zero remaining values count as calculated sort values even when other result components are unavailable. Unavailable and not-applicable results remain together at the end. Ties must keep ascending name and ID order in both primary directions; cover NFC-equivalent names, non-ASCII code-point ordering, and the stable-ID fallback.
14. Verify the release contains no automatic collection judgment, aggregation, brief candidate, currency metadata or conversion, or purchase-value fitness axis.
15. Ask a fresh reviewer to explain the feature, the fitness-6 benchmark, both examples, value remaining, and estimated additional plays without reading the Technical Contract. Treat inability to do so as a spec failure.

## Follow-Up Questions

- Does the straight-line fitness adjustment match the owner's judgment after real collection data is entered?
- Should a later version let the owner shape that adjustment with a curve?
- Is purchase value useful enough to rank or summarize across the collection?
- If purchase value becomes an axis, what fitness score can it safely use without depending on itself?
