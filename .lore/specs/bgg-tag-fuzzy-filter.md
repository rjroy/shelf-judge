---
title: BGG Tag Filter Fuzzy Matching
date: 2026-04-06
status: implemented
tags: [tournament, filters, bgg, fuzzy-match]
modules: [shared, daemon, web]
related:
  - .lore/specs/tournament-ranking.md
req-prefix: BGG-TAG
---

# Spec: BGG Tag Filter Fuzzy Matching

## Overview

The tournament session `bggTag` filter currently requires an exact case-insensitive match against a game's BGG mechanic or category names. That's unforgiving: `"deck building"` fails to match `"Deck, Bag, and Pool Building"` even though a human would consider that a hit. Change the filter to a token-based fuzzy match so natural queries work, while keeping the rule strict enough that typos (`"decks building"`) still miss.

## Entry Points

- Tournament session filter builder, web UI (`Tournament` page, BGG tag filter option).
- CLI `sj tournament start --tag <value>` flag.
- Direct daemon API (`POST /api/tournament/sessions` with a `bggTag` filter).

## Requirements

- REQ-BGG-TAG-1: The `bggTag` filter matches a game if **any** of its BGG mechanic or category names satisfies the token-match rule below. Matching is per-tag; tokens cannot be satisfied by a combination of two different tags on the same game.
- REQ-BGG-TAG-2: Token-match rule: normalize the query and the candidate tag name by lowercasing and replacing each ASCII punctuation character with a space, then splitting on whitespace into tokens. "ASCII punctuation" means any ASCII character that is not a letter, digit, or whitespace (i.e. the set `!"#$%&'()*+,-./:;<=>?@[\]^_\`{|}~`). The tag matches if every query token appears as a substring of some token in the normalized tag name. Matching is one-directional: each query token must be a substring of a tag token, not the reverse.
  - Example positive: query `"deck building"` matches tag `"Deck, Bag, and Pool Building"` (tokens `deck`, `building` → each is a substring of a tag token).
  - Example positive: query `"WORKER"` matches tag `"Worker Placement"`.
  - Example negative: query `"decks building"` does **not** match `"Deck, Bag, and Pool Building"` (`decks` is not a substring of any tag token).
  - Example negative: query `"building"` does **not** match tag `"Build"` (query token is longer than the tag token; direction matters).
- REQ-BGG-TAG-3: A query value that normalizes to zero tokens matches no games. This covers empty strings, whitespace-only values, and punctuation-only values (filter is not a no-op; consistent with today's behavior).
- REQ-BGG-TAG-4: The match logic lives in a single shared helper in `packages/shared` and is consumed by both the daemon session-filter logic and the web tournament page's live preview count. No duplicate implementations.
- REQ-BGG-TAG-5: The `SessionFilter` shape and validation schema are unchanged; only the interpretation of `value` for `type: "bggTag"` changes.

## Exit Points

| Exit                    | Triggers When                        | Target                              |
| ----------------------- | ------------------------------------ | ----------------------------------- |
| Session scope resolved  | User starts a tournament session     | [Spec: tournament-ranking]          |
| Preview count displayed | User edits filter on Tournament page | Tournament page UI (no spec change) |

## Success Criteria

- [ ] `deck building` matches a game tagged `Deck, Bag, and Pool Building` in both the daemon's filter and the web preview count.
- [ ] `decks building` does not match that same game.
- [ ] Previously-valid exact queries (`Worker Placement`) still match.
- [ ] Daemon and web UI return identical match sets for the same filter against the same game list.
- [ ] Empty, whitespace-only, and punctuation-only filter values yield zero matches.
- [ ] Existing daemon tournament-service tests are updated to reflect the new rule; new cases cover the positive/negative examples above.

## AI Validation

**Defaults apply:**

- Unit tests for the shared match helper covering: lowercase, punctuation stripping, multi-token queries, substring-within-token matching, negative cases for typos, empty-query behavior, unicode/punctuation edge cases (apostrophes, commas, slashes).
- Daemon tournament-service tests updated for the new semantics.
- Fresh-context review of the shared helper and both call sites.

**Custom:**

- Verify there is exactly one implementation of the match rule in the repo (grep confirmation that neither daemon nor web has its own predicate).

## Constraints

- No change to `SessionFilter` JSON shape or validation schema — filters persisted in existing sessions continue to load.
- No change to CLI flag surface (`--tag` keeps mapping to `bggTag`).
- Punctuation handling is ASCII-only; non-ASCII punctuation in tag names is not specifically stripped (BGG tag names are predominantly ASCII; revisit if this proves wrong).

## Context

- `.lore/specs/tournament-ranking.md` — parent spec for tournament sessions and filter types.
- `.lore/plans/tournament-ranking.md` — defines `SessionFilterType` and the original exact-match `bggTag` semantics.
- Current implementations to be unified:
  - `packages/daemon/src/services/tournament-service.ts` (authoritative filter)
  - `packages/web/app/tournament/page.tsx` `countMatchingGames` (preview count)
- Project CLAUDE.md explicitly warns about daemon/client filter drift; this spec collapses that risk by requiring a shared helper.
