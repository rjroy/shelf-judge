---
title: Manual shelf assignment
date: 2026-06-27
status: draft
tags: [shelf-layout, manual-assignment, capacity, bin-packing]
modules: [shared, daemon, web, cli]
related:
  - .lore/specs/features/shelf-capacity.md
  - .lore/designs/similarity-weighted-bin-packing.md
  - .lore/brainstorms/shelf-layout-designer.md
req-prefix: SHELF-ASSIGN
---

# Manual shelf assignment

## Summary

Users can assign an owned game to a configured shelf instead of allowing capacity calculation to choose its shelf. Manual assignments represent the user's intended physical layout: they are placed first, consume shelf capacity, and remain fixed while the existing packing algorithm fills the remaining space with unassigned games.

## Terms

- **Manual assignment**: a game-to-shelf choice saved by the user.
- **Pinned game**: an owned, measured game with a manual assignment to a shelf that still exists.
- **Automatic game**: an owned, measured game without a manual assignment; the packing algorithm chooses its shelf.
- **Assignment conflict**: a saved manual assignment that cannot be honored because the shelf no longer exists or the pinned games do not physically fit in their selected shelf.

## Requirements

### Data and lifecycle

- **REQ-SHELF-ASSIGN-1:** Each game MUST support an optional manual shelf assignment. The persisted value MUST identify a shelf by its stable shelf ID; `null` means the game is eligible for automatic placement.

- **REQ-SHELF-ASSIGN-2:** New and existing games MUST default to no manual shelf assignment. Loading collection data written before this feature MUST preserve that behavior without requiring a manual migration.

- **REQ-SHELF-ASSIGN-3:** A manual assignment MAY be set only for an owned game with complete box dimensions and to a shelf present in the current shelf configuration. Invalid game IDs, non-owned games, games without complete dimensions, and unknown shelf IDs MUST be rejected with a descriptive validation error.

- **REQ-SHELF-ASSIGN-4:** Users MUST be able to replace a game's manual assignment with another configured shelf and clear it. Clearing the assignment MUST make the game eligible for automatic placement on the next capacity calculation.

- **REQ-SHELF-ASSIGN-5:** Changing a game's ownership to previously owned MUST clear its manual shelf assignment because previously owned games do not participate in physical shelf capacity.

- **REQ-SHELF-ASSIGN-6:** Removing a shelf, removing its parent shelf unit, or replacing the shelf configuration without that shelf MUST clear assignments that reference the removed shelf. The operation's response MUST identify how many game assignments were cleared so the user is not given a silent false impression that those placements remain fixed.

### API and mutation behavior

- **REQ-SHELF-ASSIGN-7:** The daemon MUST expose a game-level mutation that sets or clears a manual shelf assignment. A successful response MUST return the updated game, including its current manual shelf assignment.

- **REQ-SHELF-ASSIGN-8:** Assignment mutation and assignment cleanup caused by shelf removal MUST use the existing safe persistence behavior. A failed write MUST NOT report success or leave an in-memory assignment that was not persisted.

- **REQ-SHELF-ASSIGN-9:** Reads of a game MUST expose its manual shelf ID. Capacity output MUST distinguish manually assigned games from automatically assigned games so web and CLI clients can explain why a game is on a shelf.

### Capacity calculation

- **REQ-SHELF-ASSIGN-10:** Capacity calculation MUST process every valid pinned game before any automatic game. Pinned games MUST be placed only on their selected shelf and MUST consume that shelf's remaining width and reported volume before the automatic packing phases begin.

- **REQ-SHELF-ASSIGN-11:** After pinned games are processed, the existing shelf-filling algorithm MUST run against only the remaining automatic games and the capacity left by pinned games. It MUST NOT move a pinned game to improve utilization, similarity, grading, or overflow results.

- **REQ-SHELF-ASSIGN-12:** Multiple pinned games targeting the same shelf MUST be processed in a deterministic order. The result MUST be stable for unchanged collection and shelf data.

- **REQ-SHELF-ASSIGN-13:** A pinned game whose box cannot fit the selected shelf by the existing orientation rules MUST be reported as an assignment conflict. It MUST NOT be moved automatically, included in ordinary `unfittableGames`, or treated as displacement overflow.

- **REQ-SHELF-ASSIGN-14:** When individually fitting pinned games collectively exceed their selected shelf's remaining capacity, the games that cannot be placed MUST be reported as assignment conflicts. They MUST remain manually assigned in persisted data so the user can resolve the intended layout; they MUST NOT fall through to automatic placement.

- **REQ-SHELF-ASSIGN-15:** Assignment conflicts MUST make the capacity result indicate a placement problem even when ordinary overflow is empty. Each conflict MUST identify the game, selected shelf and unit, box dimensions, and a human-readable reason.

- **REQ-SHELF-ASSIGN-16:** Per-shelf capacity output MUST mark each assigned game as `manual` or `automatic`. Utilization, used volume, and shelf grade MUST be calculated from all successfully placed games regardless of assignment source.

- **REQ-SHELF-ASSIGN-17:** Games without a manual assignment MUST retain existing capacity behavior, including dimension coverage, geometric unfittable checks, automatic placement, and overflow ordering.

### Web experience

- **REQ-SHELF-ASSIGN-18:** The game detail page MUST provide a shelf selector near the existing Box Dimensions controls. It MUST list configured shelves with enough context to disambiguate duplicate names, including the shelf unit name.

- **REQ-SHELF-ASSIGN-19:** The selector MUST offer an automatic option, displayed as “Automatic (fill shelves),” which clears the manual assignment. The currently saved assignment MUST be selected when the page loads.

- **REQ-SHELF-ASSIGN-20:** If the game has no box dimensions, the page MUST explain that dimensions are required before a shelf can be assigned and MUST prevent saving a manual shelf choice.

- **REQ-SHELF-ASSIGN-21:** The capacity detail view MUST visually distinguish pinned games from automatically placed games. Assignment conflicts MUST appear in a separate, actionable section and link to the affected game.

- **REQ-SHELF-ASSIGN-22:** After an assignment is set, changed, or cleared, the next capacity view MUST reflect the change without requiring a daemon restart or a separate recalculation command.

### CLI

- **REQ-SHELF-ASSIGN-23:** The CLI MUST support setting a game's manual shelf assignment by game ID and shelf ID and clearing the assignment. Help text MUST state that box dimensions are required.

- **REQ-SHELF-ASSIGN-24:** CLI capacity output MUST label manually assigned games and include an assignment-conflicts section when conflicts exist.

## Scope exclusions

- Drag-and-drop shelf visualization or ordering games within a shelf.
- Shelf preference or “try this shelf, then place elsewhere” behavior. A saved selection is a fixed assignment.
- Assigning games without box dimensions, because their capacity consumption cannot be determined.
- Automatically changing or clearing a valid assignment when the selected shelf is crowded.
- Assigning previously owned games or wishlist entries.

## AI Validation

The implementing AI MUST verify the feature behaviorally:

1. Run shared, daemon, web, and CLI test suites affected by the change.
2. Load legacy collection data without the new field and verify every game behaves as automatically placed.
3. Create two shelves and a set of measured games; pin one game to the shelf the current algorithm would not choose, calculate capacity, and verify it remains on the selected shelf while automatic games fill only the remaining capacity.
4. Pin multiple measured games to one shelf and verify their placement order and output are identical across repeated capacity calculations.
5. Verify an assigned game is never moved by the automatic phases, including when moving it would eliminate overflow or improve shelf similarity.
6. Attempt to assign an unknown shelf, a game without dimensions, and a previously owned game; verify each mutation fails with a descriptive client-visible error and does not alter persisted data.
7. Pin a game whose dimensions do not fit the selected shelf and pin enough individually fitting games to exceed one shelf; verify both cases produce assignment conflicts, do not become ordinary overflow, and do not erase the saved assignments.
8. Clear a manual assignment and verify the game becomes automatically placeable on the next capacity request.
9. Remove a referenced shelf and its parent unit in separate scenarios; verify affected assignments are cleared, the response reports the count, and subsequent game reads contain no dangling shelf IDs.
10. Change an assigned game's ownership to previously owned and verify the assignment is cleared and the game disappears from capacity results.
11. In the web UI, verify the shelf selector shows unit-qualified shelf names, preserves the selected value after refresh, blocks assignment before dimensions exist, and exposes the automatic option.
12. In web and CLI capacity output, verify manual and automatic placements are distinguishable and conflicts identify the affected game and shelf.

## Fresh-eyes review

- The spec defines a selected shelf as a hard assignment, matching the request that predetermined values take precedence. A future shelf-preference feature would need separate semantics and UI language.
- Requiring dimensions avoids presenting inaccurate remaining capacity. This is a product constraint, not a limitation of shelf selection itself.
- Shelf deletion crosses shelf-configuration and collection persistence. The requirements intentionally specify observable consistency and failure behavior while leaving transaction mechanics to design and planning.
- Conflict handling preserves user intent without allowing impossible pins to corrupt automatic packing. Conflicts are a first-class result rather than ordinary algorithm overflow.
