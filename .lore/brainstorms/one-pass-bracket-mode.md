---
title: "One-Pass Bracket Mode"
date: 2026-04-16
status: open
tags: [brainstorm, tournament, pairwise, data-model, ux]
modules: [daemon, web, cli, shared]
related:
  - .lore/issues/tournament/one-pass-bracket-mode.md
  - .lore/specs/tournament/tournament-ranking.md
  - .lore/specs/tournament/reduce-tournament-overhead.md
  - .lore/brainstorms/fitness-model-options.md
  - .lore/vision.md
---

# Brainstorm: One-Pass Bracket Mode

## Header

**Vision status:** Active. Four-step alignment analysis applied to each proposal.

**Context scanned:** `.lore/vision.md`, `.lore/issues/tournament/one-pass-bracket-mode.md`, `.lore/specs/tournament/tournament-ranking.md`, `.lore/specs/tournament/reduce-tournament-overhead.md`, `.lore/brainstorms/fitness-model-options.md`, `.lore/brainstorms/collection-profiling.md`, `packages/daemon/src/services/tournament-service.ts`, `packages/daemon/src/services/elo-engine.ts`, `packages/web/app/tournament/page.tsx`, `packages/web/app/tournament/session/page.tsx`, tournament-related issues and retros.

**Recent brainstorm check:** No prior brainstorm addresses tractability of tournaments at scale. `fitness-model-options.md` (resolved) covered the choice of tournament as a fitness signal and flagged "requires many comparisons to converge" as a weakness but did not propose a structural fix. `collection-profiling.md` (resolved) consumes tournament history for divergence analysis; it assumes history exists but does not shape how it accumulates.

---

## Context

The issue proposes skipping pairs whose outcome can be inferred by transitivity: if `a > b` and `b > c`, don't ask `a` vs `c`. The stated goal is to make tournaments tractable when the pool grows large.

The current tournament system (`tournament-service.ts:213-299`) uses adaptive pairing that prioritizes games with the fewest comparisons, then sorts by ELO proximity, and refuses to show a pair twice within the same session. It does not infer or skip based on prior results. A user can stop a session at any time — there is no "done" state for a full-collection tournament.

Two related facts shape the territory:

- **ELO already encodes soft transitivity.** When `a`'s ELO exceeds `c`'s by 400 points, the standard formula predicts a 91% win for `a`. The adaptive pairing preference for close-ELO pairs (`tournament-service.ts:266-273`) is already a soft version of "skip predictable matches." What the issue asks for is a harder version, grounded in ordinal results rather than ELO diffs.
- **The reduce-tournament-overhead spec dropped full comparison history.** `TournamentData.comparisons` no longer exists; per-game `recentComparisons` is capped at 10. Any proposal that needs the complete pairwise history has to introduce its own storage, because the flat log is gone by design.

These two facts together tell us the interesting question is not "should we add transitivity" but "what shape of knowledge does the tournament maintain, and what does a session mean against that shape." The issue's title says "bracket mode," which hints at a real reframing: a bounded, finishable pass through the pool, rather than an open-ended drift toward ranking stability.

---

## Vision alignment notes (applied to each proposal below)

**Anti-goals:** None of the proposals below touch automated purchase decisions, social features, or BGG replacement. Anti-goal check passes for all.

**Most-loaded principle:** Principle 2 (one number, honestly derived) and the tension resolution row "prediction coverage vs prediction honesty: honesty wins, never." An inferred comparison is structurally a _predicted_ comparison. The vision is strict here: "insufficient data" is better than a confident wrong number. Any proposal that silently substitutes inferred results for real ones has to pay the transparency tax or it sits against the vision. This is the axis each proposal below is evaluated on.

**Neutral principles:** Principles 1 (personal axes), 3 (collection identity), 5 (carrying capacity) don't interact with tournament pairing strategy directly. Principle 4 (data serves judgment) is relevant in UX framing — inferred results should be a tool the user can interrogate, not a decision handed down.

---

## Proposal 1: Transitivity-aware pairing filter (within existing tournament)

### Evidence

`tournament-service.ts:276-291` tracks `seenPairs` within a session to prevent re-showing the same pair. The data structure is already there: a set of pair keys. What's missing is a set of _inferred_ pair keys — pairs whose outcome is implied by the transitive closure of direct comparisons within the session (and optionally cross-session from `recentComparisons`).

ELO updates after each submission (`tournament-service.ts:365-377`) already give us the raw signal. An adjacency structure of "A beat B" edges, built from direct comparisons in the active session, closes transitively in O(n²) worst case but is cheap at session sizes (a session rarely exceeds a few dozen games).

### Proposal

Extend `getNextPair` with a second skip condition: a pair is skipped if a directed path exists from either game to the other in the session's comparison graph. The comparison graph is built fresh each time from `session.comparisons` — no new storage needed. The session ends when both "not seen" and "not inferred" filters eliminate every remaining pair.

The user sees this in the session footer: "12 direct comparisons, 27 inferred. Session complete." A game detail view could expose the inferred ordering: "Ranked above Kingdomino (inferred from 3 paths)." The honesty contract is that inferred relations are marked inferred, never promoted to direct wins/losses in the stats cache.

### Rationale

This is the lightest-weight interpretation of the issue. The session becomes finite by construction. Small sessions approach full-round-robin behavior (few chains form); large sessions derive most of the ordering from a linear-ish number of queries. The ELO engine is untouched — inferred results do not update ELO, because they aren't measured.

### Vision alignment

- **Anti-goal check:** No overlap with anti-goals.
- **Principle alignment:** Principle 2 (transparency) is preserved if inferred relations are surfaced as inferred in the UI. Principle 4 (data serves judgment) holds because the user can still choose to re-test any skipped pair.
- **Tension resolution:** "Prediction coverage vs prediction honesty" — this proposal earns its pass by refusing to write inferred results into ELO. It _predicts_ the user's answer to the skipped question and uses that prediction only for session-completion logic, not for score.
- **Constraint check:** No conflict with "data serves judgment." Conflict possible if the UI hides that pairs were skipped; the footer callout and detail-view disclosure keep the contract.

### Scope

Medium. New module for DAG construction and transitive-closure check. Modifications to `getNextPair`, session completion logic, session-done UI copy. Optional: game-detail surface for "inferred above/below." No data model changes.

---

## Proposal 2: Information-gain pairing (soft transitivity via ELO expectation)

### Evidence

`elo-engine.ts:8-10` computes expected score as `1 / (1 + 10^((B-A)/400))`. This number is exactly "how surprising is the user's answer likely to be." A pair at 1500 vs 1500 has expected score 0.5 (maximally informative). A pair at 1700 vs 1300 has expected score ≈ 0.91 (confirmation of a thing we already believe, low information, small ELO swing).

The current pairing sort (`tournament-service.ts:266-273`) already prefers close-ELO pairs, which is a proxy for information gain. But it never _skips_ a far-apart pair; it just deprioritizes. The loop always returns a pair as long as one unseen pair exists.

### Proposal

Replace "ELO proximity" with an explicit information-gain threshold. Skip any pair whose expected score is above `1 - ε` or below `ε` (e.g., ε = 0.1 means skip pairs where one game has ≥90% expected win probability). Configure via `TournamentSettings` alongside the existing `kFactorThreshold` and `provisionalThreshold`.

Unlike Proposal 1, this is a _continuous_, _ELO-native_ way to do the same work. It does not require building a DAG. Pairs get skipped automatically as ELO spreads during the session. Cycles are handled naturally: if A and C have similar ELO even though A > B > C was observed, the information gain is high and the pair is _not_ skipped.

### Rationale

This reframes the issue's proposal inside the epistemology the system already uses. The honesty cost is lower than strict transitivity because we never assert "A > C" as a fact — we just decline to ask a question whose answer we can guess with high confidence. This is the same move the adaptive pairing already makes in soft form; we are just firming it up with a threshold.

### Vision alignment

- **Anti-goal check:** None triggered.
- **Principle alignment:** Stronger on Principle 2 than Proposal 1 in one respect: there is no inferred-result data to display or hide. Weaker in another respect: the user has no affordance to see "why didn't you ask me?" because the answer is "ELO math said we already knew." A small UI note ("9 pairs skipped as predictable") covers this.
- **Tension resolution:** "Prediction coverage vs honesty" is not strictly engaged — we skip a question, we don't answer it. Arguably the most honest of the pairing proposals.
- **Constraint check:** No conflict. Settings-driven threshold lets user widen or narrow the filter if the session feels wrong.

### Scope

Small. One setting, one predicate in `getNextPair`, one session-footer line. No data model changes. Could ship before Proposal 1 and make Proposal 1 unnecessary for many users.

---

## Proposal 3: Bracket Sort Mode (structured O(n log n) session)

### Evidence

The current session is open-ended adaptive drift. The issue's example (`a > b`, `b > c`, skip `a vs c`, `b > d`, `c > d`, skip `a vs d`) is, read carefully, merge-sort's merge step running live: compare front of each partition, push winner, advance. Binary insertion sort ranks a new element against a sorted list in `O(log n)` comparisons. Both algorithms give ordinal rankings in guaranteed counts: `n log n` for full sort, `log n` per new arrival.

Tournament sessions today return ELO. Ordinal ranking is a different data product. Nothing in the codebase produces it today, but the collection page already supports sorting by tournament rank (REQ-TOURN-17), which is already a lossy projection of ELO onto an order.

### Proposal

Introduce a new session kind, selectable alongside the existing adaptive session: **Bracket Sort**. The user picks a subset (the same filter UI), and the system runs one of two algorithms to completion:

- **Full Sort** (merge sort or binary-insertion): produces an ordinal ranking over the subset in O(n log n) comparisons. Visible progress bar: "comparison 14 of ~27."
- **Top-N Sort**: produces a ranked top-N from the subset using partial quickselect / tournament elimination; the unranked tail stays unordered. Useful for "my top 10 keepers."

Bracket sort outputs a first-class `BracketResult` artifact (stored under the session), which can be read as a snapshot ranking or used to _seed_ ELO scores for subsequent adaptive play. Each pair presented during the bracket _is_ a real comparison — it updates ELO normally. The algorithm decides _which_ pair to ask; it does not fabricate answers.

### Rationale

The issue's "one pass bracket mode" phrasing already implies this. A bracket is a structured tournament. The user's mental model of "I want a reasonable end when the pool gets large" matches the guarantees a comparison-sort gives: finite, bounded, done-when-done. The algorithm's bookkeeping _is_ the transitive inference — it never asks questions whose answers it has deduced from prior ones, because it never needs to. Transitivity is not a hack; it is the algorithm.

This is the proposal with the most gravitational pull. It names what the codebase is reaching for: a difference between **measured ELO** (continuous, drift-tolerant, never finished) and **ordinal snapshots** (bounded, finishable, stale on arrival). The existing session is one of these. The other is missing.

### Vision alignment

- **Anti-goal check:** None triggered.
- **Principle alignment:** Principle 2 (honestly derived) strongly supported — every comparison in the bracket is real, every answer comes from the user. The algorithm's role is routing questions, not generating answers.
- **Tension resolution:** Reverses the honesty tension entirely. "Prediction coverage vs honesty" does not apply because the bracket is not predicting; it is measuring with a defined sample plan.
- **Constraint check:** Requires a new session kind and a new output shape. Interacts with REQ-TOURN-15 (one active session) cleanly if bracket sessions also count as "the active session." Cross-cuts the RTO decision to drop full history: a bracket may need its own comparison log scoped to itself, which is acceptable because the log is bounded and lives with the session.

### Scope

Large. New session kind, new pairing algorithm (pick one sort), new result artifact, new UX state ("bracket in progress, 14/27"), integration with existing ELO updates. Probably requires a spec before implementation, not a direct jump.

---

## Proposal 4: Preference DAG as first-class data

### Evidence

The reduce-tournament-overhead spec (`specs/reduce-tournament-overhead.md:42`) deliberately dropped the unbounded comparisons array. The trade-off documented there was that replay fidelity for ELO was already approximate. But that decision looked at comparisons as ELO inputs — transient signal that updates a rating and then is no longer needed except for recent-comparisons display.

Read another way, each comparison is also a _fact_: "on date D, in context C, the user chose A over B." That's durable, not transient. The tournament today throws this fact away as soon as it has moved two ELO numbers and placed a FIFO entry in a rolling window.

A DAG of `(winner, loser, source-comparison-id, timestamp)` edges is a different shape of knowledge than a stats cache. Three game comparisons against `a` give you three facts; transitive closure gives you more facts for free (with a confidence caveat). The stats cache cannot produce those facts on demand.

### Proposal

Add a persistent `PreferenceGraph` alongside `TournamentData`. Structure:

- Direct edges from submitted comparisons (`{winner, loser, comparisonId, timestamp}`).
- Pruning rule: an edge older than N (configurable, default 180 days) is marked stale. Stale edges participate in transitive closure but are flagged when used.
- Derived at query time: transitive closure, with edge count indicating confidence ("A > D via 4 paths").
- Explicit invalidation: if the user later submits `C > A` and a prior path said `A > C`, the conflicting direct edge wins and the prior is marked "overturned" for visibility.

This graph is the substrate that Proposals 1, 3, and 5 can all read from. It is _not_ the same as the dropped `comparisons` array because (a) it stores only the binary relation, not the ELO context, and (b) it has an explicit aging and conflict model, which the comparison log never had.

### Rationale

Three of the other proposals here independently want the same structure, each building its own ad-hoc version. When three proposals reach for the same shape, the shape is the real idea. The DAG is what the tournament has been trying to say underneath the ELO cache: _these games stand in measured ordinal relation to each other, and that is a different asset from a rating_.

This also opens exits the reduced-overhead spec closed. Collection profiling's divergence analysis currently reads ELO vs axis-score gap (REQ-TOURN-18); with a DAG, it could also read "for these two games, your axes agree but your head-to-head comparisons have produced a cycle — you have genuinely mixed feelings."

### Vision alignment

- **Anti-goal check:** None triggered.
- **Principle alignment:** Principle 2 (transparency) strongly supported. A DAG is maximally interrogable: every relation is traceable to a timestamped direct or derived edge. Principle 4 (data serves judgment) supported: the DAG is a tool the user can read, not a decision it makes.
- **Tension resolution:** "Fitness precision vs transparency" — DAG is all-in on transparency. "Prediction coverage vs honesty" — the aging and conflict model is the honesty mechanism; stale and overturned edges must be marked, never silently applied.
- **Constraint check:** Conflicts with the RTO spec's explicit decision to drop unbounded comparison storage. This is a real tension, not a bug. The DAG stores less per edge than the comparison log and has pruning, so it does not recreate the O(n) growth problem RTO solved — but it does reintroduce persistent per-comparison storage. A spec would have to argue this trade-off directly.

### Scope

Large. New data structure, new storage file (or new section of `tournament.json`), new validation, migration story (do we backfill from `recentComparisons` or start fresh?). Enables Proposals 1 and 3 to be meaningfully cross-session rather than single-session.

---

## Proposal 5: Convergence-based session auto-end

### Evidence

REQ-TOURN-15 and `session/page.tsx` put the session-ending decision fully on the user. There is no signal that says "you have learned what this session can teach you." Combined with the existing provisional-threshold logic (REQ-TOURN-10), the system already reasons about "enough comparisons" for a game individually but not for a session collectively.

`tournament-ranking.md:134` has an existing stub: `[STUB: convergence-detection]` — "System should tell user when rankings have stabilized." The stub is open; no prior brainstorm engages it.

### Proposal

Add a session-level convergence signal. After each comparison, compute a simple summary: average absolute ELO change over the last K comparisons (K = 5 suggested). When that average drops below a threshold (e.g., 4 ELO points), show a "This session has stabilized — pairs are becoming predictable" banner with an affordance to continue or end.

This is not auto-skipping. The user still sees whatever pair the adaptive algorithm selects. It is an honest disclosure that the session is producing low-information comparisons, paired with a graceful ramp to the done state.

Combined with Proposal 2 (information-gain pairing), this is the natural endpoint: when all remaining unseen pairs are below the information-gain threshold, the session auto-ends. The convergence banner is the softer version that leaves agency with the user.

### Rationale

This is the smallest proposal but it names something the tournament has been quietly wrong about: "the user decides when to stop" is _only_ correct when the user has the information to decide. The user does not currently see when their answers have stopped moving the needle. The signal exists — it is in the ELO math — but it is not surfaced.

### Vision alignment

- **Anti-goal check:** None triggered.
- **Principle alignment:** Principle 2 (transparency) — surfaces a fact the system already knows. Principle 4 (data serves judgment) — information, not decision. User can always continue.
- **Tension resolution:** Not structurally engaged. Enhances honesty without expanding coverage.
- **Constraint check:** Works within the existing session model. No data model changes. No interaction with the RTO spec.

### Scope

Small. One computation, one banner, one settings field for the threshold. Could ship in a day. Does not require any other proposal to be useful.

---

## Cross-cutting observations

**The strict-transitivity assumption is the brittle part, not the core.** All five proposals above interpret the issue's idea without requiring "if a > b and b > c then a > c" to hold as an absolute. Proposal 1 builds the DAG but marks inferred edges as inferred. Proposal 2 drops the ordinal frame entirely. Proposal 3 uses an algorithm where transitivity is a property of the algorithm's bookkeeping, not a claim about the user. Proposal 5 never infers at all. The honest paths all route around cycles rather than denying they can exist.

**Two different asks live inside "one-pass bracket mode."** One is "make a long tournament terminate" (solved best by Proposals 1, 2, 3, 5). The other is "give me a finite, finishable artifact over this subset" (solved best by Proposal 3). A spec pursuing this should name which ask it is answering, because they want different shapes.

**The cheapest wins are the convergence signal and the information-gain threshold.** Both land inside the existing adaptive-session model without new data, new sessions, or new artifacts. They should be considered first, not because they are small, but because they test whether the perceived "tournament runs forever" problem is real or if it disappears under honest session-completion signaling.

**The most structurally interesting win is the DAG.** Proposal 4 names the shape three other proposals are reaching for. If the user's appetite is for durable infrastructure rather than incremental pairing improvements, the DAG is the seam.

---

## Open questions

- What pool size is the actual pressure point? The issue mentions "reasonable end when the pool gets much larger." Is this 50 games? 200? The threshold matters for which proposal carries the most weight. A 50-game pool needs bounded sessions (Proposal 5); a 200-game pool needs structured sorting (Proposal 3).
- How aggressively should inferred edges decay? Preferences drift over years, not months, per the collection-profiling brainstorm. But a 6-month-old "I would keep X over Y" may still be honest today. This is a setting worth exposing.
- Should bracket mode update ELO? If every bracket comparison is a real measurement, yes — and the bracket's ordinal output is "free" because it comes from the algorithm's bookkeeping. But if the user expects bracket mode to be a separate "clean-room" snapshot that does not perturb their long-form tournament, the default becomes "no, unless opted in."
- If cycles are surfaced ("you prefer A over B, B over C, C over A"), is that a bug the system should try to resolve with a tiebreaker, or a fact the profile should report? The vision says data serves judgment. Cycles are judgment-relevant data, not noise.

---

## Next steps

If the user pursues this, the cleanest first move is Proposal 2 (information-gain pairing) as a same-day change, paired with Proposal 5 (convergence banner) as a fast follow. Both together would let us observe whether users still feel tournaments "run forever" before committing to Proposal 1 or Proposal 3.

If the answer after observation is "yes, we need bounded finite sessions with named end states," Proposal 3 (Bracket Sort) is the right spec target. It subsumes the issue's example behavior naturally and reframes the question into well-known algorithmic territory.

Proposal 4 (Preference DAG) is the foundation if two or more of the others get pursued. Building any one of them implicitly creates a weak version of the DAG; making it first-class ahead of time avoids three ad-hoc versions.
