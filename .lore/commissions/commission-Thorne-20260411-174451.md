---
title: "Commission: Review: Niche champion display Phase 1-3"
date: 2026-04-12
status: completed
tags: [commission]
worker: Thorne
workerDisplayTitle: "Guild Warden"
prompt: "Review the niche champion display foundation work (Phases 1-3).\n\nSpec: `.lore/specs/niche-champion-display.md`\nPlan: `.lore/plans/niche-champion-display.md`\n\nReview focus:\n1. Shared types in `packages/shared/src/types.ts` — do the new interfaces match the spec (REQ-NICHE-9, REQ-NICHE-10)?\n2. Niche engine at `packages/daemon/src/services/niche-engine.ts` — verify the algorithm matches spec requirements (REQ-NICHE-1 through REQ-NICHE-8, REQ-NICHE-11, REQ-NICHE-15 through REQ-NICHE-17, REQ-NICHE-20). Check tie-breaking logic, veto exclusion, predicted-game handling, neighbor limits.\n3. Test coverage at `packages/daemon/tests/niche-engine.test.ts` — all 16 test cases from the plan present? Edge cases covered?\n4. Pure-function discipline — no I/O, no service deps in the engine module.\n5. No mutations of input arrays in `computeNicheImpact`.\n\nReport all findings. This review gates the next phase of work."
dependencies:
  - commission-Dalton-20260411-174435
linked_artifacts:
  - packages/daemon/src/services/niche-engine.ts

  - packages/daemon/tests/niche-engine.test.ts
  - packages/shared/src/types.ts
  - packages/daemon/tests/niche-engine.test.ts
  - packages/shared/src/types.ts
activity_timeline:
  - timestamp: 2026-04-12T00:44:51.276Z
    event: created
    reason: "Commission created"
  - timestamp: 2026-04-12T00:44:51.278Z
    event: status_blocked
    reason: "Dependencies not satisfied"
    from: "pending"
    to: "blocked"
  - timestamp: 2026-04-12T00:49:50.496Z
    event: status_pending
    reason: "Dependencies satisfied"
    from: "blocked"
    to: "pending"
  - timestamp: 2026-04-12T00:49:50.499Z
    event: status_dispatched
    reason: "Dispatched to worker"
    from: "pending"
    to: "dispatched"
  - timestamp: 2026-04-12T00:49:50.520Z
    event: status_in_progress
    reason: "Execution started"
    from: "dispatched"
    to: "in_progress"
  - timestamp: 2026-04-12T00:49:56.511Z
    event: progress_report
    reason: "Starting review of niche champion display Phases 1-3. Reading spec, plan, and implementation files."
  - timestamp: 2026-04-12T00:51:39.573Z
    event: progress_report
    reason: "Read all five files: spec (296 lines), plan (444 lines), types.ts (467 lines), niche-engine.ts (285 lines), tests (454 lines). Beginning detailed analysis against requirements."
  - timestamp: 2026-04-12T00:53:05.830Z
    event: progress_report
    reason: "Algorithm analysis complete. One defect found (isChampion on predicted games). Moving to test coverage analysis."
  - timestamp: 2026-04-12T00:53:50.219Z
    event: progress_report
    reason: "All findings recorded. Preparing final review submission."
  - timestamp: 2026-04-12T00:54:20.382Z
    event: result_submitted
    reason: "## Niche Champion Display — Phases 1-3 Review\n\n### Verdict: One defect, one test gap, two observations. Foundation is solid.\n\n---\n\n### DEFECT: `isChampion` incorrectly true for predicted games tied with actual games\n\n**File**: `packages/daemon/src/services/niche-engine.ts:188`\n**Requirement**: REQ-NICHE-8\n\nThe line `isChampion: game.rank === 1` sets champion status based solely on rank. When a predicted-only game ties at rank 1 with an actual-scored game, both receive `isChampion: true`. REQ-NICHE-8 says predicted games \"do not displace an actual-scored game from champion status when tied on score.\" The predicted game should have `isChampion: false` when any actual game shares rank 1.\n\n**Impact**: Every downstream consumer of `isChampion` (web UI champion badge, CLI champion display, collection \"champion of N\" summary) will incorrectly report predicted games as champions. The `champion` NicheNeighbor field is correct (points to the actual game), but the boolean flag on each game's own entry is wrong.\n\n**Fix direction**: `isChampion` should be `rank === 1 && (!isPredicted || no actual games share rank 1 in this niche)`. The `sortAndRank` function already separates actual from predicted in sort order, so detecting whether an actual game exists at rank 1 is straightforward from the ranked array.\n\n---\n\n### TEST GAP: No assertion on `isChampion` for predicted games in ties\n\n**File**: `packages/daemon/tests/niche-engine.test.ts:245-259, 327-349`\n**Related to**: The `isChampion` defect above\n\nThe \"actual scores rank above predicted in ties\" test (line 245) and the \"Card Game niche: three-way tie\" test (line 327) both verify `rank` and `champion.gameId` but never assert `isChampion === false` on game B (predicted). Adding this assertion would catch the defect above and should be included in the fix.\n\n---\n\n### QUESTION: Position-based vs rank-based neighbors\n\n**File**: `packages/daemon/src/services/niche-engine.ts:172-180`\n**Requirement**: REQ-NICHE-11\n\nThe `above` and `below` arrays collect neighbors by position in the sorted array, not by rank difference. In the Card Game niche (A, H, B all rank 1), B's `above` contains H and A even though they share the same rank and rounded score. The spec says \"Games ranked immediately above (better fitness)\" which literally means games with better fitness, not games at the same fitness in a higher sort position.\n\nThe implementation's choice is more useful (shows context within ties) and is explicitly tested. This is a judgment call, not a clear defect. If the spec intent is strictly \"better fitness only,\" the implementation needs adjustment. If the intent is \"adjacent in the ranking,\" it's correct as-is. Worth confirming with the spec author.\n\n---\n\n### OBSERVATION: NicheNeighbor.fitnessScore uses rounded value\n\n**File**: `packages/daemon/src/services/niche-engine.ts:42`\n\n`toNeighbor` sets `fitnessScore` to the rounded score (one decimal place), not the raw score from `FitnessResult.score`. A game scoring 8.47 appears as 8.5 in neighbor data. This is consistent with display precision and tie logic (REQ-NICHE-6), and the spec's examples show one-decimal values (\"Dominion (8.4)\"). No action needed unless downstream displays show higher precision for fitness scores elsewhere, which would create visible inconsistency.\n\n---\n\n### Requirements Satisfied\n\n| Requirement | Status |\n|---|---|\n| REQ-NICHE-1 (mechanics, categories, families only) | Satisfied |\n| REQ-NICHE-2 (minimum 2 games) | Satisfied |\n| REQ-NICHE-3 (BGG data exclusion) | Satisfied |\n| REQ-NICHE-4 (ranked by fitness descending) | Satisfied |\n| REQ-NICHE-5 (champion field) | Satisfied |\n| REQ-NICHE-6 (tie-sharing, skip, alphabetical) | Satisfied |\n| REQ-NICHE-7 (vetoed exclusion) | Satisfied |\n| REQ-NICHE-8 (predicted champion demotion) | **DEFECT** — isChampion flag |\n| REQ-NICHE-9 (separate from FitnessResult) | Satisfied |\n| REQ-NICHE-10 (shared types) | Satisfied |\n| REQ-NICHE-11 (2 neighbors max) | Satisfied |\n| REQ-NICHE-15 (pure-function module) | Satisfied |\n| REQ-NICHE-16 (computeNichePositions signature) | Satisfied |\n| REQ-NICHE-17 (computeNicheImpact signature) | Satisfied |\n| REQ-NICHE-20 (niche entry sort order) | Satisfied |\n\n### Additional Checks\n\n- **Pure-function discipline**: Clean. Only type-level imports from @shelf-judge/shared. No I/O, no service deps.\n- **No input mutation in computeNicheImpact**: Verified. Uses filter(), spread, and new Map/array construction throughout. Tested with JSON.stringify comparison.\n- **Test coverage**: 21 tests total (exceeds planned 16). Hand-constructed 9-game fixture with known overlaps. All spec success criteria for automated tests are addressed.\n- **Determinism**: Tested explicitly (line 310-325)."
  - timestamp: 2026-04-12T00:54:28.587Z
    event: status_completed
    reason: "Execution completed"
    from: "in_progress"
    to: "completed"
current_progress: "All findings recorded. Preparing final review submission."
projectName: shelf-judge
---
## Niche Champion Display — Phases 1-3 Review

### Verdict: One defect, one test gap, two observations. Foundation is solid.

---

### DEFECT: `isChampion` incorrectly true for predicted games tied with actual games

**File**: `packages/daemon/src/services/niche-engine.ts:188`
**Requirement**: REQ-NICHE-8

The line `isChampion: game.rank === 1` sets champion status based solely on rank. When a predicted-only game ties at rank 1 with an actual-scored game, both receive `isChampion: true`. REQ-NICHE-8 says predicted games "do not displace an actual-scored game from champion status when tied on score." The predicted game should have `isChampion: false` when any actual game shares rank 1.

**Impact**: Every downstream consumer of `isChampion` (web UI champion badge, CLI champion display, collection "champion of N" summary) will incorrectly report predicted games as champions. The `champion` NicheNeighbor field is correct (points to the actual game), but the boolean flag on each game's own entry is wrong.

**Fix direction**: `isChampion` should be `rank === 1 && (!isPredicted || no actual games share rank 1 in this niche)`. The `sortAndRank` function already separates actual from predicted in sort order, so detecting whether an actual game exists at rank 1 is straightforward from the ranked array.

---

### TEST GAP: No assertion on `isChampion` for predicted games in ties

**File**: `packages/daemon/tests/niche-engine.test.ts:245-259, 327-349`
**Related to**: The `isChampion` defect above

The "actual scores rank above predicted in ties" test (line 245) and the "Card Game niche: three-way tie" test (line 327) both verify `rank` and `champion.gameId` but never assert `isChampion === false` on game B (predicted). Adding this assertion would catch the defect above and should be included in the fix.

---

### QUESTION: Position-based vs rank-based neighbors

**File**: `packages/daemon/src/services/niche-engine.ts:172-180`
**Requirement**: REQ-NICHE-11

The `above` and `below` arrays collect neighbors by position in the sorted array, not by rank difference. In the Card Game niche (A, H, B all rank 1), B's `above` contains H and A even though they share the same rank and rounded score. The spec says "Games ranked immediately above (better fitness)" which literally means games with better fitness, not games at the same fitness in a higher sort position.

The implementation's choice is more useful (shows context within ties) and is explicitly tested. This is a judgment call, not a clear defect. If the spec intent is strictly "better fitness only," the implementation needs adjustment. If the intent is "adjacent in the ranking," it's correct as-is. Worth confirming with the spec author.

---

### OBSERVATION: NicheNeighbor.fitnessScore uses rounded value

**File**: `packages/daemon/src/services/niche-engine.ts:42`

`toNeighbor` sets `fitnessScore` to the rounded score (one decimal place), not the raw score from `FitnessResult.score`. A game scoring 8.47 appears as 8.5 in neighbor data. This is consistent with display precision and tie logic (REQ-NICHE-6), and the spec's examples show one-decimal values ("Dominion (8.4)"). No action needed unless downstream displays show higher precision for fitness scores elsewhere, which would create visible inconsistency.

---

### Requirements Satisfied

| Requirement | Status |
|---|---|
| REQ-NICHE-1 (mechanics, categories, families only) | Satisfied |
| REQ-NICHE-2 (minimum 2 games) | Satisfied |
| REQ-NICHE-3 (BGG data exclusion) | Satisfied |
| REQ-NICHE-4 (ranked by fitness descending) | Satisfied |
| REQ-NICHE-5 (champion field) | Satisfied |
| REQ-NICHE-6 (tie-sharing, skip, alphabetical) | Satisfied |
| REQ-NICHE-7 (vetoed exclusion) | Satisfied |
| REQ-NICHE-8 (predicted champion demotion) | **DEFECT** — isChampion flag |
| REQ-NICHE-9 (separate from FitnessResult) | Satisfied |
| REQ-NICHE-10 (shared types) | Satisfied |
| REQ-NICHE-11 (2 neighbors max) | Satisfied |
| REQ-NICHE-15 (pure-function module) | Satisfied |
| REQ-NICHE-16 (computeNichePositions signature) | Satisfied |
| REQ-NICHE-17 (computeNicheImpact signature) | Satisfied |
| REQ-NICHE-20 (niche entry sort order) | Satisfied |

### Additional Checks

- **Pure-function discipline**: Clean. Only type-level imports from @shelf-judge/shared. No I/O, no service deps.
- **No input mutation in computeNicheImpact**: Verified. Uses filter(), spread, and new Map/array construction throughout. Tested with JSON.stringify comparison.
- **Test coverage**: 21 tests total (exceeds planned 16). Hand-constructed 9-game fixture with known overlaps. All spec success criteria for automated tests are addressed.
- **Determinism**: Tested explicitly (line 310-325).

## Decisions

**Do the shared types match REQ-NICHE-9 and REQ-NICHE-10?**
Types match spec exactly. All five interfaces present with correct field signatures. GameWithScore and PredictedGameResponse correctly extended with optional niche fields.
*Reasoning: Compared each interface field-by-field against the spec's TypeScript blocks at REQ-NICHE-9 (lines 63-92) and REQ-NICHE-14 (lines 107-122). NicheNeighbor, NicheEntry, NichePosition, NicheImpactEntry, NicheImpact all match. GameWithScore gains optional nichePosition, PredictedGameResponse gains optional nicheImpact.*

**REQ-NICHE-1: Does the engine group by mechanics, categories, families only (excluding subdomains and weight ranges)?**
Satisfied. niche-engine.ts:101-105 iterates only mechanics, categories, families from bggData.
*Reasoning: The tagSets array at line 101-105 contains exactly three entries: ["mechanic", bggData.mechanics], ["category", bggData.categories], ["family", bggData.families]. No subdomains or weight ranges.*

**REQ-NICHE-2: Minimum 2 games per niche enforced?**
Satisfied. niche-engine.ts:155-158 deletes groups with fewer than 2 games.
*Reasoning: The loop at line 155-158 iterates the index and deletes entries where group.games.length < 2.*

**REQ-NICHE-3, REQ-NICHE-7: Games without BGG data and vetoed games excluded?**
Satisfied. filterEligible at niche-engine.ts:126-130 excludes null bggData, null score, and vetoed games.
*Reasoning: Filter condition: gws.game.bggData !== null && gws.score !== null && !gws.score.vetoed. All three exclusion criteria present.*

**REQ-NICHE-4, REQ-NICHE-6: Ranking by fitness score descending with tie-sharing and tiebreakers?**
Satisfied. sortAndRank at niche-engine.ts:52-84 sorts by rounded score descending, actual-beats-predicted, then alphabetical. Rank assignment uses tie-sharing with skip.
*Reasoning: Sort comparator at lines 60-67 applies three tiebreakers in correct order. Rank loop at lines 70-83 shares rank when roundedScore matches previous, otherwise assigns i+1 (skip). The roundedScore function at line 29-31 rounds to one decimal place matching display precision per REQ-NICHE-6.*

**REQ-NICHE-8: Do predicted games correctly NOT get champion status when tied with actual-scored games?**
DEFECT. Predicted games incorrectly receive isChampion: true when tied with actual games at rank 1. niche-engine.ts:188 sets isChampion: game.rank === 1 unconditionally. REQ-NICHE-8 says "they do not displace an actual-scored game from champion status when tied on score." A predicted game sharing rank 1 with an actual game should have isChampion: false.
*Reasoning: In the Card Game niche: A (actual, 8.4), H (actual, 8.4), B (predicted, 8.4) all share rank 1. The champion field correctly points to A (first in sort order). But isChampion is true for all three, including B. REQ-NICHE-8 explicitly says predicted games don't get champion status when an actual game ties. The fix: isChampion should be rank === 1 AND (!isPredicted OR no actual games share rank 1). The test at line 258 checks champion.gameId === "a" but never asserts isChampion === false on B's entry, so this defect is untested.*

**REQ-NICHE-5: Is the champion field correctly populated?**
Satisfied. niche-engine.ts:166 sets champion = toNeighbor(ranked[0]), which is the first game in sort order (actual before predicted, then alphabetical). The champion field is correct even when isChampion is wrong on other entries.
*Reasoning: The sortAndRank function places actual games before predicted at the same score, so ranked[0] is always the most authoritative champion. The champion NicheNeighbor is correct.*

**REQ-NICHE-11: Are above and below arrays bounded to 2 neighbors each?**
Satisfied. niche-engine.ts:173 and 179 both use `above.length < 2` and `below.length < 2` as loop conditions.
*Reasoning: The for loops at lines 173 and 179 collect at most 2 neighbors in each direction by checking array length in the loop condition.*

**REQ-NICHE-11 (cont): When a game is champion, is above empty? When last, is below empty?**
Satisfied. When i === 0 (champion position), the above loop starts at j = -1 and immediately exits. When i === ranked.length - 1 (last position), the below loop starts at j = ranked.length and immediately exits.
*Reasoning: Loop bounds at lines 173 (j >= 0) and 179 (j < ranked.length) naturally produce empty arrays at the boundaries.*

**REQ-NICHE-15: Is the niche engine a pure-function module with no service deps?**
Satisfied. niche-engine.ts imports only type-level imports from @shelf-judge/shared (line 4-13). No I/O, no service layer imports, no state. Exports two pure functions.
*Reasoning: All imports are `import type { ... }`. No fs, no fetch, no service interfaces. Both exported functions take data in and return data out with no side effects.*

**REQ-NICHE-16, REQ-NICHE-17: Do the function signatures match the spec?**
Satisfied. computeNichePositions(gamesWithScores: GameWithScore[]): Map&lt;string, NichePosition&gt; at line 148. computeNicheImpact(existingGamesWithScores: GameWithScore[], candidateGame: Game, candidateScore: FitnessResult): NicheImpact at line 218. Both match spec signatures exactly.
*Reasoning: Direct comparison of function signatures at niche-engine.ts:148-150 and 218-222 against REQ-NICHE-16 and REQ-NICHE-17 in the spec.*

**REQ-NICHE-20: Are niche entries sorted by size descending, then alphabetically?**
Satisfied. sortNicheEntries at niche-engine.ts:135-140 sorts by b.size - a.size (descending), then a.name.localeCompare(b.name) (alphabetical). Applied at line 206.
*Reasoning: Comparator at lines 137-139 checks size first (descending) then name (alphabetical). Called for every game's niche entries before inserting into the result map.*

**Does computeNicheImpact mutate the input array?**
No mutation. The function creates new structures throughout. Line 264 uses spread: [...group.games, { gws: candidateGws }]. The filterEligible call at line 227 creates a new array via .filter(). buildAttributeIndex at line 228 creates new Map and NicheGroup objects.
*Reasoning: Traced all operations on existingGamesWithScores: filter() returns new array, buildAttributeIndex pushes to new group.games arrays, sortAndRank creates new sorted/ranked arrays via map+sort. The spread at line 264 prevents mutation of group.games. The test at line 382-386 also verifies this with JSON.stringify comparison.*

**Are all 16 test cases from the plan present in niche-engine.test.ts?**
All 16 planned test cases are present, plus 5 additional cases (21 total). The test fixture matches the plan's design with 9 games (A-I) and known overlaps. One test gap exists: no test asserts isChampion === false for a predicted game tied with an actual game (mirrors the isChampion defect in the engine).
*Reasoning: Mapped plan test cases to implementation:
1. Groups correctly → line 192
2. <2 excluded → line 199
3. No BGG data excluded → line 209
4. Vetoed excluded → line 213
5. Champion is highest → line 217
6. Tied rank with skip → line 230
7. Actual above predicted in ties → line 245
8. At most 2 neighbors → line 262
9. Champion empty above, last empty below → line 272
10. Multi-niche game → line 284
11. Impact projected rank without mutation → line 374
12. Impact new niche (size 0, null champion) → line 394
13. Niche entries sorted → line 296
14. Determinism → line 310
15. Actual-vs-predicted tiebreak explicit → line 327 (Card Game three-way tie)
16. Impact candidate becomes champion → line 405

Additional tests: Worker Placement minimum (351), niche size excludes vetoed (365), no BGG data impact (417), impact sort order (425), impact tie with champion (443).*

**Test gap: Does the "actual scores rank above predicted" test (line 245) verify isChampion correctly?**
TEST GAP. The test at line 245-259 verifies rank sharing and champion field, but does not assert isChampion === false for predicted game B. The test at line 327-349 (Card Game three-way tie) also does not check isChampion on B. This gap directly corresponds to the isChampion defect in the engine — the test would fail if it checked, which is why it doesn't.
*Reasoning: Lines 250-252 check A's rank and isChampion. Lines 254-259 check B's rank (1) and champion.gameId ("a") but skip isChampion. Lines 342-344 check B's rank (1) in Card Game but skip isChampion. The test correctly validates the sort-order consequence (A is the champion neighbor) but misses the boolean flag consequence (B should not be champion per REQ-NICHE-8).*

**Ambiguity: Should "above" and "below" neighbors include games at the same rank (position-based) or only games at different ranks (rank-based)?**
QUESTION (not a defect). The implementation uses position-based neighbors: a game at sort position 2 shows the game at position 1 as "above" even if they share the same rank. The spec says "Games ranked immediately above (better fitness)" which could mean either. The implementation's choice is more useful for UX (shows adjacent context within ties) and is tested explicitly at lines 345-349. Flagging for implementer awareness, not as a required change.
*Reasoning: In the Card Game niche (A, H, B all rank 1), B's above = [H, A]. These games don't have "better fitness" — they share the same rounded score. The alternative (rank-based) would leave above empty for B, losing useful context. The implementation choice is defensible but should be documented since it diverges from the literal spec wording.*

**Does the fitnessScore in NicheNeighbor use the rounded score rather than the raw score?**
OBSERVATION. toNeighbor at niche-engine.ts:38-43 sets fitnessScore to ranked.roundedScore (the one-decimal-place rounded value), not the original raw score. The spec's NicheNeighbor definition says "fitnessScore: number" without specifying precision. Using rounded values is consistent with the display precision that drives tie-sharing (REQ-NICHE-6), so this is defensible. But it means the neighbor's score loses sub-decimal precision. If downstream displays show more precision elsewhere, the values could appear inconsistent.
*Reasoning: The RankedGame type stores roundedScore (line 20), and toNeighbor at line 42 maps it directly: fitnessScore: ranked.roundedScore. The original score (e.g., 8.42) becomes 8.4 in the neighbor. The spec shows examples like "Dominion (8.4)" suggesting one-decimal display is intended. This is consistent but worth noting.*
